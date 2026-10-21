import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';

export const PRODUCT_AI = Symbol('PRODUCT_AI');

export interface ProductDraftInput {
  imageUrl: string;
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
}

/** Swappable so another (free) model can replace Gemini without touching the rest. */
export interface ProductAiProvider {
  readonly enabled: boolean;
  draft(input: ProductDraftInput): Promise<ProductDraft>;
}

const PROMPT = (input: ProductDraftInput) => `أنت مساعد لمتجر مصري على تطبيق فاترينة (نوع المتجر: ${input.storeType}).
بص على صورة المنتج واكتب بيانات منتج جاهزة للبيع بالعربي المصري البسيط:
- title: اسم قصير وواضح (من 3 لـ 8 كلمات) فيه نوع المنتج والخامة أو الستايل لو باينين. من غير أسعار ومن غير إيموجي.
- description: وصف من 2 لـ 4 جمل: الخامة، الاستخدام، المميزات. متألفش معلومات مش باينة في الصورة.
- categoryId: اختار id قسم واحد مناسب من القائمة دي بس: ${input.categories.map((c) => `${c.id}=${c.name}`).join('، ')}
- colors: الألوان الباينة بالعربي (زي أسود، أبيض، كحلي).
- sizes: مقاسات مقترحة لو المنتج ليه مقاسات (زي S, M, L, XL أو 40, 41, 42)، وإلا سيبها فاضية.
- tags: من 3 لـ 8 كلمات بحث بالعربي اللي الناس ممكن تدوّر بيها.`;

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
    const image = await fetch(input.imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!image.ok) throw new Error(`image fetch ${image.status}`);
    const mime = image.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const data = Buffer.from(await image.arrayBuffer()).toString('base64');

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key! },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT(input) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              description: { type: 'STRING' },
              categoryId: { type: 'STRING' },
              colors: { type: 'ARRAY', items: { type: 'STRING' } },
              sizes: { type: 'ARRAY', items: { type: 'STRING' } },
              tags: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['title', 'description'],
          },
        },
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
      throw new Error(`gemini ${res.status}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('gemini empty');
    return JSON.parse(text) as ProductDraft;
  }
}
