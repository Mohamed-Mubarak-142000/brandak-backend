import { Injectable, Logger } from '@nestjs/common';
import { candidateText, GeminiClient, GeminiError } from './gemini.client';

export { FALLBACK_MODELS, LATEST_MODEL } from './gemini.client';

export const PRODUCT_AI = Symbol('PRODUCT_AI');

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

export const STORE_TYPE_AR: Record<string, string> = { BRAND: 'براند ملابس أو منتجات', SHOWROOM: 'معرض', WAREHOUSE: 'مخزن جملة', SHOP: 'محل' };

const PROMPT = (input: ProductDraftInput) => `إنت خبير في كتابة صفحات منتجات لمتاجر أونلاين في مصر (تطبيق «فاترينة»). نوع المتجر: ${STORE_TYPE_AR[input.storeType] ?? input.storeType}.
الصور المرفقة (${input.imageUrls.length}) كلها لنفس المنتج. اتفرّج عليها كويس: نوع المنتج، الخامة، القصّة/الموديل، اللون، التفاصيل (زراير، جيوب، طباعة، نقشة)، الاستخدام، ولو فيه اسم ماركة أو كلام مكتوب على المنتج نفسه.

اكتب البيانات دي بالعربي المصري البسيط الواضح:
- title: اسم المنتج زي ما بيتكتب في المتاجر المصرية: نوعه + أهم صفة + الخامة أو الموديل لو باينين (4 لـ 9 كلمات). من غير أسعار ولا إيموجي ولا كلمات زي «أفضل» و«رائع».
- description: وصف مفيد في 3 لـ 5 سطور قصيرة، كل سطر يبدأ بـ «• »: الخامة والإحساس بيها، القصّة والمقاس، التفاصيل المميزة، يتلبس/يستخدم في إيه، ونصيحة عناية لو مناسبة. اكتب اللي باين أو المعروف عن النوع ده بس، متألفش أرقام أو مواصفات مش باينة.
- categoryId: id القسم الأنسب من الأقسام المتاحة بس (اختار الأدق: «رجالي › تيشيرتات» مش «ملابس»):
${input.categories.map((c) => `  ${c.id} = ${c.name}`).join('\n') || '  (مفيش أقسام)'}
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

  constructor(private readonly gemini: GeminiClient) {}

  get enabled() {
    return this.gemini.enabled;
  }

  async draft(input: ProductDraftInput): Promise<ProductDraft> {
    const started = Date.now();
    const images = await Promise.all(input.imageUrls.slice(0, 3).map((u) => this.fetchImage(u)));
    let result: Awaited<ReturnType<GeminiClient['generate']>>;
    try {
      // Busy/rate-limited/retired models fall through to the next one while there is time left.
      result = await this.gemini.generate({
        startedAt: started,
        timeoutMs: 18_000,
        budgetMs: 42_000,
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
    } catch (e) {
      if (e instanceof GeminiError) throw new ProductAiError(e.reason === 'BUSY' ? 'BUSY' : 'FAILED', e.message);
      throw e;
    }
    const text = candidateText(result.candidate);
    if (!text) throw new ProductAiError('UNREADABLE', `gemini empty (${result.candidate?.finishReason ?? 'no candidates'})`);
    let draft: ProductDraft;
    try {
      draft = JSON.parse(text) as ProductDraft;
    } catch {
      throw new ProductAiError('UNREADABLE', 'gemini returned invalid JSON');
    }
    if (!draft.title?.trim()) throw new ProductAiError('UNREADABLE', 'not a product photo');
    this.logger.log(`draft in ${Date.now() - started}ms with ${result.model}`);
    return draft;
  }

  private async fetchImage(url: string) {
    const res = await fetch(forModel(url), { signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (!res?.ok) throw new ProductAiError('IMAGE', `image fetch ${res?.status ?? 'failed'}`);
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    return { mime_type: mime, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
  }
}
