import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { cairoDay } from '@/ai/daily-usage';
import { GeminiClient, GeminiError, RunWithToolsInput, RunWithToolsResult, ToolCallRecord } from '@/ai/gemini.client';
import { AssistantUsage, AssistantVisitorUsage, CopilotUsage } from '@/assistant/assistant.schemas';
import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

type Script = (input: RunWithToolsInput, call: (name: string, args?: Record<string, unknown>) => Promise<unknown>) => Promise<string>;

/** Stands in for Gemini: a script decides which tools "the model" calls and what it answers. */
class FakeGemini {
  enabled = true;
  fail: GeminiError | null = null;
  last?: RunWithToolsInput;
  script: Script = async () => 'أهلاً بيك';

  async generate(): Promise<never> {
    throw new GeminiError('FAILED', 500, 'not used in tests');
  }

  async runWithTools(input: RunWithToolsInput): Promise<RunWithToolsResult> {
    this.last = input;
    if (this.fail) throw this.fail;
    const calls: ToolCallRecord[] = [];
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const tool = input.tools.find((t) => t.declaration.name === name);
      const result = tool ? await tool.handler(args) : { error: 'UNKNOWN_TOOL' };
      calls.push({ name, args, result });
      return result;
    };
    const text = await this.script(input, call);
    return { text, calls, model: 'fake', rounds: 1 };
  }
}

describe('Store assistant and seller copilot (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let categoryId: string;
  const gemini = new FakeGemini();
  const api = (path: string) => `/api/v1${path}`;
  const lastCode = () => ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];
  let a: Awaited<ReturnType<typeof onboardBrand>>;
  let b: Awaited<ReturnType<typeof onboardBrand>>;
  let productA: any;
  let productB: any;

  async function onboardBrand(name: string, storeType = 'WAREHOUSE') {
    const owner = await registerUser(ctx, `${name} Owner`);
    const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
    const applied = await ctx
      .http()
      .post(api('/brand-applications'))
      .set(auth(owner.token))
      .send({ storeType, name, categoryIds: [categoryId], contact: { phone: '01011112222', whatsapp: '01011112222' }, logoFileId })
      .expect(201);
    const brandId = applied.body.data.id as string;
    await ctx.http().post(api(`/admin/brands/${brandId}/approve`)).set(auth(admin)).expect(200);
    await ctx
      .http()
      .patch(api('/brands/me'))
      .set(auth(owner.token))
      .send({ settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null } })
      .expect(200);
    return { owner, brandId, slug: applied.body.data.slug as string };
  }

  async function createProduct(token: string, title: string, stock = 100, extra: Record<string, unknown> = {}) {
    const imageFileId = await upload(ctx, token, 'PRODUCT_IMAGE');
    const res = await ctx
      .http()
      .post(api('/brand/products'))
      .set(auth(token))
      .send({ title, categoryId, price: 100, imageFileIds: [imageFileId], variants: [{ size: 'M', stock }], status: 'ACTIVE', ...extra });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.data;
  }

  let keySeq = 0;
  async function placeOrder(token: string, brandId: string, product: any, addressId: string) {
    await ctx.http().post(api(`/carts/${brandId}/items`)).set(auth(token)).send({ productId: product._id, variantId: product.variants[0]._id, quantity: 1 }).expect(201);
    const res = await ctx.http().post(api(`/checkout/${brandId}/orders`)).set(auth(token)).set('Idempotency-Key', `as-${++keySeq}`).send({ addressId }).expect(201);
    if (res.body.data.status === 'AWAITING_CONFIRMATION') {
      await ctx.http().post(api('/orders/me/confirm')).set(auth(token)).send({ code: lastCode() }).expect(200);
    }
    return res.body.data.orderNumber as string;
  }

  const ask = (slug: string, body: Record<string, unknown>, token?: string) => {
    const req = ctx.http().post(api(`/brands/${slug}/assistant/messages`));
    if (token) req.set(auth(token));
    return req.send(body);
  };
  const usage = () => ctx.app.get<Model<AssistantUsage>>(getModelToken(AssistantUsage.name));
  const visitorUsage = () => ctx.app.get<Model<AssistantVisitorUsage>>(getModelToken(AssistantVisitorUsage.name));

  beforeAll(async () => {
    ctx = await createTestApp((builder) => builder.overrideProvider(GeminiClient).useValue(gemini));
    admin = await loginAdmin(ctx);
    const cats = await ctx.http().get(api('/categories')).expect(200);
    categoryId = cats.body.data.find((c: any) => c.slug === 'other')._id;
    a = await onboardBrand('Assistant Warehouse');
    b = await onboardBrand('Other Store', 'BRAND');
    productA = await createProduct(a.owner.token, 'كرتونة مناديل', 2, { wholesale: { minQty: 1, tiers: [{ minQty: 12, price: 80 }] } });
    productB = await createProduct(b.owner.token, 'تيشيرت قطن', 1);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(() => {
    gemini.fail = null;
    gemini.script = async () => 'أهلاً بيك';
  });

  it('shows the assistant on the store page with store-type suggestions, and defaults in brands/me', async () => {
    const info = await ctx.http().get(api(`/brands/${a.slug}/assistant`)).expect(200);
    expect(info.body.data).toMatchObject({ enabled: true, name: 'مساعد Assistant Warehouse' });
    expect(info.body.data.suggestions).toContain('سعر الجملة لو هاخد كمية كبيرة؟');
    expect(info.body.data.greeting).toContain('Assistant Warehouse');
    const me = await ctx.http().get(api('/brands/me')).set(auth(a.owner.token)).expect(200);
    expect(me.body.data.settings.assistant).toEqual({ enabled: true, name: '', tone: 'friendly', extraInfo: '' });
    expect((await ctx.http().get(api('/brands/no-such-store/assistant')).expect(200)).body.data.enabled).toBe(false);
  });

  it('answers from this store only: other stores products are never shown', async () => {
    gemini.script = async (input, call) => {
      const found = (await call('search_products', { query: 'مناديل', brandId: b.brandId })) as { products: { id: string }[] };
      expect(found.products.map((p) => p.id)).toEqual([productA._id]);
      expect(await call('get_product', { productId: productB._id })).toEqual({ error: 'NOT_IN_THIS_STORE' });
      await call('show_products', { productIds: [productA._id, productB._id] });
      expect(input.system).toContain('أسعار الجملة حسب الكمية');
      return 'عندنا كرتونة مناديل بـ 100 ج.م';
    };
    const res = await ask(a.slug, { visitorId: 'visitor-1', text: 'عندكم مناديل؟', productId: productA._id }).expect(200);
    expect(res.body.data.reply.text).toBe('عندنا كرتونة مناديل بـ 100 ج.م');
    expect(res.body.data.reply.products.map((p: any) => p.id)).toEqual([productA._id]);
    expect(res.body.data.reply.products[0]).toMatchObject({ title: 'كرتونة مناديل', brand: { slug: a.slug } });
    expect(gemini.last!.system).toContain(productA._id);
    expect(gemini.last!.tools.map((t) => t.declaration.name)).not.toContain('get_my_orders');

    // Same visitor continues the chat with history; another visitor can't take it over.
    const conversationId = res.body.data.conversationId;
    const again = await ask(a.slug, { visitorId: 'visitor-1', conversationId, text: 'تمام شكراً' }).expect(200);
    expect(again.body.data.conversationId).toBe(conversationId);
    expect(gemini.last!.history.map((h) => h.role)).toEqual(['user', 'model']);
    const stranger = await ask(a.slug, { visitorId: 'visitor-2', conversationId, text: 'مين ده؟' }).expect(200);
    expect(stranger.body.data.conversationId).not.toBe(conversationId);
    expect(gemini.last!.history).toEqual([]);
    // A conversation of store A doesn't continue on store B.
    gemini.script = async () => 'أهلاً';
    const elsewhere = await ask(b.slug, { visitorId: 'visitor-1', conversationId, text: 'سلام' }).expect(200);
    expect(elsewhere.body.data.conversationId).not.toBe(conversationId);
  });

  it("offers a signed-in customer only their orders with this store", async () => {
    const c = await registerUser(ctx, 'Order Customer');
    const addr = await ctx
      .http()
      .post(api('/addresses/me'))
      .set(auth(c.token))
      .send({ recipientName: 'Order Customer', phone: '01022225555', governorate: 'CAI', city: 'Maadi', street: '9 Street', location: { lat: 30, lng: 31 } })
      .expect(201);
    const orderA = await placeOrder(c.token, a.brandId, productA, addr.body.data.id);
    const orderB = await placeOrder(c.token, b.brandId, productB, addr.body.data.id);

    let orders: { orderNumber: string }[] = [];
    gemini.script = async (_i, call) => {
      orders = ((await call('get_my_orders', { brandId: b.brandId })) as { orders: { orderNumber: string }[] }).orders;
      return 'طلبك في الطريق';
    };
    const res = await ask(a.slug, { visitorId: 'visitor-c', text: 'طلبي فين؟' }, c.token).expect(200);
    expect(orders.map((o) => o.orderNumber)).toEqual([orderA]);
    expect(orders.map((o) => o.orderNumber)).not.toContain(orderB);
    expect(res.body.data.reply.actions).toContain('orders');
    expect(gemini.last!.system).toContain('Order');

    // Signed out: no orders tool, and the reply offers the sign-in button.
    gemini.script = async () => 'سجّل دخول الأول';
    const out = await ask(a.slug, { visitorId: 'visitor-c', text: 'طلبي فين؟' }).expect(200);
    expect(gemini.last!.tools.map((t) => t.declaration.name)).not.toContain('get_my_orders');
    expect(out.body.data.reply.actions).toContain('login');
  });

  it('refunds the quota when the AI fails, and enforces store and visitor daily limits', async () => {
    const day = cairoDay();
    const used = async () => (await usage().findOne({ brandId: a.brandId, day }).lean())?.count ?? 0;
    const visitorUsed = async (v: string) => (await visitorUsage().findOne({ key: `v:${v}`, day }).lean())?.count ?? 0;
    const before = await used();

    gemini.fail = new GeminiError('BUSY', 503, 'busy');
    const busy = await ask(a.slug, { visitorId: 'visitor-f', text: 'سؤال' }).expect(503);
    expect(busy.body.error.code).toBe('AI_BUSY');
    expect(await used()).toBe(before);
    expect(await visitorUsed('visitor-f')).toBe(0);
    gemini.fail = new GeminiError('FAILED', 400, 'bad');
    expect((await ask(a.slug, { visitorId: 'visitor-f', text: 'سؤال' }).expect(503)).body.error.code).toBe('AI_UNAVAILABLE');
    gemini.fail = null;

    await visitorUsage().updateOne({ key: 'v:visitor-max', day }, { $set: { count: 40 } }, { upsert: true });
    const v = await ask(a.slug, { visitorId: 'visitor-max', text: 'سؤال' }).expect(429);
    expect(v.body.error).toMatchObject({ code: 'ASSISTANT_DAILY_LIMIT', details: [{ reason: 'visitor' }] });
    expect(await used()).toBe(before); // the store's unit was given back

    await usage().updateOne({ brandId: a.brandId, day }, { $set: { count: 500 } }, { upsert: true });
    const s = await ask(a.slug, { visitorId: 'visitor-new', text: 'سؤال' }).expect(429);
    expect(s.body.error).toMatchObject({ code: 'ASSISTANT_DAILY_LIMIT', details: [{ reason: 'store' }] });
    await usage().updateOne({ brandId: a.brandId, day }, { $set: { count: before } });

    const ok = await ask(a.slug, { visitorId: 'visitor-new', text: 'سؤال' }).expect(200);
    expect(ok.body.data.reply.text).toBe('أهلاً بيك');
    expect(await used()).toBe(before + 1);
    expect(await visitorUsed('visitor-new')).toBe(1);

    await ask(a.slug, { visitorId: 'visitor-new', text: '' }).expect(400);
    await ask(a.slug, { visitorId: 'visitor-new', text: 'x'.repeat(501) }).expect(400);
  });

  it('lets the owner manage settings and read conversations, flagging unanswered ones', async () => {
    gemini.script = async (_i, call) => {
      await call('cannot_answer', { question: 'عندكم فرع في طنطا؟' });
      return 'محتاج أتأكد من المتجر';
    };
    const res = await ask(a.slug, { visitorId: 'visitor-u', text: 'عندكم فرع في طنطا؟' }).expect(200);
    expect(res.body.data.reply).toMatchObject({ unanswered: true });
    expect(res.body.data.reply.actions).toContain('whatsapp');

    const o = auth(a.owner.token);
    const list = await ctx.http().get(api('/brand/assistant/conversations?unanswered=true')).set(o).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: res.body.data.conversationId, hasUnanswered: true, signedIn: false, seen: false });
    expect(list.body.data[0].lastMessage.text).toBe('محتاج أتأكد من المتجر');
    expect(JSON.stringify(list.body.data)).not.toContain('visitor-u');

    const full = await ctx.http().get(api(`/brand/assistant/conversations/${res.body.data.conversationId}`)).set(o).expect(200);
    expect(full.body.data.messages.map((m: any) => [m.role, m.unanswered])).toEqual([['user', false], ['assistant', true]]);
    expect(JSON.stringify(full.body.data)).not.toContain('visitor-u');
    const seen = await ctx.http().get(api('/brand/assistant/conversations')).set(o).expect(200);
    expect(seen.body.data.find((c: any) => c.id === res.body.data.conversationId).seen).toBe(true);
    // Another store can't read it.
    await ctx.http().get(api(`/brand/assistant/conversations/${res.body.data.conversationId}`)).set(auth(b.owner.token)).expect(404);

    const stats = await ctx.http().get(api('/brand/assistant/stats')).set(o).expect(200);
    expect(stats.body.data.today.limit).toBe(500);
    expect(stats.body.data.unanswered7d).toBe(1);
    expect(stats.body.data.conversations7d).toBeGreaterThanOrEqual(3);

    const patched = await ctx.http().patch(api('/brand/assistant/settings')).set(o).send({ name: 'نور', tone: 'formal', extraInfo: 'مفيش فروع' }).expect(200);
    expect(patched.body.data).toMatchObject({ enabled: true, name: 'نور', tone: 'formal', extraInfo: 'مفيش فروع', displayName: 'نور' });
    await ctx.http().patch(api('/brand/assistant/settings')).set(o).send({ tone: 'rude' }).expect(400);
    // brands/me keeps the other assistant fields when only one is sent.
    await ctx.http().patch(api('/brands/me')).set(o).send({ settings: { assistant: { enabled: false } } }).expect(200);
    expect((await ctx.http().get(api('/brand/assistant/settings')).set(o).expect(200)).body.data).toMatchObject({ enabled: false, name: 'نور' });
    expect((await ctx.http().get(api(`/brands/${a.slug}/assistant`)).expect(200)).body.data.enabled).toBe(false);
    expect((await ask(a.slug, { visitorId: 'visitor-u', text: 'هاي' }).expect(404)).body.error.code).toBe('ASSISTANT_DISABLED');

    // Admin sees every store's conversations and can switch the assistant back on.
    const all = await ctx.http().get(api(`/admin/assistant/conversations?brandId=${a.brandId}&unanswered=true`)).set(auth(admin)).expect(200);
    expect(all.body.data[0].brand).toMatchObject({ id: a.brandId, slug: a.slug });
    await ctx.http().get(api(`/admin/assistant/conversations/${res.body.data.conversationId}`)).set(auth(admin)).expect(200);
    await ctx.http().patch(api(`/admin/brands/${a.brandId}/assistant`)).set(auth(admin)).send({ enabled: true }).expect(200);
    await ctx.http().get(api('/admin/assistant/conversations')).set(o).expect(403);
    expect((await ctx.http().get(api(`/brands/${a.slug}/assistant`)).expect(200)).body.data).toMatchObject({ enabled: true, name: 'نور' });
  });

  it('seller copilot reads only its own store and keeps the conversation', async () => {
    let low: any;
    gemini.script = async (input, call) => {
      low = await call('get_low_stock', { brandId: b.brandId });
      await call('get_sales_overview', { days: 7 });
      await call('get_commission_status');
      expect(input.system).toContain('Assistant Warehouse');
      return 'عندك منتج مخزونه قليل';
    };
    const res = await ctx.http().post(api('/brand/copilot/messages')).set(auth(a.owner.token)).send({ text: 'إيه اللي خلص من المخزن؟' }).expect(200);
    expect(res.body.data.reply.text).toBe('عندك منتج مخزونه قليل');
    expect(low.products.map((p: any) => p.title)).toEqual(['كرتونة مناديل']);

    const id = res.body.data.conversationId;
    await ctx.http().post(api('/brand/copilot/messages')).set(auth(a.owner.token)).send({ conversationId: id, text: 'اكتبلي وصف' }).expect(200);
    expect(gemini.last!.history).toHaveLength(2);
    const conv = await ctx.http().get(api(`/brand/copilot/conversations/${id}`)).set(auth(a.owner.token)).expect(200);
    expect(conv.body.data.messages).toHaveLength(4);
    await ctx.http().get(api(`/brand/copilot/conversations/${id}`)).set(auth(b.owner.token)).expect(404);

    gemini.fail = new GeminiError('BUSY', 503, 'busy');
    const copilotUsage = ctx.app.get<Model<CopilotUsage>>(getModelToken(CopilotUsage.name));
    const before = (await copilotUsage.findOne({ brandId: a.brandId, day: cairoDay() }).lean())!.count;
    await ctx.http().post(api('/brand/copilot/messages')).set(auth(a.owner.token)).send({ text: 'تاني' }).expect(503);
    expect((await copilotUsage.findOne({ brandId: a.brandId, day: cairoDay() }).lean())!.count).toBe(before);
    // Customers without a store can't use it.
    const c = await registerUser(ctx, 'No Store');
    await ctx.http().post(api('/brand/copilot/messages')).set(auth(c.token)).send({ text: 'هاي' }).expect(403);
  });
});
