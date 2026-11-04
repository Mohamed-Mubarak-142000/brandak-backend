import { AssistantStore, assistantTools, AssistantToolDeps, AssistantTurnState } from './assistant.tools';
import { copilotTools, CopilotToolDeps } from './copilot.tools';

const MINE = '64b000000000000000000aaa';
const OTHER = '64b000000000000000000bbb';
const P1 = '64b000000000000000000001';
const P2 = '64b000000000000000000002';

const card = (id: string, brandId = MINE) =>
  ({
    id,
    title: `p${id.slice(-1)}`,
    price: 100,
    compareAtPrice: null,
    sale: null,
    imageUrl: null,
    inStock: true,
    ratingAvg: 0,
    ratingCount: 0,
    wholesale: null,
    unit: 'قطعة',
    brand: { id: brandId },
  }) as never;

const store: AssistantStore = {
  id: MINE,
  name: 'متجري',
  whatsapp: true,
  settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null },
  extraInfo: 'مواعيدنا من 10 لـ 10',
};
const fresh = (): AssistantTurnState => ({ shown: [], actions: new Set(), unanswered: false });

function deps() {
  const d = {
    products: {
      search: jest.fn(async (_q: unknown) => ({ items: [card(P1)], total: 1, page: 1, limit: 8, extra: {} })),
      getPublic: jest.fn(async (id: string) => ({
        ...(card(id, id === P2 ? OTHER : MINE) as object),
        description: 'وصف',
        categoryPath: 'x',
        sizeLabel: 'المقاس',
        colorLabel: 'اللون',
        variants: [],
        specs: [],
      })),
    },
    orders: {
      recentForCustomerAtBrand: jest.fn(async (_u: string, brandId: string, _n: number) => [
        { orderNumber: 'F-1', statusLabelAr: 'تم الشحن', grandTotal: 200, itemsCount: 2, createdAt: new Date(), brand: { id: brandId } },
        { orderNumber: 'F-2', statusLabelAr: 'ملغي', grandTotal: 90, itemsCount: 1, createdAt: new Date(), brand: { id: OTHER } },
      ]),
    },
    // Like the real query: only this brand's active products come back.
    activeCards: jest.fn(async (brandId: string, ids: string[]) => ids.filter((id) => id === P1).map((id) => card(id, brandId))),
  };
  return d as unknown as AssistantToolDeps & typeof d;
}
const tool = (tools: ReturnType<typeof assistantTools>, name: string) => tools.find((t) => t.declaration.name === name);

describe('assistant tools are scoped to the store', () => {
  it('search_products always searches this store, whatever the model sends', async () => {
    const d = deps();
    await tool(assistantTools(d, store, undefined, fresh()), 'search_products')!.handler({
      query: 'تيشيرت',
      brandId: OTHER,
      sort: 'price_asc',
      maxPrice: '300',
    });
    expect(d.products.search).toHaveBeenCalledWith(expect.objectContaining({ brandId: MINE, q: 'تيشيرت', sort: 'price_asc', maxPrice: 300, limit: 8 }));
  });

  it('get_product rejects a product of another store', async () => {
    const tools = assistantTools(deps(), store, undefined, fresh());
    expect(await tool(tools, 'get_product')!.handler({ productId: P2 })).toEqual({ error: 'NOT_IN_THIS_STORE' });
    expect(await tool(tools, 'get_product')!.handler({ productId: 'nope' })).toEqual({ error: 'NOT_FOUND' });
    expect(await tool(tools, 'get_product')!.handler({ productId: P1 })).toMatchObject({ id: P1, description: 'وصف' });
  });

  it('show_products only shows active products of this store', async () => {
    const d = deps();
    const state = fresh();
    const res = await tool(assistantTools(d, store, undefined, state), 'show_products')!.handler({ productIds: [P1, P2, 'junk'] });
    expect(d.activeCards).toHaveBeenCalledWith(MINE, [P1, P2]);
    expect(state.shown.map((c) => c.id)).toEqual([P1]);
    expect(res).toMatchObject({ shown: [P1], error: 'NOT_IN_THIS_STORE', rejected: [P2, 'junk'] });
  });

  it('get_my_orders is not offered without a signed-in customer', () => {
    expect(tool(assistantTools(deps(), store, undefined, fresh()), 'get_my_orders')).toBeUndefined();
  });

  it("get_my_orders returns only that customer's orders with this store", async () => {
    const d = deps();
    const state = fresh();
    const res = (await tool(assistantTools(d, store, { userId: 'u1' }, state), 'get_my_orders')!.handler({ userId: 'someone-else' })) as {
      orders: { orderNumber: string }[];
    };
    expect(d.orders.recentForCustomerAtBrand).toHaveBeenCalledWith('u1', MINE, 5);
    expect(res.orders.map((o) => o.orderNumber)).toEqual(['F-1']);
    expect(state.actions.has('orders')).toBe(true);
  });

  it('cannot_answer flags the reply; actions are limited to what applies', async () => {
    const state = fresh();
    const tools = assistantTools(deps(), store, undefined, state);
    await tool(tools, 'cannot_answer')!.handler({ question: 'فيه فرع في طنطا؟' });
    expect(state.unanswered).toBe(true);
    expect(await tool(tools, 'suggest_action')!.handler({ action: 'orders' })).toEqual({ error: 'NOT_AVAILABLE' });
    await tool(tools, 'suggest_action')!.handler({ action: 'login' });
    expect([...state.actions].sort()).toEqual(['login', 'whatsapp']);
  });

  it('get_store_info gives governorate names and the owner notes', async () => {
    const info = (await tool(assistantTools(deps(), store, undefined, fresh()), 'get_store_info')!.handler({})) as Record<string, unknown>;
    expect(info.shippingZones).toEqual([{ governorate: 'القاهرة', fee: 50 }]);
    expect(info.extraInfo).toBe('مواعيدنا من 10 لـ 10');
    expect(info.whatsappAvailable).toBe(true);
  });
});

describe('copilot tools only read the caller brand', () => {
  it('passes the caller brandId to every source, ignoring ids from the model', async () => {
    const overview = {
      orders: { count: 1, changePct: null, pendingNow: 0, byStatus: {} },
      salesValue: 1,
      salesChangePct: null,
      deliveredRevenue: 0,
      averageOrderValue: 1,
      activeProducts: 1,
      daily: [],
      topProducts: [],
    };
    const d = {
      analytics: { brandOverview: jest.fn(async (_b: string, _r: unknown) => overview) },
      orders: { digestForBrand: jest.fn(async (_b: string, _s?: string) => ({ latest: [] })) },
      insights: { forBrand: jest.fn(async (_b: string, _d: number, _l: number) => []), missing: jest.fn(async () => []) },
      questions: { listForBrand: jest.fn(async (_b: string, _q: unknown) => ({ items: [], total: 0 })) },
      commissions: {
        statusFor: jest.fn(async (_b: unknown) => ({
          balance: 0,
          dueBy: null,
          blocked: false,
          commissionRate: 0.02,
          settlementDays: 7,
          maxUnpaidBalance: 1000,
          pendingSettlement: null,
        })),
      },
      lowStock: jest.fn(async (_b: string) => []),
      assistantUnanswered: jest.fn(async (_b: string) => ({ count: 0, latest: [] })),
    };
    const tools = copilotTools(d as unknown as CopilotToolDeps, MINE);
    for (const t of tools) await t.handler({ brandId: OTHER, days: 30, status: 'PENDING' });
    expect(d.analytics.brandOverview).toHaveBeenCalledTimes(1); // shared by sales overview + top products
    expect(d.analytics.brandOverview.mock.calls[0][0]).toBe(MINE);
    expect(d.orders.digestForBrand).toHaveBeenCalledWith(MINE, 'PENDING');
    expect(d.insights.forBrand).toHaveBeenCalledWith(MINE, 30, 10);
    expect(d.questions.listForBrand).toHaveBeenCalledWith(MINE, expect.objectContaining({ unanswered: true }));
    expect(String(d.commissions.statusFor.mock.calls[0][0])).toBe(MINE);
    expect(d.lowStock).toHaveBeenCalledWith(MINE);
    expect(d.assistantUnanswered).toHaveBeenCalledWith(MINE);
  });
});
