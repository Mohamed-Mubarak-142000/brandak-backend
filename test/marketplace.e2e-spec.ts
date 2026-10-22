import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Brand } from '@/brands/brand.schema';
import { CartsService } from '@/carts/carts.service';
import { OrdersService } from '@/orders/orders.service';
import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

/**
 * Full marketplace journey: store onboarding → catalog → per-store cart → checkout (with email
 * confirmation for new customers) → fulfilment → 5% commission on delivery → settlement, plus
 * the security rules around each step.
 */
describe('Fatrina marketplace (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let categoryId: string;
  let growthPlanId: string;

  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await loginAdmin(ctx);
    const cats = await ctx.http().get(api('/categories')).expect(200);
    categoryId = cats.body.data[0]._id;
    const plans = await ctx.http().get(api('/subscription-plans')).expect(200);
    growthPlanId = plans.body.data.find((p: any) => p.code === 'GROWTH')._id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /** Opens a store and gets it approved (no plan or payment: the platform takes a commission). */
  async function onboardBrand(name: string, opts: { storeType?: string } = {}) {
    const owner = await registerUser(ctx, `${name} Owner`);
    const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
    const applied = await ctx
      .http()
      .post(api('/brand-applications'))
      .set(auth(owner.token))
      .send({ storeType: opts.storeType ?? 'BRAND', name, categoryIds: [categoryId], contact: { phone: '01011112222' }, logoFileId })
      .expect(201);
    const brandId = applied.body.data.id;
    await ctx.http().post(api(`/admin/brands/${brandId}/approve`)).set(auth(admin)).expect(200);
    await ctx
      .http()
      .patch(api('/brands/me'))
      .set(auth(owner.token))
      .send({ settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null } })
      .expect(200);
    return { owner, brandId, slug: applied.body.data.slug as string };
  }

  async function createProduct(token: string, body: Record<string, unknown> = {}) {
    const imageFileId = await upload(ctx, token, 'PRODUCT_IMAGE');
    const res = await ctx
      .http()
      .post(api('/brand/products'))
      .set(auth(token))
      .send({
        title: 'تيشيرت قطن',
        categoryId,
        price: 350,
        imageFileIds: [imageFileId],
        variants: [
          { size: 'M', color: 'أسود', stock: 5 },
          { size: 'L', color: 'أسود', stock: 1 },
        ],
        status: 'ACTIVE',
        ...body,
      });
    return res;
  }

  /** The latest emailed code (tests run without SMTP, so codes land in the log channel). */
  const lastCode = () => ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];

  // ---------------------------------------------------------------- Auth

  describe('auth', () => {
    it('registers, logs in and returns the profile', async () => {
      const u = await registerUser(ctx, 'Ahmed');
      const me = await ctx.http().get(api('/users/me')).set(auth(u.token)).expect(200);
      expect(me.body).toMatchObject({ success: true, data: { name: 'Ahmed', brand: null } });
      expect(me.body.meta.requestId).toBeDefined();

      await ctx.http().post(api('/auth/login')).send({ identifier: u.phone, password: 'Passw0rd!' }).expect(200);
      const bad = await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'wrong-pass1' }).expect(401);
      expect(bad.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    });

    it('rejects duplicate accounts and invalid phones', async () => {
      const u = await registerUser(ctx);
      await ctx
        .http()
        .post(api('/auth/register'))
        .send({ name: 'Dup', email: u.email, phone: '01099999999', password: 'Passw0rd!' })
        .expect(409);
      const res = await ctx
        .http()
        .post(api('/auth/register'))
        .send({ name: 'Bad', email: 'bad@test.dev', phone: '12345', password: 'Passw0rd!' })
        .expect(422);
      expect(res.body.error.code).toBe('INVALID_PHONE');
    });

    it('rotates refresh tokens and revokes the session when an old one is reused', async () => {
      const u = await registerUser(ctx);
      const refresh = (refreshToken: string) => ctx.http().post(api('/auth/refresh')).send({ refreshToken });
      const r1 = await refresh(u.refresh).expect(200);
      const r2 = await refresh(r1.body.data.refreshToken).expect(200);
      // Reusing a token that was rotated twice over signals theft: the whole session is revoked.
      await refresh(u.refresh).expect(401);
      await refresh(r2.body.data.refreshToken).expect(401);
      await ctx.http().get(api('/users/me')).set(auth(r2.body.data.accessToken)).expect(401);
    });

    it('gives concurrent refreshes with the same token the same rotated token', async () => {
      const u = await registerUser(ctx);
      const refresh = (refreshToken: string) => ctx.http().post(api('/auth/refresh')).send({ refreshToken });
      const results = await Promise.all([refresh(u.refresh), refresh(u.refresh), refresh(u.refresh)]);
      for (const r of results) expect(r.status).toBe(200);
      const tokens = new Set(results.map((r) => r.body.data.refreshToken));
      expect(tokens.size).toBe(1);
      // The session survived and the shared token keeps rotating.
      await refresh([...tokens][0]).expect(200);
    });

    it('verifies the phone with a one-time code and resets the password', async () => {
      const u = await registerUser(ctx);
      await ctx.http().post(api('/auth/verify-contact/request')).set(auth(u.token)).send({ channel: 'phone' }).expect(204);
      const code = ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];
      await ctx.http().post(api('/auth/verify-contact')).set(auth(u.token)).send({ channel: 'phone', code: code === '000000' ? '111111' : '000000' }).expect(400);
      const ok = await ctx.http().post(api('/auth/verify-contact')).set(auth(u.token)).send({ channel: 'phone', code }).expect(200);
      expect(ok.body.data.phoneVerified).toBe(true);

      await ctx.http().post(api('/auth/forgot-password')).send({ identifier: u.email }).expect(204);
      const resetCode = ctx.contact.sent.at(-1)!.message.match(/\d{6}/)![0];
      await ctx
        .http()
        .post(api('/auth/reset-password'))
        .send({ identifier: u.email, code: resetCode, newPassword: 'NewPassw0rd' })
        .expect(204);
      // Resetting the password logs out every device.
      await ctx.http().get(api('/users/me')).set(auth(u.token)).expect(401);
      await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'NewPassw0rd' }).expect(200);
      // Unknown accounts get the same answer, so the endpoint can't be used to find users.
      await ctx.http().post(api('/auth/forgot-password')).send({ identifier: 'nobody@test.dev' }).expect(204);
    });

    it('changes the password, keeping this session and signing out other devices', async () => {
      const u = await registerUser(ctx);
      const other = await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'Passw0rd!' }).expect(200);
      const wrong = await ctx
        .http()
        .post(api('/auth/change-password'))
        .set(auth(u.token))
        .send({ currentPassword: 'nope-nope1', newPassword: 'Changed123' })
        .expect(422);
      expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
      await ctx
        .http()
        .post(api('/auth/change-password'))
        .set(auth(u.token))
        .send({ currentPassword: 'Passw0rd!', newPassword: 'Changed123' })
        .expect(204);
      await ctx.http().get(api('/users/me')).set(auth(u.token)).expect(200);
      await ctx.http().get(api('/users/me')).set(auth(other.body.data.accessToken)).expect(401);
      await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'Changed123' }).expect(200);
    });

    it('keeps admin endpoints away from regular users', async () => {
      const u = await registerUser(ctx);
      await ctx.http().get(api('/admin/payments')).set(auth(u.token)).expect(403);
      await ctx.http().get(api('/admin/payments')).expect(401);
    });
  });

  // ---------------------------------------------------------------- Store onboarding

  describe('store onboarding', () => {
    it('shows a store as soon as it is approved, with no plan or payment', async () => {
      const owner = await registerUser(ctx, 'Noura');
      const applied = await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(owner.token))
        .send({ storeType: 'BRAND', name: 'Noura Handmade', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(201);
      const brand = applied.body.data;
      expect(brand).toMatchObject({ status: 'PENDING_REVIEW', slug: 'noura-handmade', isVisible: false });

      await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(owner.token))
        .send({ storeType: 'SHOP', name: 'Second', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(409);

      // Not public before approval.
      await ctx.http().get(api(`/brands/${brand.slug}`)).expect(404);
      await ctx.http().post(api(`/admin/brands/${brand.id}/approve`)).set(auth(admin)).expect(200);
      await ctx.http().post(api(`/admin/brands/${brand.id}/approve`)).set(auth(admin)).expect(409);

      const pub = await ctx.http().get(api(`/brands/${brand.slug}`)).expect(200);
      expect(pub.body.data).toMatchObject({ name: 'Noura Handmade', shipping: expect.any(Object) });
      const latin = await ctx.http().get(api('/brands?q=noura')).expect(200);
      expect(latin.body.data.map((b: any) => b.id)).toContain(brand.id);

      // Publishing needs no subscription any more.
      const p = await createProduct(owner.token);
      expect(p.status).toBe(201);

      // Older apps still send a planId; it is accepted and ignored.
      const legacy = await registerUser(ctx);
      await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(legacy.token))
        .send({ planId: growthPlanId, storeType: 'BRAND', name: 'Legacy App Store', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(201);

      const terms = await ctx.http().get(api('/platform/terms')).expect(200);
      expect(terms.body.data).toMatchObject({ commissionRate: 0.05, settlementDays: 14, maxUnpaidBalance: 2000 });
    });

    it('requires a store type and filters stores by it, counting legacy stores as brands', async () => {
      const owner = await registerUser(ctx);
      await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(owner.token))
        .send({ name: 'No Type', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(400);

      const showroom = await onboardBrand('Cairo Showroom', { storeType: 'SHOWROOM' });
      const legacy = await onboardBrand('Old Brand');
      // Simulate a store created before storeType existed.
      const brands = ctx.app.get<Model<Brand>>(getModelToken(Brand.name));
      await brands.updateOne({ _id: legacy.brandId }, { $unset: { storeType: 1 } });

      const slugs = async (q: string) =>
        (await ctx.http().get(api(`/brands?limit=100${q}`)).expect(200)).body.data.map((b: any) => b.slug);
      expect(await slugs('&storeType=SHOWROOM')).toContain(showroom.slug);
      expect(await slugs('&storeType=SHOWROOM')).not.toContain(legacy.slug);
      expect(await slugs('&storeType=BRAND')).toContain(legacy.slug);
      expect(await slugs('&storeType=BRAND')).not.toContain(showroom.slug);

      const legacyView = await ctx.http().get(api(`/brands/${legacy.slug}`)).expect(200);
      expect(legacyView.body.data).toMatchObject({ storeType: 'BRAND', socialLinks: {}, contact: expect.any(Object) });
      const admins = await ctx.http().get(api('/admin/brands?storeType=SHOWROOM&limit=100')).set(auth(admin)).expect(200);
      expect(admins.body.data.map((b: any) => b.slug)).toContain(showroom.slug);
    });

    it('offers each store type its own categories plus the shared ones', async () => {
      const slugs = async (q = '') => (await ctx.http().get(api(`/categories${q}`)).expect(200)).body.data.map((c: any) => c.slug);
      const warehouse = await slugs('?storeType=WAREHOUSE');
      expect(warehouse).toEqual(expect.arrayContaining(['groceries', 'building', 'appliances', 'other']));
      expect(warehouse).not.toContain('handmade');
      const showroom = await slugs('?storeType=SHOWROOM');
      expect(showroom).toEqual(expect.arrayContaining(['appliances', 'furniture', 'cars']));
      expect(showroom).not.toContain('groceries');
      // Without a type, every active category comes back, as before.
      expect((await slugs()).length).toBeGreaterThan(warehouse.length);
      await ctx.http().get(api('/categories?storeType=NOPE')).expect(400);
    });
  });

  // ---------------------------------------------------------------- Catalog

  describe('catalog', () => {
    it('isolates stores from each other', async () => {
      const a = await onboardBrand('Store A');
      const b = await onboardBrand('Store B');
      const p1 = await createProduct(a.owner.token);
      expect(p1.status).toBe(201);

      // Store B can neither read nor change store A's product.
      const id = p1.body.data._id;
      await ctx.http().get(api(`/brand/products/${id}`)).set(auth(b.owner.token)).expect(404);
      await ctx.http().patch(api(`/brand/products/${id}`)).set(auth(b.owner.token)).send({ price: 1 }).expect(404);
      await ctx.http().delete(api(`/brand/products/${id}`)).set(auth(b.owner.token)).expect(404);
      // A brandId in the body is rejected, not trusted.
      await createProduct(b.owner.token, { brandId: a.brandId }).then((r) => expect(r.status).toBe(400));

      // Customers without a store can't reach store routes at all.
      const customer = await registerUser(ctx);
      const denied = await ctx.http().get(api('/brand/products')).set(auth(customer.token)).expect(403);
      expect(denied.body.error.code).toBe('NO_BRAND');
    });

    it('filters products by several categories at once', async () => {
      const cats = (await ctx.http().get(api('/categories')).expect(200)).body.data;
      const ids = cats.slice(0, 2).map((c: any) => c._id).join(',');
      await ctx.http().get(api(`/products?categoryIds=${ids}`)).expect(200);
      await ctx.http().get(api('/products?categoryIds=nope')).expect(400);
    });

    it('searches published products with Arabic normalization and filters', async () => {
      const { owner, slug } = await onboardBrand('Search Brand');
      await createProduct(owner.token, { title: 'شنطة جلد طبيعي', price: 900, tags: ['حقائب'] }).then((r) => expect(r.status).toBe(201));
      await createProduct(owner.token, { title: 'Hidden draft', status: 'DRAFT' });

      const found = await ctx.http().get(api('/products?q=شنطه')).expect(200);
      expect(found.body.data.map((p: any) => p.title)).toContain('شنطة جلد طبيعي');
      const priced = await ctx.http().get(api('/products?minPrice=800&maxPrice=1000&sort=price_desc')).expect(200);
      expect(priced.body.data.every((p: any) => p.price >= 800 && p.price <= 1000)).toBe(true);
      const brandProducts = await ctx.http().get(api(`/brands/${slug}/products`)).expect(200);
      expect(brandProducts.body.data.map((p: any) => p.title)).not.toContain('Hidden draft');
    });
  });

  // ---------------------------------------------------------------- Shopping & orders

  describe('cart, checkout and orders', () => {
    let shop: Awaited<ReturnType<typeof onboardBrand>>;
    let other: Awaited<ReturnType<typeof onboardBrand>>;
    let product: any;
    let customer: Awaited<ReturnType<typeof registerUser>>;
    let addressId: string;

    beforeAll(async () => {
      shop = await onboardBrand('Cotton Shop');
      other = await onboardBrand('Second Shop');
      product = (await createProduct(shop.owner.token)).body.data;
      customer = await registerUser(ctx, 'Mona');
      const addr = await ctx
        .http()
        .post(api('/addresses/me'))
        .set(auth(customer.token))
        .send({
          recipientName: 'Mona',
          phone: '01022223333',
          governorate: 'CAI',
          city: 'Nasr City',
          street: '10 Abbas El Akkad',
          location: { lat: 30.0566, lng: 31.3301 },
        })
        .expect(201);
      addressId = addr.body.data.id;
      expect(addr.body.data.isDefault).toBe(true);
    });

    const variant = (i: number) => product.variants[i]._id;
    const stockOf = async (i: number) => {
      const res = await ctx.http().get(api(`/brand/products/${product._id}`)).set(auth(shop.owner.token)).expect(200);
      return res.body.data.variants[i].stock as number;
    };
    /** Confirms whatever the customer is holding with the emailed code, if anything. */
    const confirmIfNeeded = async (status: string) => {
      if (status === 'AWAITING_CONFIRMATION') {
        await ctx.http().post(api('/orders/me/confirm')).set(auth(customer.token)).send({ code: lastCode() }).expect(200);
      }
    };

    it('keeps store accounts out of shopping', async () => {
      const denied = await ctx
        .http()
        .post(api(`/carts/${other.brandId}/items`))
        .set(auth(shop.owner.token))
        .send({ productId: product._id, variantId: variant(0), quantity: 1 })
        .expect(403);
      expect(denied.body.error.code).toBe('SELLER_ACCOUNT');
      await ctx.http().get(api('/wishlists/me')).set(auth(shop.owner.token)).expect(403);
      await ctx.http().post(api(`/checkout/${other.brandId}/quote`)).set(auth(shop.owner.token)).send({ addressId }).expect(403);
    });

    it('keeps one cart per brand and validates items against that brand', async () => {
      await ctx
        .http()
        .post(api(`/carts/${other.brandId}/items`))
        .set(auth(customer.token))
        .send({ productId: product._id, variantId: variant(0), quantity: 1 })
        .expect(404);
      await ctx
        .http()
        .post(api(`/carts/${shop.brandId}/items`))
        .set(auth(customer.token))
        .send({ productId: product._id, variantId: variant(0), quantity: 99 })
        .expect(422); // above the per-line maximum (wholesale products allow more)
      const cart = await ctx
        .http()
        .post(api(`/carts/${shop.brandId}/items`))
        .set(auth(customer.token))
        .send({ productId: product._id, variantId: variant(0), quantity: 2 })
        .expect(201);
      expect(cart.body.data).toMatchObject({ subtotal: 700, hasIssues: false });
      const carts = await ctx.http().get(api('/carts')).set(auth(customer.token)).expect(200);
      expect(carts.body.data).toHaveLength(1);
    });

    it('holds a new customer\'s order until it is confirmed with the emailed code', async () => {
      const quote = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/quote`))
        .set(auth(customer.token))
        .send({ addressId })
        .expect(200);
      expect(quote.body.data).toMatchObject({ subtotal: 700, shippingFee: 50, grandTotal: 750 });

      await ctx.http().post(api(`/checkout/${shop.brandId}/orders`)).set(auth(customer.token)).send({ addressId }).expect(422);

      const changed = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/orders`))
        .set(auth(customer.token))
        .set('Idempotency-Key', 'order-price-check')
        .send({ addressId, expectedTotal: 700 })
        .expect(409);
      expect(changed.body.error.code).toBe('PRICE_CHANGED');
      expect(await stockOf(0)).toBe(5); // the failed attempt rolled back

      const first = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/orders`))
        .set(auth(customer.token))
        .set('Idempotency-Key', 'order-1')
        .send({ addressId, expectedTotal: 750 })
        .expect(201);
      // Mona has never received an order, so she confirms this one first.
      expect(first.body.data).toMatchObject({ status: 'AWAITING_CONFIRMATION', grandTotal: 750, paymentMethod: 'COD' });
      expect(first.body.data.orderNumber).toMatch(/^BR-\d{6}$/);
      expect(await stockOf(0)).toBe(3); // stock is held meanwhile

      // The store doesn't see it yet.
      const before = await ctx.http().get(api('/brand/orders')).set(auth(shop.owner.token)).expect(200);
      expect(before.body.data.map((o: any) => o.id)).not.toContain(first.body.data.id);
      await ctx.http().get(api(`/brand/orders/${first.body.data.id}`)).set(auth(shop.owner.token)).expect(404);

      const retry = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/orders`))
        .set(auth(customer.token))
        .set('Idempotency-Key', 'order-1')
        .send({ addressId })
        .expect(201);
      expect(retry.body.data.id).toBe(first.body.data.id);
      expect(await stockOf(0)).toBe(3);
      const carts = await ctx.http().get(api('/carts')).set(auth(customer.token)).expect(200);
      expect(carts.body.data).toHaveLength(0);

      const code = lastCode();
      await ctx.http().post(api('/orders/me/confirm')).set(auth(customer.token)).send({ code: code === '000000' ? '111111' : '000000' }).expect(400);
      const confirmed = await ctx.http().post(api('/orders/me/confirm')).set(auth(customer.token)).send({ code }).expect(200);
      expect(confirmed.body.data.map((o: any) => o.status)).toEqual(['PENDING']);

      // Now it reached the store, with the customer's track record.
      const seen = await ctx.http().get(api(`/brand/orders/${first.body.data.id}`)).set(auth(shop.owner.token)).expect(200);
      expect(seen.body.data.customerTrust).toEqual({ delivered: 0, refused: 0, level: 'NEW' });
      const notes = await ctx.http().get(api('/notifications/me')).set(auth(shop.owner.token)).expect(200);
      expect(notes.body.data.some((n: any) => n.type === 'ORDER_PLACED')).toBe(true);
    });

    it('cancels orders nobody confirmed within a day and releases their stock', async () => {
      const buyer = await registerUser(ctx, 'Late Buyer');
      const addr = await ctx
        .http()
        .post(api('/addresses/me'))
        .set(auth(buyer.token))
        .send({ recipientName: 'Late', phone: '01022224444', governorate: 'CAI', city: 'Maadi', street: '9 Road', location: { lat: 30, lng: 31 } })
        .expect(201);
      await ctx.http().post(api(`/carts/${shop.brandId}/items`)).set(auth(buyer.token)).send({ productId: product._id, variantId: variant(0), quantity: 1 }).expect(201);
      const before = await stockOf(0);
      const order = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/orders`))
        .set(auth(buyer.token))
        .set('Idempotency-Key', 'late-1')
        .send({ addressId: addr.body.data.id })
        .expect(201);
      expect(order.body.data.status).toBe('AWAITING_CONFIRMATION');
      expect(await stockOf(0)).toBe(before - 1);

      await ctx.app.get(OrdersService).expireUnconfirmed(new Date(Date.now() + 25 * 3_600_000));
      const after = await ctx.http().get(api(`/orders/me/${order.body.data.id}`)).set(auth(buyer.token)).expect(200);
      expect(after.body.data.status).toBe('CANCELLED');
      expect(await stockOf(0)).toBe(before);
    });

    it('never oversells: a checkout exceeding stock fails without touching inventory', async () => {
      await ctx
        .http()
        .post(api(`/carts/${shop.brandId}/items`))
        .set(auth(customer.token))
        .send({ productId: product._id, variantId: variant(1), quantity: 1 })
        .expect(201);
      // The brand sells the last piece elsewhere before the customer checks out.
      await ctx
        .http()
        .post(api(`/brand/products/${product._id}/variants/${variant(1)}/stock`))
        .set(auth(shop.owner.token))
        .send({ delta: -1 })
        .expect(200);
      const res = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/orders`))
        .set(auth(customer.token))
        .set('Idempotency-Key', 'order-oversell')
        .send({ addressId })
        .expect(409);
      expect(res.body.error.code).toBe('CART_HAS_ISSUES');
      expect(await stockOf(1)).toBe(0);
      await ctx
        .http()
        .post(api(`/brand/products/${product._id}/variants/${variant(1)}/stock`))
        .set(auth(shop.owner.token))
        .send({ delta: -1 })
        .expect(422); // stock can't go negative
      await ctx.http().delete(api(`/carts/${shop.brandId}`)).set(auth(customer.token)).expect(204);
    });

    it('moves orders through the lifecycle, charges 5% on delivery, and allows reviews after it', async () => {
      const place = async (key: string) => {
        await ctx
          .http()
          .post(api(`/carts/${shop.brandId}/items`))
          .set(auth(customer.token))
          .send({ productId: product._id, variantId: variant(0), quantity: 1 })
          .expect(201);
        const res = await ctx
          .http()
          .post(api(`/checkout/${shop.brandId}/orders`))
          .set(auth(customer.token))
          .set('Idempotency-Key', key)
          .send({ addressId })
          .expect(201);
        await confirmIfNeeded(res.body.data.status);
        return res.body.data.id as string;
      };
      const setStatus = (id: string, status: string, note?: string) =>
        ctx.http().patch(api(`/brand/orders/${id}/status`)).set(auth(shop.owner.token)).send({ status, note });

      const orderId = await place('lifecycle-1');
      await setStatus(orderId, 'SHIPPED').expect(409); // can't skip steps
      // Not reviewable before delivery.
      await ctx.http().post(api(`/products/${product._id}/reviews`)).set(auth(customer.token)).send({ orderId, rating: 5 }).expect(403);
      // Customers can't cancel once the brand confirmed.
      await setStatus(orderId, 'CONFIRMED').expect(200);
      // Admins can only delete finished orders.
      const inProgress = await ctx.http().post(api(`/admin/orders/${orderId}/delete`)).set(auth(admin)).expect(409);
      expect(inProgress.body.error.code).toBe('ORDER_IN_PROGRESS');
      await ctx.http().post(api(`/orders/me/${orderId}/cancel`)).set(auth(customer.token)).send({}).expect(409);
      await setStatus(orderId, 'PROCESSING').expect(200);
      await setStatus(orderId, 'SHIPPED').expect(200);
      const delivered = await setStatus(orderId, 'DELIVERED').expect(200);
      expect(delivered.body.data).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID', allowedNextStatuses: [] });
      // 5% of the items (350), never of shipping.
      expect(delivered.body.data.commission).toEqual({ rate: 0.05, base: 350, amount: 17.5 });
      const owed = await ctx.http().get(api('/brand/commissions')).set(auth(shop.owner.token)).expect(200);
      expect(owed.body.data).toMatchObject({ balance: 17.5, blocked: false });
      expect(owed.body.data.dueBy).toBeDefined();
      // The customer never sees the store's commission.
      const mine = await ctx.http().get(api(`/orders/me/${orderId}`)).set(auth(customer.token)).expect(200);
      expect(mine.body.data.commission).toBeUndefined();

      // Soft delete hides the order from the customer, the store and the admin list; restore brings it back.
      await ctx.http().post(api(`/admin/orders/${orderId}/delete`)).set(auth(admin)).expect(200);
      await ctx.http().get(api(`/orders/me/${orderId}`)).set(auth(customer.token)).expect(404);
      await ctx.http().get(api(`/brand/orders/${orderId}`)).set(auth(shop.owner.token)).expect(404);
      const deletedOrders = await ctx.http().get(api('/admin/orders?deleted=true&limit=100')).set(auth(admin)).expect(200);
      expect(deletedOrders.body.data.map((o: any) => o.id)).toContain(orderId);
      await ctx.http().post(api(`/admin/orders/${orderId}/restore`)).set(auth(admin)).expect(200);
      await ctx.http().get(api(`/orders/me/${orderId}`)).set(auth(customer.token)).expect(200);
      expect(delivered.body.data.history.map((h: any) => h.status)).toEqual([
        'AWAITING_CONFIRMATION',
        'PENDING',
        'CONFIRMED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
      ]);

      // The other brand can't see or touch this order.
      await ctx.http().get(api(`/brand/orders/${orderId}`)).set(auth(other.owner.token)).expect(404);

      const review = await ctx
        .http()
        .post(api(`/products/${product._id}/reviews`))
        .set(auth(customer.token))
        .send({ orderId, rating: 4, comment: 'خامة ممتازة' })
        .expect(201);
      expect(review.body.data.verifiedPurchase).toBe(true);
      await ctx.http().post(api(`/products/${product._id}/reviews`)).set(auth(customer.token)).send({ orderId, rating: 1 }).expect(409);
      const reviews = await ctx.http().get(api(`/products/${product._id}/reviews`)).expect(200);
      expect(reviews.body.meta.stars['4']).toBe(1);
      const pub = await ctx.http().get(api(`/products/${product._id}`)).expect(200);
      expect(pub.body.data).toMatchObject({ ratingAvg: 4, ratingCount: 1 });

      // Reports reach the moderation queue with a summary of what was reported.
      await ctx
        .http()
        .post(api('/reports'))
        .set(auth(shop.owner.token))
        .send({ targetType: 'REVIEW', targetId: review.body.data.id, reason: 'FAKE' })
        .expect(201);
      const queue = await ctx.http().get(api('/admin/reports?status=OPEN')).set(auth(admin)).expect(200);
      const reported = queue.body.data.find((r: any) => r.targetId === review.body.data.id);
      expect(reported.target).toMatchObject({ title: 'خامة ممتازة', subtitle: 'Mona' });
      expect(reported.reporter.name).toBe('Cotton Shop Owner');

      // Mona received an order now, so her next one goes straight to the store.
      await ctx.http().post(api(`/carts/${shop.brandId}/items`)).set(auth(customer.token)).send({ productId: product._id, variantId: variant(0), quantity: 1 }).expect(201);
      const before = await stockOf(0);
      const direct = await ctx
        .http()
        .post(api(`/checkout/${shop.brandId}/orders`))
        .set(auth(customer.token))
        .set('Idempotency-Key', 'lifecycle-2')
        .send({ addressId })
        .expect(201);
      expect(direct.body.data.status).toBe('PENDING');
      const second = direct.body.data.id as string;
      expect(await stockOf(0)).toBe(before - 1);
      await setStatus(second, 'CANCELLED').expect(422); // brand must give a reason
      await ctx.http().post(api(`/orders/me/${second}/cancel`)).set(auth(customer.token)).send({ reason: 'changed my mind' }).expect(200);
      expect(await stockOf(0)).toBe(before);

      const myOrders = await ctx.http().get(api('/orders/me')).set(auth(customer.token)).expect(200);
      expect(myOrders.body.meta.total).toBeGreaterThanOrEqual(3);
      const customers = await ctx.http().get(api('/brand/customers')).set(auth(shop.owner.token)).expect(200);
      expect(customers.body.data[0]).toMatchObject({ name: 'Mona', deliveredCount: 1 });
    });

    it('records a refused parcel, restocks it, and lets the store block the customer', async () => {
      const setStatus = (id: string, status: string, note?: string) =>
        ctx.http().patch(api(`/brand/orders/${id}/status`)).set(auth(shop.owner.token)).send({ status, note });
      await ctx.http().post(api(`/carts/${shop.brandId}/items`)).set(auth(customer.token)).send({ productId: product._id, variantId: variant(0), quantity: 1 }).expect(201);
      const before = await stockOf(0);
      const res = await ctx.http().post(api(`/checkout/${shop.brandId}/orders`)).set(auth(customer.token)).set('Idempotency-Key', 'refused-1').send({ addressId }).expect(201);
      const id = res.body.data.id as string;
      await setStatus(id, 'REFUSED').expect(409); // only a shipped parcel can be refused
      for (const s of ['CONFIRMED', 'PROCESSING', 'SHIPPED']) await setStatus(id, s).expect(200);
      const refused = await setStatus(id, 'REFUSED').expect(200);
      expect(refused.body.data.commission).toBeNull(); // nothing to charge
      expect(await stockOf(0)).toBe(before);

      const seen = await ctx.http().get(api(`/brand/orders/${id}`)).set(auth(shop.owner.token)).expect(200);
      expect(seen.body.data.customerTrust).toEqual({ delivered: 1, refused: 1, level: 'RISKY' });

      await ctx.http().post(api(`/brand/orders/${id}/block-customer`)).set(auth(shop.owner.token)).send({ note: 'رفض الاستلام' }).expect(201);
      const blocks = await ctx.http().get(api('/brand/blocks')).set(auth(shop.owner.token)).expect(200);
      expect(blocks.body.data[0].customer.name).toBe('Mona');
      await ctx.http().post(api(`/carts/${shop.brandId}/items`)).set(auth(customer.token)).send({ productId: product._id, variantId: variant(0), quantity: 1 }).expect(201);
      const blocked = await ctx.http().post(api(`/checkout/${shop.brandId}/orders`)).set(auth(customer.token)).set('Idempotency-Key', 'blocked-1').send({ addressId }).expect(403);
      expect(blocked.body.error.code).toBe('ORDER_NOT_ALLOWED');
      await ctx.http().delete(api(`/brand/blocks/${blocks.body.data[0].id}`)).set(auth(shop.owner.token)).expect(204);
      await ctx.http().delete(api(`/carts/${shop.brandId}`)).set(auth(customer.token)).expect(204);
    });

    it('reports analytics for the store and the platform', async () => {
      const brand = await ctx.http().get(api('/brand/analytics/overview')).set(auth(shop.owner.token)).expect(200);
      expect(brand.body.data.orders.byStatus.DELIVERED).toBe(1);
      expect(brand.body.data.topProducts[0].productId).toBe(product._id);
      expect(brand.body.data.commission).toMatchObject({ rate: 0.05, balance: 17.5, blocked: false });

      const summary = await ctx.http().get(api('/admin/commissions/summary')).set(auth(admin)).expect(200);
      expect(summary.body.data).toMatchObject({ commissionThisMonth: 17.5, outstanding: 17.5, storesOwing: 1 });
    });

    it('pauses a store that owes too much until it settles by InstaPay', async () => {
      // An admin correction pushes the store over the 2000 EGP limit.
      await ctx.http().post(api(`/admin/commissions/brands/${shop.brandId}/adjust`)).set(auth(admin)).send({ amount: 2500, note: 'test' }).expect(200);
      const status = await ctx.http().get(api('/brand/commissions')).set(auth(shop.owner.token)).expect(200);
      expect(status.body.data).toMatchObject({ balance: 2517.5, blocked: true });
      const paused = await ctx.http().post(api(`/checkout/${shop.brandId}/quote`)).set(auth(customer.token)).send({ addressId }).expect(422);
      expect(paused.body.error.code).toBe('STORE_PAYMENT_OVERDUE');

      const proofFileId = await upload(ctx, shop.owner.token, 'PAYMENT_PROOF');
      await ctx
        .http()
        .post(api('/brand/commissions/settlements'))
        .set(auth(shop.owner.token))
        .send({ amount: 9999, proofFileId, transactionReference: 'SET-1' })
        .expect(422); // more than owed
      const sent = await ctx
        .http()
        .post(api('/brand/commissions/settlements'))
        .set(auth(shop.owner.token))
        .send({ amount: 2517.5, proofFileId, transactionReference: 'SET-1' })
        .expect(201);
      await ctx
        .http()
        .post(api('/brand/commissions/settlements'))
        .set(auth(shop.owner.token))
        .send({ amount: 10, proofFileId, transactionReference: 'SET-2' })
        .expect(409); // one under review at a time
      const queue = await ctx.http().get(api('/admin/settlements?status=PENDING_REVIEW')).set(auth(admin)).expect(200);
      expect(queue.body.data[0]).toMatchObject({ amount: 2517.5, brandName: 'Cotton Shop' });
      await ctx.http().get(api(`/admin/settlements/${sent.body.data._id}/proof-url`)).set(auth(admin)).expect(200);
      await ctx.http().post(api(`/admin/settlements/${sent.body.data._id}/approve`)).set(auth(admin)).expect(200);

      const after = await ctx.http().get(api('/brand/commissions')).set(auth(shop.owner.token)).expect(200);
      expect(after.body.data).toMatchObject({ balance: 0, blocked: false, dueSince: null });
      const open = await ctx.http().post(api(`/checkout/${shop.brandId}/quote`)).set(auth(customer.token)).send({ addressId }).expect(422);
      expect(open.body.error.code).toBe('CART_EMPTY'); // no longer paused, just an empty cart
      const ledger = await ctx.http().get(api('/brand/commissions/ledger')).set(auth(shop.owner.token)).expect(200);
      expect(ledger.body.data.map((e: any) => e.type)).toEqual(expect.arrayContaining(['COMMISSION', 'ADJUSTMENT', 'PAYMENT']));
    });
  });
  // ---------------------------------------------------------------- Admin soft delete

  describe('admin soft delete', () => {
    it('hides a deleted store and locks its owner out until it is restored', async () => {
      const { owner, brandId, slug } = await onboardBrand('Deleted Store');
      await ctx.http().get(api(`/brands/${slug}`)).expect(200);

      await ctx.http().post(api(`/admin/brands/${brandId}/delete`)).set(auth(admin)).expect(200);
      await ctx.http().post(api(`/admin/brands/${brandId}/delete`)).set(auth(admin)).expect(409);
      await ctx.http().get(api(`/brands/${slug}`)).expect(404);
      const me = await ctx.http().get(api('/brands/me')).set(auth(owner.token)).expect(403);
      expect(me.body.error.code).toBe('BRAND_DELETED');
      const live = await ctx.http().get(api('/admin/brands?limit=100')).set(auth(admin)).expect(200);
      expect(live.body.data.map((b: any) => b._id)).not.toContain(brandId);
      const gone = await ctx.http().get(api('/admin/brands?deleted=true&limit=100')).set(auth(admin)).expect(200);
      expect(gone.body.data.map((b: any) => b._id)).toContain(brandId);

      await ctx.http().post(api(`/admin/brands/${brandId}/restore`)).set(auth(admin)).expect(200);
      await ctx.http().get(api(`/brands/${slug}`)).expect(200);
      await ctx.http().get(api('/brands/me')).set(auth(owner.token)).expect(200);
    });

    it('lets a customer delete their own account, wiping personal data', async () => {
      const u = await registerUser(ctx, 'Leaving Customer');
      await ctx
        .http()
        .post(api('/addresses/me'))
        .set(auth(u.token))
        .send({ recipientName: 'Leaving', phone: '01022225555', governorate: 'CAI', city: 'Giza', street: '1 Street', location: { lat: 30, lng: 31 } })
        .expect(201);
      const wrong = await ctx.http().post(api('/auth/delete-account')).set(auth(u.token)).send({ password: 'nope-nope1' }).expect(422);
      expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
      await ctx.http().post(api('/auth/delete-account')).set(auth(u.token)).send({ password: 'Passw0rd!' }).expect(204);

      // Signed out everywhere, can't sign in, and the email can open a new account.
      await ctx.http().get(api('/users/me')).set(auth(u.token)).expect(401);
      await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'Passw0rd!' }).expect(401);
      await ctx.http().post(api('/auth/register')).send({ name: 'Back Again', email: u.email, phone: u.phone, password: 'Passw0rd!' }).expect(201);

      // Store owners close the store with support first.
      const owner = await registerUser(ctx, 'Owner Leaving');
      const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
      await ctx.http().post(api('/brand-applications')).set(auth(owner.token)).send({ storeType: 'BRAND', name: 'Leaving Store', categoryIds: [categoryId], contact: { phone: '01011112222' }, logoFileId }).expect(201);
      const blocked = await ctx.http().post(api('/auth/delete-account')).set(auth(owner.token)).send({ password: 'Passw0rd!' }).expect(409);
      expect(blocked.body.error.code).toBe('STORE_OWNER');

      // The public page Google Play links to.
      const page = await ctx.http().get('/delete-account').expect(200);
      expect(page.text).toContain('حذف الحساب');
      await ctx.http().get('/privacy').expect(200);
      await ctx.http().get('/terms').expect(200);
    });

    it('signs a deleted user out, blocks sign-in, and protects admins', async () => {
      const u = await registerUser(ctx);
      await ctx.http().post(api(`/admin/users/${u.id}/delete`)).set(auth(admin)).expect(200);
      await ctx.http().get(api('/users/me')).set(auth(u.token)).expect(401);
      await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'Passw0rd!' }).expect(401);

      await ctx.http().post(api(`/admin/users/${u.id}/restore`)).set(auth(admin)).expect(200);
      await ctx.http().post(api('/auth/login')).send({ identifier: u.email, password: 'Passw0rd!' }).expect(200);

      const self = await ctx.http().get(api('/users/me')).set(auth(admin)).expect(200);
      const res = await ctx.http().post(api(`/admin/users/${self.body.data.id}/delete`)).set(auth(admin)).expect(403);
      expect(res.body.error.code).toBe('SELF_ACTION');
    });

    it('hides deleted categories and plans and brings them back on restore', async () => {
      const cat = await ctx.http().post(api('/admin/categories')).set(auth(admin)).send({ nameAr: 'مؤقت', nameEn: 'Temp', slug: 'temp-cat' }).expect(201);
      const catId = cat.body.data._id;
      const slugs = async () => (await ctx.http().get(api('/categories')).expect(200)).body.data.map((c: any) => c.slug);
      await ctx.http().post(api(`/admin/categories/${catId}/delete`)).set(auth(admin)).expect(200);
      expect(await slugs()).not.toContain('temp-cat');
      await ctx.http().post(api(`/admin/categories/${catId}/restore`)).set(auth(admin)).expect(200);
      expect(await slugs()).toContain('temp-cat');

      const codes = async () => (await ctx.http().get(api('/subscription-plans')).expect(200)).body.data.map((p: any) => p.code);
      await ctx.http().post(api(`/admin/plans/${growthPlanId}/delete`)).set(auth(admin)).expect(200);
      expect(await codes()).not.toContain('GROWTH');
      await ctx.http().post(api(`/admin/plans/${growthPlanId}/restore`)).set(auth(admin)).expect(200);
      expect(await codes()).toContain('GROWTH');
    });

    it('deletes only decided payments', async () => {
      const { owner, brandId } = await onboardBrand('Paid Store');
      // Plans are history now, but old subscriptions and payments are still managed.
      const sub = await ctx.http().post(api('/brand/subscriptions')).set(auth(owner.token)).send({ planId: growthPlanId, billingPeriod: 'MONTHLY' }).expect(201);
      const proofFileId = await upload(ctx, owner.token, 'PAYMENT_PROOF');
      const proof = await ctx
        .http()
        .post(api(`/brand/subscriptions/${sub.body.data.subscription._id}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId, transactionReference: 'PAID-STORE-1' })
        .expect(200);
      await ctx.http().post(api(`/admin/payments/${proof.body.data.id}/approve`)).set(auth(admin)).send({}).expect(200);
      const paid = await ctx.http().get(api(`/admin/payments?brandId=${brandId}&limit=10`)).set(auth(admin)).expect(200);
      const approvedId = paid.body.data[0]._id;
      await ctx.http().post(api(`/admin/payments/${approvedId}/delete`)).set(auth(admin)).expect(200);
      const after = await ctx.http().get(api(`/admin/payments?brandId=${brandId}&limit=10`)).set(auth(admin)).expect(200);
      expect(after.body.data.map((p: any) => p._id)).not.toContain(approvedId);
      await ctx.http().post(api(`/admin/payments/${approvedId}/restore`)).set(auth(admin)).expect(200);

      const renewal = await ctx.http().post(api('/brand/subscriptions')).set(auth(owner.token)).send({ planId: growthPlanId, billingPeriod: 'MONTHLY' }).expect(201);
      const pending = await ctx.http().post(api(`/admin/payments/${renewal.body.data.payment.id}/delete`)).set(auth(admin)).expect(409);
      expect(pending.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    });

    it('deletes a report only once it is handled', async () => {
      const { brandId } = await onboardBrand('Reported Store');
      const u = await registerUser(ctx);
      const rep = await ctx.http().post(api('/reports')).set(auth(u.token)).send({ targetType: 'BRAND', targetId: brandId, reason: 'SPAM' }).expect(201);
      const id = rep.body.data.id;
      const open = await ctx.http().post(api(`/admin/reports/${id}/delete`)).set(auth(admin)).expect(409);
      expect(open.body.error.code).toBe('REPORT_OPEN');
      await ctx.http().patch(api(`/admin/reports/${id}`)).set(auth(admin)).send({ status: 'DISMISSED', resolutionNote: 'Not spam' }).expect(200);
      await ctx.http().post(api(`/admin/reports/${id}/delete`)).set(auth(admin)).expect(200);
      const list = await ctx.http().get(api('/admin/reports?limit=100')).set(auth(admin)).expect(200);
      expect(list.body.data.map((r: any) => r._id)).not.toContain(id);
      await ctx.http().post(api(`/admin/reports/${id}/restore`)).set(auth(admin)).expect(200);
    });
  });

  // ---------------------------------------------------------------- Promotions

  describe('coupons, sales, seasons, tracking and cart reminders', () => {
    let store: Awaited<ReturnType<typeof onboardBrand>>;
    let product: any;

    beforeAll(async () => {
      store = await onboardBrand('Promo Store');
      product = (await createProduct(store.owner.token, { title: 'جاكيت جينز', price: 500, variants: [{ size: 'M', stock: 20 }] })).body.data;
    });

    /** A fresh customer with an address in Cairo. */
    const newCustomer = async (name: string) => {
      const c = await registerUser(ctx, name);
      const addr = await ctx
        .http()
        .post(api('/addresses/me'))
        .set(auth(c.token))
        .send({ recipientName: name, phone: '01022225555', governorate: 'CAI', city: 'Heliopolis', street: '1 Street', location: { lat: 30, lng: 31 } })
        .expect(201);
      return { ...c, addressId: addr.body.data.id as string };
    };
    const addToCart = (token: string, quantity = 1) =>
      ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(token)).send({ productId: product._id, variantId: product.variants[0]._id, quantity }).expect(201);
    const placeOrder = async (c: { token: string; addressId: string }, key: string, couponCode?: string) => {
      const res = await ctx.http().post(api(`/checkout/${store.brandId}/orders`)).set(auth(c.token)).set('Idempotency-Key', key).send({ addressId: c.addressId, couponCode });
      if (res.status === 201 && res.body.data.status === 'AWAITING_CONFIRMATION') {
        await ctx.http().post(api('/orders/me/confirm')).set(auth(c.token)).send({ code: lastCode() }).expect(200);
      }
      return res;
    };
    const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
      ctx.http().patch(api(`/brand/orders/${id}/status`)).set(auth(store.owner.token)).send({ status, ...extra });

    it('applies a store coupon once per customer and gives it back when the order is cancelled', async () => {
      await ctx
        .http()
        .post(api('/brand/coupons'))
        .set(auth(store.owner.token))
        .send({ code: 'save10', type: 'PERCENT', value: 10, minSubtotal: 600, endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })
        .expect(201);
      await ctx.http().post(api('/brand/coupons')).set(auth(store.owner.token)).send({ code: 'SAVE10', type: 'FIXED', value: 5, endsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(409);

      const c = await newCustomer('Coupon Buyer');
      await addToCart(c.token, 1);
      const small = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId, couponCode: 'save10' }).expect(422);
      expect(small.body.error.code).toBe('COUPON_MIN_SUBTOTAL');
      await addToCart(c.token, 1); // 2 × 500 = 1000
      const bad = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId, couponCode: 'NOPE' }).expect(422);
      expect(bad.body.error.code).toBe('COUPON_INVALID');
      const quote = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId, couponCode: 'Save10' }).expect(200);
      expect(quote.body.data).toMatchObject({ subtotal: 1000, discountTotal: 100, shippingFee: 50, grandTotal: 950, coupon: { code: 'SAVE10', discount: 100 } });

      const order = await placeOrder(c, 'coupon-1', 'save10');
      expect(order.status).toBe(201);
      expect(order.body.data).toMatchObject({ grandTotal: 950, discountTotal: 100, coupon: { code: 'SAVE10', fundedBy: 'BRAND' } });

      await addToCart(c.token, 2);
      const again = await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId, couponCode: 'SAVE10' }).expect(422);
      expect(again.body.error.code).toBe('COUPON_ALREADY_USED');

      // Cancelling the first order frees the code again.
      await ctx.http().post(api(`/orders/me/${order.body.data.id}/cancel`)).set(auth(c.token)).send({}).expect(200);
      await ctx.http().post(api(`/checkout/${store.brandId}/quote`)).set(auth(c.token)).send({ addressId: c.addressId, couponCode: 'SAVE10' }).expect(200);
      await ctx.http().delete(api(`/carts/${store.brandId}`)).set(auth(c.token)).expect(204);
    });

    it('credits the store when a Fatrina coupon is used, and commissions the full price', async () => {
      await ctx
        .http()
        .post(api('/admin/coupons'))
        .set(auth(admin))
        .send({ code: 'FATRINA50', type: 'FIXED', value: 50, endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() })
        .expect(201);
      const before = (await ctx.http().get(api('/brand/commissions')).set(auth(store.owner.token)).expect(200)).body.data.balance;
      const c = await newCustomer('Fatrina Coupon Buyer');
      await addToCart(c.token, 1);
      const order = await placeOrder(c, 'fatrina-coupon-1', 'FATRINA50');
      expect(order.body.data).toMatchObject({ grandTotal: 500, coupon: { code: 'FATRINA50', fundedBy: 'PLATFORM' } });
      const id = order.body.data.id;
      for (const s of ['CONFIRMED', 'PROCESSING', 'SHIPPED']) await setStatus(id, s).expect(200);
      const delivered = await setStatus(id, 'DELIVERED').expect(200);
      expect(delivered.body.data.commission).toEqual({ rate: 0.05, base: 500, amount: 25 }); // full price, not 450
      const after = (await ctx.http().get(api('/brand/commissions')).set(auth(store.owner.token)).expect(200)).body.data.balance;
      expect(after - before).toBe(-25); // +25 commission, −50 paid back for the coupon
    });

    it('prices a running sale everywhere and lists it in its season', async () => {
      const campaign = await ctx
        .http()
        .post(api('/admin/campaigns'))
        .set(auth(admin))
        .send({ nameAr: 'الجمعة البيضاء', slug: 'white-friday', startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), minPercent: 15 })
        .expect(201);
      const sale = (percent: number) => ({ percent, endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), campaignId: campaign.body.data._id });
      const low = await ctx.http().patch(api(`/brand/products/${product._id}`)).set(auth(store.owner.token)).send({ sale: sale(10) }).expect(422);
      expect(low.body.error.code).toBe('CAMPAIGN_MIN_PERCENT');
      await ctx.http().patch(api(`/brand/products/${product._id}`)).set(auth(store.owner.token)).send({ sale: sale(20) }).expect(200);

      const pub = await ctx.http().get(api(`/products/${product._id}`)).expect(200);
      expect(pub.body.data).toMatchObject({ price: 400, compareAtPrice: 500, sale: { percent: 20 } });
      expect(pub.body.data.variants[0].price).toBe(400);
      const onSale = await ctx.http().get(api('/products?onSale=true&limit=50')).expect(200);
      expect(onSale.body.data.map((p: any) => p.id)).toContain(product._id);
      const season = await ctx.http().get(api(`/products?campaignId=${campaign.body.data._id}`)).expect(200);
      expect(season.body.data.map((p: any) => p.id)).toEqual([product._id]);
      const seasons = await ctx.http().get(api('/campaigns')).expect(200);
      expect(seasons.body.data.map((c: any) => c.slug)).toContain('white-friday');

      const c = await newCustomer('Sale Buyer');
      const cart = await addToCart(c.token, 1);
      expect(cart.body.data.subtotal).toBe(400);
      const order = await placeOrder(c, 'sale-1');
      expect(order.body.data.grandTotal).toBe(450);

      // Ending the sale puts the normal price back.
      await ctx.http().patch(api(`/brand/products/${product._id}`)).set(auth(store.owner.token)).send({ sale: null }).expect(200);
      expect((await ctx.http().get(api(`/products/${product._id}`)).expect(200)).body.data).toMatchObject({ price: 500, sale: null });
    });

    it('shows the tracking number to the customer once shipped', async () => {
      const c = await newCustomer('Tracked Buyer');
      await addToCart(c.token, 1);
      const order = await placeOrder(c, 'tracking-1');
      const id = order.body.data.id;
      await setStatus(id, 'CONFIRMED').expect(200);
      await setStatus(id, 'PROCESSING').expect(200);
      await ctx.http().patch(api(`/brand/orders/${id}/shipment`)).set(auth(store.owner.token)).send({ carrier: 'Bosta', trackingNumber: '123456' }).expect(409); // not shipped yet
      await setStatus(id, 'SHIPPED', { shipment: { carrier: 'Bosta', trackingNumber: '7788990', trackingUrl: 'https://bosta.co/tracking-shipment/?track_num=7788990' } }).expect(200);
      const seen = await ctx.http().get(api(`/orders/me/${id}`)).set(auth(c.token)).expect(200);
      expect(seen.body.data.shipment).toMatchObject({ carrier: 'Bosta', trackingNumber: '7788990' });
      await ctx.http().patch(api(`/brand/orders/${id}/shipment`)).set(auth(store.owner.token)).send({ carrier: 'Aramex', trackingNumber: 'AX-1' }).expect(200);
      const notes = await ctx.http().get(api('/notifications/me')).set(auth(c.token)).expect(200);
      expect(notes.body.data.some((n: any) => n.type === 'ORDER_TRACKING')).toBe(true);
    });

    it('reminds a customer about a cart left for a day, once', async () => {
      const c = await newCustomer('Forgetful Buyer');
      await addToCart(c.token, 1);
      const carts = ctx.app.get(CartsService);
      const tomorrow = new Date(Date.now() + 25 * 3_600_000);
      expect(await carts.remindAbandoned(tomorrow)).toBeGreaterThanOrEqual(1);
      await carts.remindAbandoned(tomorrow);
      const notes = await ctx.http().get(api('/notifications/me')).set(auth(c.token)).expect(200);
      expect(notes.body.data.filter((n: any) => n.type === 'CART_REMINDER')).toHaveLength(1);
      expect(ctx.contact.sent.some((m) => m.target === c.email && m.message.includes('سلتك'))).toBe(true);
    });
  });
});
