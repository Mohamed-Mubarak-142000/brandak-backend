import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiUsage } from '@/ai/ai.service';
import { PRODUCT_AI, ProductAiProvider, ProductDraft } from '@/ai/product-ai.provider';
import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

/** A stand-in for Gemini: answers from a script, can be switched off or made to fail. */
class FakeAi implements ProductAiProvider {
  enabled = true;
  fail = false;
  calls = 0;
  answer: ProductDraft = {
    title: '  تيشيرت قطن   أسود  ',
    description: 'تيشيرت قطن 100% مريح للخروج والبيت.',
    categoryId: 'not-a-real-id',
    colors: ['أسود', 'أسود', ' أبيض '],
    sizes: ['M', 'L', 'XL'],
    tags: ['تيشيرت', 'قطن', 'صيفي'],
  };
  async draft() {
    this.calls++;
    if (this.fail) throw new Error('model down');
    return this.answer;
  }
}

/**
 * Batch 4: wholesale prices, store pickup, product drafts from a photo, price/stock alerts and
 * following stores.
 */
describe('Fatrina growth features (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let categoryId: string;
  const fakeAi = new FakeAi();

  const api = (path: string) => `/api/v1${path}`;
  const lastCode = () => ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];

  beforeAll(async () => {
    ctx = await createTestApp((b) => b.overrideProvider(PRODUCT_AI).useValue(fakeAi));
    admin = await loginAdmin(ctx);
    const cats = await ctx.http().get(api('/categories')).expect(200);
    categoryId = cats.body.data[0]._id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function onboardBrand(name: string, storeType = 'WAREHOUSE') {
    const owner = await registerUser(ctx, `${name} Owner`);
    const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
    const applied = await ctx
      .http()
      .post(api('/brand-applications'))
      .set(auth(owner.token))
      .send({ storeType, name, categoryIds: [categoryId], contact: { phone: '01011112222' }, logoFileId })
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

  async function createProduct(token: string, body: Record<string, unknown> = {}, status = 201) {
    const imageFileId = await upload(ctx, token, 'PRODUCT_IMAGE');
    return ctx
      .http()
      .post(api('/brand/products'))
      .set(auth(token))
      .send({ title: 'شراب قطن', categoryId, price: 100, imageFileIds: [imageFileId], variants: [{ size: 'M', stock: 100 }, { size: 'L', stock: 100 }], status: 'ACTIVE', ...body })
      .expect(status);
  }

  const newCustomer = async (name: string) => {
    const c = await registerUser(ctx, name);
    const addr = await ctx
      .http()
      .post(api('/addresses/me'))
      .set(auth(c.token))
      .send({ recipientName: name, phone: '01022225555', governorate: 'CAI', city: 'Maadi', street: '9 Street', location: { lat: 30, lng: 31 } })
      .expect(201);
    return { ...c, addressId: addr.body.data.id as string };
  };

  let keySeq = 0;
  const place = async (brandId: string, c: { token: string }, body: Record<string, unknown>) => {
    const res = await ctx.http().post(api(`/checkout/${brandId}/orders`)).set(auth(c.token)).set('Idempotency-Key', `g-${++keySeq}`).send(body);
    if (res.status === 201 && res.body.data.status === 'AWAITING_CONFIRMATION') {
      await ctx.http().post(api('/orders/me/confirm')).set(auth(c.token)).send({ code: lastCode() }).expect(200);
    }
    return res;
  };
  const notificationTypes = async (token: string) =>
    (await ctx.http().get(api('/notifications/me?limit=50')).set(auth(token)).expect(200)).body.data.map((n: any) => n.type) as string[];

  // ---------------------------------------------------------------- Wholesale

  it('prices by quantity across sizes and enforces the wholesale minimum', async () => {
    const store = await onboardBrand('Socks Warehouse');
    const bad = await createProduct(store.owner.token, { wholesale: { minQty: 6, tiers: [{ minQty: 12, price: 120 }] } }, 422);
    expect(bad.body.error.code).toBe('INVALID_WHOLESALE');
    const product = (await createProduct(store.owner.token, { wholesale: { minQty: 6, tiers: [{ minQty: 50, price: 70 }, { minQty: 12, price: 80 }] } }, 201)).body.data;
    expect(product.wholesale).toEqual({ minQty: 6, tiers: [{ minQty: 12, price: 80 }, { minQty: 50, price: 70 }] });

    const card = await ctx.http().get(api(`/products/${product._id}`)).expect(200);
    expect(card.body.data.wholesale.tiers).toHaveLength(2);

    const c = await newCustomer('Shop Owner Buyer');
    const [m, l] = product.variants.map((v: any) => v._id);
    const cart = await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: m, quantity: 4 }).expect(201);
    expect(cart.body.data.items[0]).toMatchObject({ issue: 'BELOW_MIN_QTY', minQty: 6, unitPrice: 100 });
    await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId }).expect(409);

    // 6 M + 6 L = 12 pieces: the 12+ tier applies to both lines.
    await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: m, quantity: 2 }).expect(201);
    const full = await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: l, quantity: 6 }).expect(201);
    expect(full.body.data.items.map((i: any) => i.unitPrice)).toEqual([80, 80]);
    expect(full.body.data.hasIssues).toBe(false);

    const order = await place(store.brandId, c, { addressId: c.addressId });
    expect(order.status).toBe(201);
    expect(order.body.data).toMatchObject({ subtotal: 960, shippingFee: 50, grandTotal: 1010 });
  });

  // ---------------------------------------------------------------- Pickup

  it('lets customers collect from the store with no shipping fee', async () => {
    const store = await onboardBrand('Pickup Showroom', 'SHOWROOM');
    const product = (await createProduct(store.owner.token, {}, 201)).body.data;
    const c = await newCustomer('Pickup Customer');
    await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: product.variants[0]._id, quantity: 2 }).expect(201);

    const off = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ fulfillment: 'PICKUP' });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('PICKUP_NOT_AVAILABLE');
    const noAddr = await ctx.http().patch(api('/brands/me')).set(auth(store.owner.token)).send({ settings: { pickup: { enabled: true } } }).expect(422);
    expect(noAddr.body.error.code).toBe('PICKUP_ADDRESS_REQUIRED');
    await ctx
      .http()
      .patch(api('/brands/me'))
      .set(auth(store.owner.token))
      .send({ settings: { pickup: { enabled: true, address: '12 شارع التسعين، التجمع', governorate: 'CAI', hours: 'يومياً 12 ظ - 10 م' } } })
      .expect(200);
    const pub = await ctx.http().get(api(`/brands/${store.slug}`)).expect(200);
    expect(pub.body.data.shipping.pickup).toMatchObject({ enabled: true, address: '12 شارع التسعين، التجمع' });

    const needAddr = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({}).expect(400);
    expect(needAddr.body.error.code).toBe('VALIDATION_ERROR');
    const quote = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ fulfillment: 'PICKUP' }).expect(200);
    expect(quote.body.data).toMatchObject({ subtotal: 200, shippingFee: 0, grandTotal: 200, fulfillment: 'PICKUP' });

    const order = await place(store.brandId, c, { fulfillment: 'PICKUP' });
    expect(order.status).toBe(201);
    const detail = await ctx.http().get(api(`/orders/me/${order.body.data.id}`)).set(auth(c.token)).expect(200);
    expect(detail.body.data).toMatchObject({ fulfillment: 'PICKUP', address: null, shippingFee: 0, pickup: { address: '12 شارع التسعين، التجمع', hours: 'يومياً 12 ظ - 10 م' } });
  });

  // ---------------------------------------------------------------- AI drafts

  it('drafts a product from a photo within the daily limit', async () => {
    const store = await onboardBrand('AI Store', 'BRAND');
    const status = await ctx.http().get(api('/brand/ai/status')).set(auth(store.owner.token)).expect(200);
    expect(status.body.data).toEqual({ enabled: true, remaining: 30, dailyLimit: 30 });

    const photo = await upload(ctx, store.owner.token, 'PRODUCT_IMAGE');
    const draft = await ctx.http().post(api('/brand/ai/product-draft')).set(auth(store.owner.token)).send({ imageFileId: photo }).expect(201);
    // Cleaned up: trimmed, de-duplicated, and a category the store actually has.
    expect(draft.body.data).toEqual({
      title: 'تيشيرت قطن أسود',
      description: 'تيشيرت قطن 100% مريح للخروج والبيت.',
      categoryId,
      colors: ['أسود', 'أبيض'],
      sizes: ['M', 'L', 'XL'],
      tags: ['تيشيرت', 'قطن', 'صيفي'],
    });
    expect((await ctx.http().get(api('/brand/ai/status')).set(auth(store.owner.token)).expect(200)).body.data.remaining).toBe(29);

    // Someone else's photo is refused; a failed model call doesn't use up the quota.
    const other = await registerUser(ctx, 'Stranger');
    const theirs = await upload(ctx, other.token, 'PRODUCT_IMAGE');
    await ctx.http().post(api('/brand/ai/product-draft')).set(auth(store.owner.token)).send({ imageFileId: theirs }).expect(422);
    fakeAi.fail = true;
    const failed = await ctx.http().post(api('/brand/ai/product-draft')).set(auth(store.owner.token)).send({ imageFileId: photo }).expect(502);
    expect(failed.body.error.code).toBe('AI_FAILED');
    fakeAi.fail = false;
    expect((await ctx.http().get(api('/brand/ai/status')).set(auth(store.owner.token)).expect(200)).body.data.remaining).toBe(29);

    const usage = ctx.app.get<Model<AiUsage>>(getModelToken(AiUsage.name));
    await usage.updateMany({}, { $set: { count: 30 } });
    const limited = await ctx.http().post(api('/brand/ai/product-draft')).set(auth(store.owner.token)).send({ imageFileId: photo }).expect(422);
    expect(limited.body.error.code).toBe('AI_DAILY_LIMIT');

    fakeAi.enabled = false;
    expect((await ctx.http().get(api('/brand/ai/status')).set(auth(store.owner.token)).expect(200)).body.data.enabled).toBe(false);
    await ctx.http().post(api('/brand/ai/product-draft')).set(auth(store.owner.token)).send({ imageFileId: photo }).expect(503);
    fakeAi.enabled = true;
    // Customers can't use it.
    await ctx.http().get(api('/brand/ai/status')).set(auth(other.token)).expect(403);
  });

  // ---------------------------------------------------------------- Alerts & following

  it('alerts when a size is back in stock and when the price drops', async () => {
    const store = await onboardBrand('Alert Store', 'BRAND');
    const product = (await createProduct(store.owner.token, { variants: [{ size: 'M', stock: 5 }, { size: 'L', stock: 0 }] }, 201)).body.data;
    const [m, l] = product.variants.map((v: any) => v._id);
    const c = await registerUser(ctx, 'Watcher');

    const inStock = await ctx.http().post(api(`/products/${product._id}/alerts`)).set(auth(c.token)).send({ type: 'BACK_IN_STOCK', variantId: m }).expect(422);
    expect(inStock.body.error.code).toBe('ALREADY_IN_STOCK');
    await ctx.http().post(api(`/products/${product._id}/alerts`)).set(auth(c.token)).send({ type: 'BACK_IN_STOCK', variantId: l }).expect(201);
    await ctx.http().post(api(`/products/${product._id}/alerts`)).set(auth(c.token)).send({ type: 'PRICE_DROP' }).expect(201);
    expect((await ctx.http().get(api(`/products/${product._id}/alerts/me`)).set(auth(c.token)).expect(200)).body.data).toHaveLength(2);

    expect(await notificationTypes(c.token)).not.toContain('BACK_IN_STOCK');
    await ctx.http().post(api(`/brand/products/${product._id}/variants/${l}/stock`)).set(auth(store.owner.token)).send({ delta: 3 }).expect(200);
    expect(await notificationTypes(c.token)).toContain('BACK_IN_STOCK');
    expect(ctx.contact.sent.some((s) => s.message.includes('رجع متوفر'))).toBe(true);

    await ctx.http().patch(api(`/brand/products/${product._id}`)).set(auth(store.owner.token)).send({ price: 85 }).expect(200);
    expect(await notificationTypes(c.token)).toContain('PRICE_DROP');
    const mine = await ctx.http().get(api('/alerts/me')).set(auth(c.token)).expect(200);
    // The stock alert is done; the price alert keeps watching from the new price.
    expect(mine.body.data).toEqual([expect.objectContaining({ type: 'PRICE_DROP', watchedPrice: 85, price: 85 })]);

    await ctx.http().post(api(`/products/${product._id}/alerts/remove`)).set(auth(c.token)).send({ type: 'PRICE_DROP' }).expect(204);
    expect((await ctx.http().get(api('/alerts/me')).set(auth(c.token)).expect(200)).body.data).toHaveLength(0);
  });

  it('tells followers about new products and shows them in the following feed', async () => {
    const store = await onboardBrand('Followed Brand', 'BRAND');
    const fan = await registerUser(ctx, 'Fan');

    expect((await ctx.http().get(api(`/brands/${store.brandId}/follow`)).expect(200)).body.data).toEqual({ following: false, followers: 0 });
    await ctx.http().post(api(`/brands/${store.brandId}/follow`)).set(auth(fan.token)).expect(200);
    await ctx.http().post(api(`/brands/${store.brandId}/follow`)).set(auth(fan.token)).expect(200); // idempotent
    expect((await ctx.http().get(api(`/brands/${store.brandId}/follow`)).set(auth(fan.token)).expect(200)).body.data).toEqual({ following: true, followers: 1 });

    const product = (await createProduct(store.owner.token, { title: 'جاكيت جلد' }, 201)).body.data;
    expect(await notificationTypes(fan.token)).toContain('FOLLOWED_NEW_PRODUCT');

    const brands = await ctx.http().get(api('/following/brands')).set(auth(fan.token)).expect(200);
    expect(brands.body.data).toEqual([expect.objectContaining({ id: store.brandId, name: 'Followed Brand' })]);
    const feed = await ctx.http().get(api('/following/products')).set(auth(fan.token)).expect(200);
    expect(feed.body.data[0]).toMatchObject({ id: product._id, title: 'جاكيت جلد' });

    await ctx.http().delete(api(`/brands/${store.brandId}/follow`)).set(auth(fan.token)).expect(200);
    expect((await ctx.http().get(api('/following/products')).set(auth(fan.token)).expect(200)).body.data).toHaveLength(0);
  });
});
