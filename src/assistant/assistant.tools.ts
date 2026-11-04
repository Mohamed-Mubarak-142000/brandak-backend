import { isValidObjectId } from 'mongoose';
import { Tool, ToolResult } from '@/ai/gemini.client';
import { GOVERNORATES } from '@/common/governorates';
import type { ProductsService } from '@/products/products.service';
import type { OrdersService } from '@/orders/orders.service';

export type ProductCard = ReturnType<ProductsService['toCard']>;
export type AssistantAction = 'login' | 'orders' | 'whatsapp' | 'open_app';
export const ASSISTANT_ACTIONS: AssistantAction[] = ['login', 'orders', 'whatsapp', 'open_app'];
const SORTS = ['newest', 'price_asc', 'price_desc', 'popular', 'discount'] as const;
const MAX_SHOWN = 6;

/** What the tools may read: everything is already scoped to one store by the caller. */
export interface AssistantToolDeps {
  products: Pick<ProductsService, 'search' | 'getPublic'>;
  orders: Pick<OrdersService, 'recentForCustomerAtBrand'>;
  /** Active products of this store among `ids`, as public cards (any order). */
  activeCards: (brandId: string, ids: string[]) => Promise<ProductCard[]>;
}

export interface AssistantStore {
  id: string;
  name: string;
  whatsapp: boolean;
  settings: {
    shippingZones?: { governorate: string; fee: number }[];
    defaultShippingFee?: number | null;
    freeShippingThreshold?: number | null;
    minOrderAmount?: number;
    processingDays?: number;
    shippingPolicy?: string;
    returnPolicy?: string;
    returnDays?: number;
    pickup?: { enabled?: boolean; address?: string; governorate?: string | null; hours?: string } | null;
    acceptsOrders?: boolean;
  };
  extraInfo: string;
}

/** Filled by the tools while the model works; becomes the reply's cards/actions/flag. */
export interface AssistantTurnState {
  shown: ProductCard[];
  actions: Set<AssistantAction>;
  unanswered: boolean;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const govAr = (code?: string | null) => (code ? (GOVERNORATES.find((g) => g.code === code)?.ar ?? code) : null);

/** The short product summary the model reads (cards carry images/brand the model doesn't need). */
export function compactCard(c: ProductCard) {
  const w = c.wholesale as { minQty?: number; tiers?: { minQty: number; price: number }[]; pack?: { unit: string; qty: number } | null } | null;
  return {
    id: c.id,
    title: c.title,
    price: c.price,
    compareAtPrice: c.compareAtPrice ?? null,
    salePercent: c.sale?.percent ?? null,
    inStock: c.inStock,
    unit: c.unit,
    wholesale: w ? { minQty: w.minQty ?? 1, tiers: w.tiers ?? [], pack: w.pack ?? null } : null,
  };
}

export function assistantTools(
  deps: AssistantToolDeps,
  store: AssistantStore,
  user: { userId: string } | undefined,
  state: AssistantTurnState,
): Tool[] {
  const brandId = store.id;
  const tools: Tool[] = [
    {
      declaration: {
        name: 'search_products',
        description: 'يدوّر في منتجات المتجر ده بس. رجّع أول 8 نتايج (السعر الحالي بعد الخصم، المخزون، الجملة).',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'كلمة البحث (نوع المنتج أو اسمه)؛ سيبها فاضية لكل المنتجات' },
            minPrice: { type: 'NUMBER' },
            maxPrice: { type: 'NUMBER' },
            inStockOnly: { type: 'BOOLEAN' },
            sort: { type: 'STRING', enum: [...SORTS] },
          },
        },
      },
      handler: async (args) => {
        const sort = SORTS.includes(args.sort as (typeof SORTS)[number]) ? (args.sort as (typeof SORTS)[number]) : undefined;
        const base = {
          brandId,
          page: 1,
          limit: 8,
          minPrice: num(args.minPrice),
          maxPrice: num(args.maxPrice),
          inStock: args.inStockOnly === true ? true : undefined,
          sort,
        };
        const q = str(args.query, 100);
        const first = await deps.products.search({ ...base, q: q || undefined } as never);
        let items = first.items as ProductCard[];
        let total = first.total;
        // The catalog search matches the phrase as typed; try each word when the phrase finds nothing.
        const words = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
        if (!items.length && words.length > 1) {
          const pages = await Promise.all(words.map((w) => deps.products.search({ ...base, q: w } as never)));
          const seen = new Set<string>();
          items = pages.flatMap((p) => p.items as ProductCard[]).filter((c) => !seen.has(c.id) && !!seen.add(c.id));
          total = items.length;
        }
        return { total, products: items.slice(0, 8).map(compactCard) };
      },
    },
    {
      declaration: {
        name: 'get_product',
        description: 'كل تفاصيل منتج من المتجر ده: الاختيارات (المقاس/اللون والمتوفر)، المواصفات، أسعار الجملة، الوصف.',
        parameters: { type: 'OBJECT', properties: { productId: { type: 'STRING' } }, required: ['productId'] },
      },
      handler: async (args) => {
        const id = str(args.productId, 40);
        if (!isValidObjectId(id)) return { error: 'NOT_FOUND' };
        const p = await deps.products.getPublic(id).catch(() => null);
        if (!p) return { error: 'NOT_FOUND' };
        if (p.brand.id !== brandId) return { error: 'NOT_IN_THIS_STORE' };
        return {
          ...compactCard(p),
          category: p.categoryPath,
          description: (p.description ?? '').slice(0, 1200),
          sizeLabel: p.sizeLabel,
          colorLabel: p.colorLabel,
          variants: p.variants.slice(0, 40).map((v) => ({ size: v.size, color: v.color, price: v.price, inStock: v.inStock })),
          specs: p.specs.map((s) => ({ label: s.label, value: s.value, unit: s.unit })),
          ratingAvg: p.ratingAvg,
          ratingCount: p.ratingCount,
        };
      },
    },
    {
      declaration: {
        name: 'get_store_info',
        description: 'بيانات المتجر: مصاريف الشحن لكل محافظة، الحد الأدنى للطلب، الشحن المجاني، مدة التجهيز، المرتجعات، الاستلام من المحل، ومعلومات إضافية من صاحب المتجر.',
      },
      handler: () => {
        const s = store.settings;
        return {
          storeName: store.name,
          shippingZones: (s.shippingZones ?? []).map((z) => ({ governorate: govAr(z.governorate), fee: z.fee })),
          // null = the store doesn't deliver outside the listed governorates.
          otherGovernoratesFee: s.defaultShippingFee ?? null,
          freeShippingThreshold: s.freeShippingThreshold ?? null,
          minOrderAmount: s.minOrderAmount ?? 0,
          processingDays: s.processingDays ?? 3,
          shippingPolicy: s.shippingPolicy ?? '',
          returnDays: s.returnDays ?? 14,
          returnPolicy: s.returnPolicy ?? '',
          pickup: s.pickup?.enabled
            ? { enabled: true, address: s.pickup.address ?? '', governorate: govAr(s.pickup.governorate), hours: s.pickup.hours ?? '' }
            : { enabled: false },
          acceptsOrders: s.acceptsOrders !== false,
          paymentMethod: 'كاش عند الاستلام',
          extraInfo: store.extraInfo,
          whatsappAvailable: store.whatsapp,
        };
      },
    },
    {
      declaration: {
        name: 'show_products',
        description: 'يعرض للعميل كروت منتجات من المتجر ده تحت ردك (لحد 6). استخدمه كل ما ترشّح منتجات.',
        parameters: {
          type: 'OBJECT',
          properties: { productIds: { type: 'ARRAY', items: { type: 'STRING' } } },
          required: ['productIds'],
        },
      },
      handler: async (args) => {
        const ids = [...new Set((Array.isArray(args.productIds) ? args.productIds : []).map((x) => str(x, 40)))]
          .filter((id) => isValidObjectId(id))
          .slice(0, MAX_SHOWN);
        const cards = ids.length ? await deps.activeCards(brandId, ids) : [];
        const byId = new Map(cards.filter((c) => c.brand.id === brandId).map((c) => [c.id, c]));
        for (const id of ids) {
          const card = byId.get(id);
          if (card && state.shown.length < MAX_SHOWN && !state.shown.some((s) => s.id === id)) state.shown.push(card);
        }
        const rejected = (Array.isArray(args.productIds) ? args.productIds : []).map(String).filter((id) => !byId.has(id));
        return { shown: state.shown.map((c) => c.id), ...(rejected.length ? { rejected, error: 'NOT_IN_THIS_STORE' } : {}) };
      },
    },
    {
      declaration: {
        name: 'cannot_answer',
        description: 'نادي ده لما المعلومة مش موجودة في بيانات المتجر، عشان صاحب المتجر يشوف السؤال ويضيف الرد.',
        parameters: { type: 'OBJECT', properties: { question: { type: 'STRING' } }, required: ['question'] },
      },
      handler: () => {
        state.unanswered = true;
        if (store.whatsapp) state.actions.add('whatsapp');
        return { ok: true };
      },
    },
    {
      declaration: {
        name: 'suggest_action',
        description: 'يظهر للعميل زرار: login (تسجيل الدخول)، orders (طلباتي)، whatsapp (كلّم المتجر)، open_app (افتح تطبيق فاترينة).',
        parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ASSISTANT_ACTIONS } }, required: ['action'] },
      },
      handler: (args) => {
        const action = args.action as AssistantAction;
        const allowed =
          (action === 'login' && !user) || (action === 'orders' && !!user) || (action === 'whatsapp' && store.whatsapp) || action === 'open_app';
        if (!allowed) return { error: 'NOT_AVAILABLE' };
        state.actions.add(action);
        return { ok: true };
      },
    },
  ];

  // Only offered to a signed-in customer, and only their orders with this store.
  if (user) {
    tools.push({
      declaration: {
        name: 'get_my_orders',
        description: 'آخر 5 طلبات للعميل ده من المتجر ده (رقم الطلب، الحالة، الإجمالي، التاريخ).',
      },
      handler: async (): Promise<ToolResult> => {
        const orders = await deps.orders.recentForCustomerAtBrand(user.userId, brandId, 5);
        state.actions.add('orders');
        return {
          orders: orders
            .filter((o) => o.brand.id === brandId)
            .map((o) => ({ orderNumber: o.orderNumber, status: o.statusLabelAr, grandTotal: o.grandTotal, itemsCount: o.itemsCount, createdAt: o.createdAt })),
        };
      },
    });
  }
  return tools;
}
