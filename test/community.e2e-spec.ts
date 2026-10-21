import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

/** Batch 5: gift orders, Fatrina points, and resellers. */
describe('Fatrina gifts, points and resellers (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let categoryId: string;

  const api = (path: string) => `/api/v1${path}`;
  const lastCode = () => ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await loginAdmin(ctx);
    const cats = await ctx.http().get(api('/categories')).expect(200);
    categoryId = cats.body.data[0]._id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function onboardBrand(name: string, settings: Record<string, unknown> = {}) {
    const owner = await registerUser(ctx, `${name} Owner`);
    const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
    const applied = await ctx
      .http()
      .post(api('/brand-applications'))
      .set(auth(owner.token))
      .send({ storeType: 'BRAND', name, categoryIds: [categoryId], contact: { phone: '01011112222' }, logoFileId })
      .expect(201);
    const brandId = applied.body.data.id as string;
    await ctx.http().post(api(`/admin/brands/${brandId}/approve`)).set(auth(admin)).expect(200);
    await ctx
      .http()
      .patch(api('/brands/me'))
      .set(auth(owner.token))
      .send({ settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null, ...settings } })
      .expect(200);
    return { owner, brandId };
  }

  async function createProduct(token: string, body: Record<string, unknown> = {}) {
    const imageFileId = await upload(ctx, token, 'PRODUCT_IMAGE');
    const res = await ctx
      .http()
      .post(api('/brand/products'))
      .set(auth(token))
      .send({ title: 'بلوفر صوف', categoryId, price: 500, imageFileIds: [imageFileId], variants: [{ size: 'M', stock: 100 }], status: 'ACTIVE', ...body })
      .expect(201);
    return res.body.data;
  }

  const newCustomer = async (name: string) => {
    const c = await registerUser(ctx, name);
    const addr = await ctx
      .http()
      .post(api('/addresses/me'))
      .set(auth(c.token))
      .send({ recipientName: name, phone: '01022225555', governorate: 'CAI', city: 'Zamalek', street: '3 Street', location: { lat: 30, lng: 31 } })
      .expect(201);
    return { ...c, addressId: addr.body.data.id as string };
  };

  let keySeq = 0;
  const order = async (store: { brandId: string }, product: any, c: { token: string; addressId: string }, qty: number, extra: Record<string, unknown> = {}) => {
    await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: product.variants[0]._id, quantity: qty }).expect(201);
    const res = await ctx.http().post(api(`/checkout/${store.brandId}/orders`)).set(auth(c.token)).set('Idempotency-Key', `c-${++keySeq}`).send({ addressId: c.addressId, ...extra });
    if (res.status === 201 && res.body.data.status === 'AWAITING_CONFIRMATION') {
      await ctx.http().post(api('/orders/me/confirm')).set(auth(c.token)).send({ code: lastCode() }).expect(200);
    }
    return res;
  };
  const deliver = async (store: { owner: { token: string } }, id: string) => {
    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      await ctx.http().patch(api(`/brand/orders/${id}/status`)).set(auth(store.owner.token)).send({ status }).expect(200);
    }
  };
  const balanceOf = async (token: string) => (await ctx.http().get(api('/brand/commissions')).set(auth(token)).expect(200)).body.data.balance as number;
  const points = async (token: string) => (await ctx.http().get(api('/points/me')).set(auth(token)).expect(200)).body.data;

  it('sends an order as a gift with a card message and no prices on the parcel', async () => {
    const store = await onboardBrand('Gift Shop');
    const product = await createProduct(store.owner.token);
    const c = await newCustomer('Gift Giver');
    const res = await order(store, product, c, 1, { gift: { message: 'كل سنة وانتي طيبة يا ماما ❤️' } });
    expect(res.status).toBe(201);
    const seen = await ctx.http().get(api(`/brand/orders/${res.body.data.id}`)).set(auth(store.owner.token)).expect(200);
    expect(seen.body.data.gift).toEqual({ message: 'كل سنة وانتي طيبة يا ماما ❤️', hidePrices: true });
  });

  it('earns points on delivery and spends them at another store, paid for by Fatrina', async () => {
    const first = await onboardBrand('Points Store A');
    const second = await onboardBrand('Points Store B');
    const p1 = await createProduct(first.owner.token, { price: 1000 });
    const p2 = await createProduct(second.owner.token, { price: 500 });
    const c = await newCustomer('Points Collector');

    const o1 = await order(first, p1, c, 2);
    await deliver(first, o1.body.data.id);
    expect(await points(c.token)).toMatchObject({ balance: 200, value: 20 });
    const types = (await ctx.http().get(api('/notifications/me?limit=50')).set(auth(c.token)).expect(200)).body.data.map((n: any) => n.type);
    expect(types).toContain('POINTS_EARNED');

    await ctx.http().post(api(`/carts/${second.brandId}/items`)).set(auth(c.token)).send({ productId: p2._id, variantId: p2.variants[0]._id, quantity: 1 }).expect(201);
    const quote = await ctx.http().post(api(`/checkout/${second.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId, usePoints: true }).expect(200);
    // 20% of 500 = 100 EGP allowed, but the 200 points are worth only 20 EGP.
    expect(quote.body.data).toMatchObject({ subtotal: 500, discountTotal: 20, grandTotal: 530, points: { balance: 200, used: 200, discount: 20 } });

    const before = await balanceOf(second.owner.token);
    const o2 = await ctx.http().post(api(`/checkout/${second.brandId}/orders`)).set(auth(c.token)).set('Idempotency-Key', 'points-spend').send({ addressId: c.addressId, usePoints: true }).expect(201);
    expect(o2.body.data.points).toEqual({ used: 200, discount: 20, earned: 0 });
    expect((await points(c.token)).balance).toBe(0);

    // Cancelled before delivery: the points come back.
    await ctx.http().patch(api(`/brand/orders/${o2.body.data.id}/status`)).set(auth(second.owner.token)).send({ status: 'CANCELLED', note: 'نفدت الكمية' }).expect(200);
    expect((await points(c.token)).balance).toBe(200);

    // Spent again and delivered: the store is commissioned on the full 500 and credited the 20.
    const o3 = await order(second, p2, c, 1, { usePoints: true });
    await deliver(second, o3.body.data.id);
    const delivered = await ctx.http().get(api(`/brand/orders/${o3.body.data.id}`)).set(auth(second.owner.token)).expect(200);
    expect(delivered.body.data.commission).toEqual({ rate: 0.05, base: 500, amount: 25 });
    expect((await balanceOf(second.owner.token)) - before).toBe(5); // +25 commission, −20 points credit
    // And earned points on what was actually paid for the items (480).
    expect((await points(c.token)).balance).toBe(48);
    const history = await ctx.http().get(api('/points/me/history')).set(auth(c.token)).expect(200);
    expect(history.body.data.map((e: any) => e.type)).toEqual(['EARN', 'REDEEM', 'REFUND', 'REDEEM', 'EARN']);
  });

  it('lets a reseller sell at their own price and pays out the margin after delivery', async () => {
    const store = await onboardBrand('Wholesale Partner', { allowResellers: true });
    const closed = await onboardBrand('No Resellers');
    const product = await createProduct(store.owner.token, { price: 400 });
    const other = await createProduct(closed.owner.token, { price: 400 });
    const reseller = await newCustomer('Reseller Ahmed');

    // Store accounts can't resell; customers join with a payout address.
    await ctx.http().post(api('/reseller/join')).set(auth(store.owner.token)).send({ payoutAddress: 'x@instapay', payoutName: 'X' }).expect(403);
    expect((await ctx.http().get(api('/reseller/me')).set(auth(reseller.token)).expect(200)).body.data).toEqual({ joined: false });
    const joined = await ctx.http().post(api('/reseller/join')).set(auth(reseller.token)).send({ payoutAddress: 'ahmed@instapay', payoutName: 'Ahmed Ali' }).expect(200);
    expect(joined.body.data).toMatchObject({ joined: true, status: 'ACTIVE', wallet: { available: 0 } });

    const catalog = await ctx.http().get(api('/products?resellable=true')).expect(200);
    const ids = catalog.body.data.map((p: any) => p.id);
    expect(ids).toContain(product._id);
    expect(ids).not.toContain(other._id);

    const variantId = product.variants[0]._id;
    const resale = (price: number) => ({ customerName: 'منى حسن', customerPhone: '01155554444', prices: [{ variantId, price }] });
    await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(reseller.token)).send({ productId: product._id, variantId, quantity: 2 }).expect(201);
    const low = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(reseller.token)).send({ addressId: reseller.addressId, resale: resale(350) }).expect(422);
    expect(low.body.error.code).toBe('RESALE_PRICE_INVALID');
    const quote = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(reseller.token)).send({ addressId: reseller.addressId, resale: resale(480) }).expect(200);
    expect(quote.body.data).toMatchObject({ subtotal: 960, shippingFee: 50, grandTotal: 1010, resale: { margin: 160, storeSubtotal: 800 } });

    // Another store that doesn't work with resellers refuses.
    await ctx.http().post(api(`/carts/${closed.brandId}/items`)).set(auth(reseller.token)).send({ productId: other._id, variantId: other.variants[0]._id, quantity: 1 }).expect(201);
    const refused = await ctx.http().post(api(`/checkout/${closed.brandId}/quote`)).set(auth(reseller.token)).send({ addressId: reseller.addressId, resale: { ...resale(500), prices: [] } }).expect(422);
    expect(refused.body.error.code).toBe('RESALE_NOT_ALLOWED');

    const placed = await ctx.http().post(api(`/checkout/${store.brandId}/orders`)).set(auth(reseller.token)).set('Idempotency-Key', 'resale-1').send({ addressId: reseller.addressId, resale: resale(480) }).expect(201);
    if (placed.body.data.status === 'AWAITING_CONFIRMATION') await ctx.http().post(api('/orders/me/confirm')).set(auth(reseller.token)).send({ code: lastCode() }).expect(200);
    const id = placed.body.data.id;
    const seen = await ctx.http().get(api(`/brand/orders/${id}`)).set(auth(store.owner.token)).expect(200);
    expect(seen.body.data).toMatchObject({ customer: { name: 'منى حسن' }, resale: { margin: 160 }, grandTotal: 1010 });
    expect(seen.body.data.items[0]).toMatchObject({ unitPrice: 480, storeUnitPrice: 400 });
    expect((await ctx.http().get(api('/reseller/me')).set(auth(reseller.token)).expect(200)).body.data.wallet).toMatchObject({ pending: 160, available: 0 });

    const before = await balanceOf(store.owner.token);
    await deliver(store, id);
    const done = await ctx.http().get(api(`/brand/orders/${id}`)).set(auth(store.owner.token)).expect(200);
    // Commission only on the store's own price (800), plus the margin it collected for the reseller.
    expect(done.body.data.commission).toEqual({ rate: 0.05, base: 800, amount: 40 });
    expect((await balanceOf(store.owner.token)) - before).toBe(200);
    // Resellers don't earn customer points on their customers' orders.
    expect((await points(reseller.token)).balance).toBe(0);

    const me = await ctx.http().get(api('/reseller/me')).set(auth(reseller.token)).expect(200);
    expect(me.body.data.wallet).toMatchObject({ pending: 0, available: 160 });
    const payout = await ctx.http().post(api('/reseller/payouts')).set(auth(reseller.token)).expect(201);
    expect(payout.body.data).toMatchObject({ amount: 160, payoutAddress: 'ahmed@instapay', status: 'REQUESTED' });
    await ctx.http().post(api('/reseller/payouts')).set(auth(reseller.token)).expect(422); // nothing left

    const queue = await ctx.http().get(api('/admin/resellers/payouts?status=REQUESTED')).set(auth(admin)).expect(200);
    expect(queue.body.data[0]).toMatchObject({ amount: 160, reseller: { name: 'Reseller Ahmed' } });
    await ctx.http().post(api(`/admin/resellers/payouts/${payout.body.data._id}/paid`)).set(auth(admin)).send({ reference: 'IP-998877' }).expect(200);
    expect((await ctx.http().get(api('/reseller/me')).set(auth(reseller.token)).expect(200)).body.data.wallet).toMatchObject({ available: 0, paid: 160 });
  });
});
