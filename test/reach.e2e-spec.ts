import { InsightsService } from '@/insights/insights.service';
import { TRACKING_HTTP } from '@/tracking/tracking.service';
import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

/** Captures what would be sent to Facebook / TikTok. */
const sentPixels: { url: string; body: any; headers: Record<string, string> }[] = [];
const fakeHttp = async (url: string, init: { headers: Record<string, string>; body: string }) => {
  sentPixels.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  return { ok: true, status: 200 };
};

/** Batch 6: ad pixels, search insights, weekly report, and the store web page. */
describe('Fatrina reach: pixels, insights, weekly report, web store (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let categoryId: string;
  let store: { owner: { token: string; email: string }; brandId: string; slug: string };
  let product: any;

  const api = (path: string) => `/api/v1${path}`;
  const lastCode = () => ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];

  beforeAll(async () => {
    ctx = await createTestApp((b) => b.overrideProvider(TRACKING_HTTP).useValue(fakeHttp));
    admin = await loginAdmin(ctx);
    const cats = await ctx.http().get(api('/categories')).expect(200);
    categoryId = cats.body.data[0]._id;

    const owner = await registerUser(ctx, 'Pixel Owner');
    const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
    const applied = await ctx
      .http()
      .post(api('/brand-applications'))
      .set(auth(owner.token))
      .send({ storeType: 'BRAND', name: 'Pixel <Brand>', categoryIds: [categoryId], contact: { phone: '01011112222', whatsapp: '01011112222' }, logoFileId })
      .expect(201);
    store = { owner, brandId: applied.body.data.id, slug: applied.body.data.slug };
    await ctx.http().post(api(`/admin/brands/${store.brandId}/approve`)).set(auth(admin)).expect(200);
    await ctx.http().patch(api('/brands/me')).set(auth(owner.token)).send({ settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null } }).expect(200);
    const imageFileId = await upload(ctx, owner.token, 'PRODUCT_IMAGE');
    product = (
      await ctx
        .http()
        .post(api('/brand/products'))
        .set(auth(owner.token))
        .send({ title: 'جاكيت جينز أزرق', categoryId, price: 650, imageFileIds: [imageFileId], variants: [{ size: 'L', stock: 10 }], status: 'ACTIVE' })
        .expect(201)
    ).body.data;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('sends views, add-to-carts and confirmed orders to the store pixels, hashing personal data', async () => {
    await ctx.http().put(api('/brand/tracking')).set(auth(store.owner.token)).send({ metaPixelId: 'abc' }).expect(400);
    const saved = await ctx
      .http()
      .put(api('/brand/tracking'))
      .set(auth(store.owner.token))
      .send({ metaPixelId: '1234567890', metaAccessToken: 'meta-secret', tiktokPixelId: 'CABC123', tiktokAccessToken: 'tt-secret' })
      .expect(200);
    expect(saved.body.data).toEqual({ metaPixelId: '1234567890', hasMetaToken: true, tiktokPixelId: 'CABC123', hasTiktokToken: true });
    // Tokens never come back.
    const mine = await ctx.http().get(api('/brands/me')).set(auth(store.owner.token)).expect(200);
    expect(JSON.stringify(mine.body.data)).not.toContain('meta-secret');

    const c = await registerUser(ctx, 'Pixel Shopper');
    sentPixels.length = 0;
    await ctx.http().post(api(`/products/${product._id}/view`)).set(auth(c.token)).expect(204);
    expect(sentPixels).toHaveLength(2);
    const fb = sentPixels.find((p) => p.url.includes('graph.facebook.com/v21.0/1234567890/events'))!;
    expect(fb.url).toContain('access_token=meta-secret');
    expect(fb.body.data[0]).toMatchObject({ event_name: 'ViewContent', custom_data: { currency: 'EGP', value: 650, content_ids: [product._id] } });
    expect(fb.body.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(sentPixels)).not.toContain(c.email);
    const tt = sentPixels.find((p) => p.url.includes('business-api.tiktok.com'))!;
    expect(tt.headers['Access-Token']).toBe('tt-secret');
    expect(tt.body).toMatchObject({ event_source_id: 'CABC123', data: [{ event: 'ViewContent' }] });

    sentPixels.length = 0;
    await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: product.variants[0]._id, quantity: 2 }).expect(201);
    expect(sentPixels.map((p) => p.body.data?.[0]?.event_name ?? p.body.data?.[0]?.event)).toEqual(expect.arrayContaining(['AddToCart']));

    const addr = await ctx
      .http()
      .post(api('/addresses/me'))
      .set(auth(c.token))
      .send({ recipientName: 'Pixel Shopper', phone: '01022225555', governorate: 'CAI', city: 'Giza', street: '1 Street', location: { lat: 30, lng: 31 } })
      .expect(201);
    sentPixels.length = 0;
    const order = await ctx.http().post(api(`/checkout/${store.brandId}/orders`)).set(auth(c.token)).set('Idempotency-Key', 'px-1').send({ addressId: addr.body.data.id }).expect(201);
    // A new customer's order waits for the email code: not a purchase yet.
    expect(order.body.data.status).toBe('AWAITING_CONFIRMATION');
    expect(sentPixels).toHaveLength(0);
    await ctx.http().post(api('/orders/me/confirm')).set(auth(c.token)).send({ code: lastCode() }).expect(200);
    const purchase = sentPixels.find((p) => p.url.includes('facebook'))!;
    expect(purchase.body.data[0]).toMatchObject({ event_name: 'Purchase', event_id: `order-${order.body.data.id}`, custom_data: { value: 1300 } });
    expect(sentPixels.find((p) => p.url.includes('tiktok'))!.body.data[0].event).toBe('PlaceAnOrder');
  });

  it('tells stores what people search for, and what they find nothing for', async () => {
    await ctx.http().get(api(`/products?q=${encodeURIComponent('جاكيت')}`)).expect(200);
    await ctx.http().get(api(`/products?q=${encodeURIComponent('جاكيت')}&sort=price_asc`)).expect(200);
    await ctx.http().get(api(`/products?q=${encodeURIComponent('بلايستيشن')}`)).expect(200);

    const res = await ctx.http().get(api('/brand/insights/searches')).set(auth(store.owner.token)).expect(200);
    expect(res.body.data.yours).toEqual([{ term: 'جاكيت', searches: 2 }]);
    expect(res.body.data.missing).toEqual(expect.arrayContaining([{ term: 'بلايستيشن', searches: 1, results: 0 }]));
    expect(res.body.data.missing.map((m: any) => m.term)).not.toContain('جاكيت');

    const adminView = await ctx.http().get(api('/admin/insights/searches')).set(auth(admin)).expect(200);
    expect(adminView.body.data.map((m: any) => m.term)).toContain('بلايستيشن');
    const c = await registerUser(ctx, 'Nosy');
    await ctx.http().get(api('/admin/insights/searches')).set(auth(c.token)).expect(403);
  });

  it('emails each store its week once, with orders and search demand', async () => {
    const week = await ctx.http().get(api('/brand/insights/week')).set(auth(store.owner.token)).expect(200);
    expect(week.body.data).toMatchObject({ orders: 1, topProducts: [{ title: 'جاكيت جينز أزرق', quantity: 2 }] });

    const insights = ctx.app.get(InsightsService);
    const before = ctx.contact.sent.length;
    expect(await insights.sendWeekly(new Date(), true)).toBeGreaterThanOrEqual(1);
    const mail = ctx.contact.sent.slice(before).find((m) => m.target === store.owner.email);
    expect(mail?.message).toContain('تقرير');
    expect(mail?.message).toContain('بلايستيشن');
    // Running again the same week sends nothing new.
    expect(await insights.sendWeekly(new Date(), true)).toBe(0);
  });

  it('serves a store web page for bio links, with escaped content, previews and pixels', async () => {
    const page = await ctx.http().get(`/s/${store.slug}`).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("img-src *");
    expect(page.text).toContain('Pixel &lt;Brand&gt;');
    expect(page.text).not.toContain('Pixel <Brand>');
    expect(page.text).toContain('جاكيت جينز أزرق');
    expect(page.text).toContain('og:title');
    expect(page.text).toContain("fbq('init','1234567890')");
    expect(page.text).toContain('https://wa.me/201011112222');

    const item = await ctx.http().get(`/s/${store.slug}/p/${product._id}`).expect(200);
    expect(item.text).toContain(`fatrina://product/${product._id}`);
    expect(item.text).toContain("fbq('track','ViewContent'");

    await ctx.http().get('/s/no-such-store').expect(404);
    await ctx.http().get(`/s/${store.slug}/p/000000000000000000000000`).expect(404);
    // The JSON API still lives under /api/v1.
    await ctx.http().get(api(`/brands/${store.slug}`)).expect(200);
  });
});
