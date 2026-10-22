import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';

export const PRODUCT_AI = Symbol('PRODUCT_AI');
/** Google's alias for the current Flash model. */
export const LATEST_MODEL = 'gemini-flash-latest';
/** Tried in order when the configured model is busy or gone (all read photos, all free-tier). */
export const FALLBACK_MODELS = [LATEST_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-lite-latest'];

export interface ProductDraftInput {
  /** 1–3 photos of the same product (the first is the main one). */
  imageUrls: string[];
  storeType: string;
  /** The store's categories the model must choose from. */
  categories: { id: string; name: string }[];
}

/** What the model suggests; the seller reviews and edits it before saving. */
export interface ProductDraft {
  title: string;
  description: string;
  categoryId: string | null;
  colors: string[];
  sizes: string[];
  tags: string[];
  /** Suggested selling price in EGP for the Egyptian market (null when it can't tell). */
  suggestedPrice: number | null;
}

/** Why a draft failed, so the app can say something useful. */
export class ProductAiError extends Error {
  constructor(
    readonly reason: 'BUSY' | 'IMAGE' | 'UNREADABLE' | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** Swappable so another (free) model can replace Gemini without touching the rest. */
export interface ProductAiProvider {
  readonly enabled: boolean;
  draft(input: ProductDraftInput): Promise<ProductDraft>;
}

const STORE_TYPE_AR: Record<string, string> = { BRAND: 'براند ملابس أو منتجات', SHOWROOM: 'معرض', WAREHOUSE: 'مخزن جملة', SHOP: 'محل' };

const PROMPT = (input: ProductDraftInput) => `إنت خبير في كتابة صفحات منتجات لمتاجر أونلاين في مصر (تطبيق «فاترينة»). نوع المتجر: ${STORE_TYPE_AR[input.storeType] ?? input.storeType}.
الصور المرفقة (${input.imageUrls.length}) كلها لنفس المنتج. اتفرّج عليها كويس: نوع المنتج، الخامة، القصّة/الموديل، اللون، التفاصيل (زراير، جيوب، طباعة، نقشة)، الاستخدام، ولو فيه اسم ماركة أو كلام مكتوب على المنتج نفسه.

اكتب البيانات دي بالعربي المصري البسيط الواضح:
- title: اسم المنتج زي ما بيتكتب في المتاجر المصرية: نوعه + أهم صفة + الخامة أو الموديل لو باينين (4 لـ 9 كلمات). من غير أسعار ولا إيموجي ولا كلمات زي «أفضل» و«رائع».
- description: وصف مفيد في 3 لـ 5 سطور قصيرة، كل سطر يبدأ بـ «• »: الخامة والإحساس بيها، القصّة والمقاس، التفاصيل المميزة، يتلبس/يستخدم في إيه، ونصيحة عناية لو مناسبة. اكتب اللي باين أو المعروف عن النوع ده بس، متألفش أرقام أو مواصفات مش باينة.
- categoryId: id القسم الأنسب من الأقسام المتاحة بس.
- colors: الألوان الباينة في الصور بالعربي (أسود، أبيض، كحلي، بيج، زيتي...). لو فيه أكتر من لون معروض كاختيارات اكتبهم كلهم.
- sizes: المقاسات اللي المنتج ده بيتباع بيها عادةً في مصر: هدوم (S, M, L, XL, XXL)، جزم (37 لـ 45)، أطفال بالسن (2-3 سنين...)، ولو المنتج مقاس واحد (شنطة، إكسسوار، أداة) سيبها فاضية.
- tags: من 5 لـ 10 كلمات أو عبارات قصيرة الناس بتكتبها في البحث فعلاً (نوع المنتج، الخامة، المناسبة، الفئة زي رجالي/حريمي/أطفال).
- suggestedPrice: سعر بيع مقترح بالجنيه المصري لمنتج شبهه في السوق المصري أونلاين (رقم صحيح). لو مش قادر تقدّر خلّيه 0.

لو الصورة مش لمنتج (مثلاً صورة شخص أو منظر) رجّع title فاضي.`;

/** Smaller JPEG copies from Cloudinary: faster to fetch and to send, plenty for the model. */
const forModel = (url: string) => {
  const marker = '/image/upload/';
  const i = url.indexOf(marker);
  if (!url.includes('res.cloudinary.com') || i < 0) return url;
  return `${url.slice(0, i + marker.length)}f_jpg,q_80,c_limit,w_1024/${url.slice(i + marker.length)}`;
};

/** Google Gemini (free tier from Google AI Studio). Disabled when GEMINI_API_KEY is not set. */
@Injectable()
export class GeminiProductAi implements ProductAiProvider {
  private readonly logger = new Logger(GeminiProductAi.name);
  private readonly key: string | undefined;
  private readonly model: string;

  constructor(config: ConfigService<Env, true>) {
    this.key = config.get('GEMINI_API_KEY', { infer: true }) || undefined;
    this.model = config.get('GEMINI_MODEL', { infer: true });
  }

  get enabled() {
    return !!this.key;
  }

  async draft(input: ProductDraftInput): Promise<ProductDraft> {
    const started = Date.now();
    const images = await Promise.all(input.imageUrls.slice(0, 3).map((u) => this.fetchImage(u)));
    const body = JSON.stringify({
      contents: [{ parts: [...images.map((img) => ({ inline_data: img })), { text: PROMPT(input) }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            description: { type: 'STRING' },
            // The model can only pick one of the store's categories.
            categoryId: input.categories.length ? { type: 'STRING', enum: input.categories.map((c) => c.id) } : { type: 'STRING' },
            colors: { type: 'ARRAY', items: { type: 'STRING' } },
            sizes: { type: 'ARRAY', items: { type: 'STRING' } },
            tags: { type: 'ARRAY', items: { type: 'STRING' } },
            suggestedPrice: { type: 'NUMBER' },
          },
          required: ['title', 'description', 'colors', 'sizes', 'tags', 'suggestedPrice'],
        },
      },
    });

    // Free-tier models are often "busy" (503), rate-limited (429) or retired (404): try the next
    // one in line instead of failing, as long as there is time left before the server's limit.
    const chain = [...new Set([this.model, ...FALLBACK_MODELS])];
    let model = chain[0];
    let res = await this.call(model, body, 18_000);
    for (const next of chain.slice(1)) {
      if (![404, 429, 500, 503, 504].includes(res.status) || Date.now() - started > 42_000) break;
      this.logger.warn(`Gemini ${model} answered ${res.status}, trying ${next}`);
      model = next;
      res = await this.call(model, body, Math.max(8_000, Math.min(18_000, 54_000 - (Date.now() - started))));
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      this.logger.warn(`Gemini ${res.status}: ${detail}`);
      if ([429, 503, 504].includes(res.status)) throw new ProductAiError('BUSY', `gemini ${res.status}`);
      throw new ProductAiError('FAILED', `gemini ${res.status}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (!text) throw new ProductAiError('UNREADABLE', `gemini empty (${json.candidates?.[0]?.finishReason ?? 'no candidates'})`);
    let draft: ProductDraft;
    try {
      draft = JSON.parse(text) as ProductDraft;
    } catch {
      throw new ProductAiError('UNREADABLE', 'gemini returned invalid JSON');
    }
    if (!draft.title?.trim()) throw new ProductAiError('UNREADABLE', 'not a product photo');
    this.logger.log(`draft in ${Date.now() - started}ms with ${model}`);
    return draft;
  }

  private async fetchImage(url: string) {
    const res = await fetch(forModel(url), { signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (!res?.ok) throw new ProductAiError('IMAGE', `image fetch ${res?.status ?? 'failed'}`);
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { mime_type: mime, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
  }

  /** A timeout or network error reads as 504 so the caller moves on to the next model. */
  private async call(model: string, body: string, timeoutMs: number): Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'>> {
    try {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key! },
        signal: AbortSignal.timeout(timeoutMs),
        body,
      });
    } catch (e) {
      const message = (e as Error).message;
      return { ok: false, status: 504, text: async () => message, json: async () => ({}) };
    }
  }
}
