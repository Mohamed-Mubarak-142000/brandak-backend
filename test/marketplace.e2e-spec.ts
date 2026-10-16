import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Brand } from '@/brands/brand.schema';
import { SubscriptionJobs } from '@/subscriptions/subscription-jobs';
import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

/**
 * Full marketplace journey: brand onboarding → InstaPay subscription review → catalog →
 * per-brand cart → checkout → fulfilment → review, plus the security rules around each step.
 */
describe('Brandak marketplace (e2e)', () => {
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

  /** Creates a brand, gets it approved and pays for a plan; returns the owner token and ids. */
  async function onboardBrand(name: string, opts: { planId?: string; reference?: string } = {}) {
    const owner = await registerUser(ctx, `${name} Owner`);
    const logoFileId = await upload(ctx, owner.token, 'BRAND_LOGO');
    const applied = await ctx
      .http()
      .post(api('/brand-applications'))
      .set(auth(owner.token))
      .send({ name, categoryIds: [categoryId], contact: { phone: '01011112222' }, logoFileId })
      .expect(201);
    const brandId = applied.body.data.id;
    await ctx.http().post(api(`/admin/brands/${brandId}/approve`)).set(auth(admin)).expect(200);
    await ctx
      .http()
      .patch(api('/brands/me'))
      .set(auth(owner.token))
      .send({ settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null } })
      .expect(200);

    const sub = await ctx
      .http()
      .post(api('/brand/subscriptions'))
      .set(auth(owner.token))
      .send({ planId: opts.planId ?? growthPlanId, billingPeriod: 'MONTHLY' })
      .expect(201);
    const proofFileId = await upload(ctx, owner.token, 'PAYMENT_PROOF');
    const proof = await ctx
      .http()
      .post(api(`/brand/subscriptions/${sub.body.data.subscription._id}/payment-proofs`))
      .set(auth(owner.token))
      .send({ proofFileId, transactionReference: opts.reference ?? `REF-${name}-${Date.now()}` })
      .expect(200);
    await ctx.http().post(api(`/admin/payments/${proof.body.data.id}/approve`)).set(auth(admin)).send({}).expect(200);
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

  // ---------------------------------------------------------------- Brand onboarding & subscription

  describe('brand onboarding and InstaPay subscription', () => {
    it('runs the full review flow and only shows the brand once paid', async () => {
      const owner = await registerUser(ctx, 'Noura');
      const applied = await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(owner.token))
        .send({ name: 'Noura Handmade', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(201);
      const brand = applied.body.data;
      expect(brand).toMatchObject({ status: 'PENDING_REVIEW', slug: 'noura-handmade', isVisible: false });

      await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(owner.token))
        .send({ name: 'Second', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(409);

      // Not public before approval and payment.
      await ctx.http().get(api(`/brands/${brand.slug}`)).expect(404);

      await ctx.http().post(api(`/admin/brands/${brand.id}/approve`)).set(auth(admin)).expect(200);
      await ctx.http().post(api(`/admin/brands/${brand.id}/approve`)).set(auth(admin)).expect(409);
      await ctx.http().get(api(`/brands/${brand.slug}`)).expect(404); // approved but unpaid

      const sub = await ctx
        .http()
        .post(api('/brand/subscriptions'))
        .set(auth(owner.token))
        .send({ planId: growthPlanId, billingPeriod: 'MONTHLY' })
        .expect(201);
      expect(sub.body.data.payment).toMatchObject({ amount: 199, status: 'AWAITING_PROOF' });
      expect(sub.body.data.instructions).toMatchObject({ receiver: '01050867135', amount: 199 });

      const proofFileId = await upload(ctx, owner.token, 'PAYMENT_PROOF');
      const subscriptionId = sub.body.data.subscription._id;
      const proof = await ctx
        .http()
        .post(api(`/brand/subscriptions/${subscriptionId}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId, transactionReference: 'IP-778899', senderName: 'Noura' })
        .expect(200);
      expect(proof.body.data.status).toBe('PENDING_REVIEW');

      // Uploading a proof never activates anything by itself.
      await ctx.http().get(api(`/brands/${brand.slug}`)).expect(404);

      const queue = await ctx.http().get(api('/admin/payments?status=PENDING_REVIEW')).set(auth(admin)).expect(200);
      expect(queue.body.data.map((p: any) => p._id)).toContain(proof.body.data.id);
      const proofUrl = await ctx.http().get(api(`/admin/payments/${proof.body.data.id}/proof-url`)).set(auth(admin)).expect(200);
      expect(proofUrl.body.data.url).toContain('/api/v1/files/private?token=');

      // Client-sent amounts are not accepted at all.
      await ctx
        .http()
        .post(api(`/admin/payments/${proof.body.data.id}/approve`))
        .set(auth(admin))
        .send({ amount: 1 })
        .expect(400);
      const approved = await ctx
        .http()
        .post(api(`/admin/payments/${proof.body.data.id}/approve`))
        .set(auth(admin))
        .send({ reviewNote: 'Verified in bank app' })
        .expect(200);
      expect(approved.body.data.subscription.status).toBe('ACTIVE');
      await ctx.http().post(api(`/admin/payments/${proof.body.data.id}/approve`)).set(auth(admin)).send({}).expect(409);

      const pub = await ctx.http().get(api(`/brands/${brand.slug}`)).expect(200);
      expect(pub.body.data).toMatchObject({ name: 'Noura Handmade', shipping: expect.any(Object) });
      const latin = await ctx.http().get(api('/brands?q=noura')).expect(200);
      expect(latin.body.data.map((b: any) => b.id)).toContain(brand.id);

      const mine = await ctx.http().get(api('/brand/subscriptions/me')).set(auth(owner.token)).expect(200);
      expect(mine.body.data.current.planSnapshot.code).toBe('GROWTH');

      const logs = await ctx.http().get(api(`/admin/audit-logs?entityId=${proof.body.data.id}`)).set(auth(admin)).expect(200);
      expect(logs.body.data.map((l: any) => l.action)).toEqual(
        expect.arrayContaining(['PAYMENT_APPROVED', 'PAYMENT_PROOF_SUBMITTED', 'PAYMENT_PROOF_VIEWED']),
      );
    });

    it('rejects a reused transfer reference and lets the owner resubmit after rejection', async () => {
      const first = await onboardBrand('Ref Brand A', { reference: 'SAME-REF-001' });
      expect(first.brandId).toBeDefined();

      const owner = await registerUser(ctx);
      const applied = await ctx
        .http()
        .post(api('/brand-applications'))
        .set(auth(owner.token))
        .send({ name: 'Ref Brand B', categoryIds: [categoryId], contact: { phone: '01011112222' } })
        .expect(201);
      const sub = await ctx
        .http()
        .post(api('/brand/subscriptions'))
        .set(auth(owner.token))
        .send({ planId: growthPlanId, billingPeriod: 'YEARLY' })
        .expect(201);
      expect(sub.body.data.payment.amount).toBe(1990);
      const subId = sub.body.data.subscription._id;
      const proofFileId = await upload(ctx, owner.token, 'PAYMENT_PROOF');

      const reused = await ctx
        .http()
        .post(api(`/brand/subscriptions/${subId}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId, transactionReference: 'same ref 001' })
        .expect(409);
      expect(reused.body.error.code).toBe('REFERENCE_ALREADY_USED');

      const p = await ctx
        .http()
        .post(api(`/brand/subscriptions/${subId}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId, transactionReference: 'B-REF-1' })
        .expect(200);
      await ctx.http().post(api(`/admin/payments/${p.body.data.id}/reject`)).set(auth(admin)).send({ reason: 'Amount not received' }).expect(200);
      const resubmitted = await ctx
        .http()
        .post(api(`/brand/subscriptions/${subId}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId, transactionReference: 'B-REF-2' })
        .expect(200);
      expect(resubmitted.body.data.status).toBe('PENDING_REVIEW');
      expect(applied.body.data.id).toBeDefined();

      // Someone else's uploaded file can't be used as proof.
      const stranger = await registerUser(ctx);
      const foreignFile = await upload(ctx, stranger.token, 'PAYMENT_PROOF');
      await ctx
        .http()
        .post(api(`/admin/payments/${p.body.data.id}/reject`))
        .set(auth(admin))
        .send({ reason: 'Blurry image' })
        .expect(200);
      await ctx
        .http()
        .post(api(`/brand/subscriptions/${subId}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId: foreignFile, transactionReference: 'B-REF-3' })
        .expect(422);
    });

    it('extends an early renewal from the end of the current period', async () => {
      const { owner } = await onboardBrand('Renew Brand');
      const before = await ctx.http().get(api('/brand/subscriptions/me')).set(auth(owner.token)).expect(200);
      const paidUntil = new Date(before.body.data.paidUntil).getTime();

      const sub = await ctx
        .http()
        .post(api('/brand/subscriptions'))
        .set(auth(owner.token))
        .send({ planId: growthPlanId, billingPeriod: 'MONTHLY' })
        .expect(201);
      expect(sub.body.data.subscription.renewalOf).toBeDefined();
      const proofFileId = await upload(ctx, owner.token, 'PAYMENT_PROOF');
      const p = await ctx
        .http()
        .post(api(`/brand/subscriptions/${sub.body.data.subscription._id}/payment-proofs`))
        .set(auth(owner.token))
        .send({ proofFileId, transactionReference: 'RENEW-1' })
        .expect(200);
      const approved = await ctx.http().post(api(`/admin/payments/${p.body.data.id}/approve`)).set(auth(admin)).send({}).expect(200);
      expect(new Date(approved.body.data.subscription.startsAt).getTime()).toBe(paidUntil);
      expect(new Date(approved.body.data.subscription.endsAt).getTime()).toBe(paidUntil + 30 * 86_400_000);
    });
  });

  // ---------------------------------------------------------------- Catalog

  describe('catalog', () => {
    it('enforces plan limits and isolates brands from each other', async () => {
      const plan = await ctx
        .http()
        .post(api('/admin/plans'))
        .set(auth(admin))
        .send({ code: 'TINY', nameAr: 'تجربة', nameEn: 'Tiny', priceMonthly: 10, priceYearly: 100, limits: { maxActiveProducts: 1 } })
        .expect(201);
      const a = await onboardBrand('Tiny Brand', { planId: plan.body.data._id });
      const b = await onboardBrand('Other Brand');

      const p1 = await createProduct(a.owner.token);
      expect(p1.status).toBe(201);
      const p2 = await createProduct(a.owner.token);
      expect(p2.status).toBe(422);
      expect(p2.body.error.code).toBe('PLAN_LIMIT_REACHED');
      // Drafts are fine; publishing them is not.
      const draft = await createProduct(a.owner.token, { status: 'DRAFT' });
      expect(draft.status).toBe(201);
      await ctx.http().patch(api(`/brand/products/${draft.body.data._id}`)).set(auth(a.owner.token)).send({ status: 'ACTIVE' }).expect(422);

      // Brand B can neither read nor change brand A's product.
      const id = p1.body.data._id;
      await ctx.http().get(api(`/brand/products/${id}`)).set(auth(b.owner.token)).expect(404);
      await ctx.http().patch(api(`/brand/products/${id}`)).set(auth(b.owner.token)).send({ price: 1 }).expect(404);
      await ctx.http().delete(api(`/brand/products/${id}`)).set(auth(b.owner.token)).expect(404);
      // A brandId in the body is rejected, not trusted.
      await createProduct(b.owner.token, { brandId: a.brandId }).then((r) => expect(r.status).toBe(400));

      // Customers without a brand can't reach brand routes at all.
      const customer = await registerUser(ctx);
      const denied = await ctx.http().get(api('/brand/products')).set(auth(customer.token)).expect(403);
      expect(denied.body.error.code).toBe('NO_BRAND');
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
        .expect(400); // above the per-line maximum
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

    it('quotes on the server and places an idempotent order that decrements stock', async () => {
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
      expect(first.body.data).toMatchObject({ status: 'PENDING', grandTotal: 750, paymentMethod: 'COD' });
      expect(first.body.data.orderNumber).toMatch(/^BR-\d{6}$/);

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

    it('moves orders through the lifecycle, restocks on cancel, and allows reviews after delivery', async () => {
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
      await ctx.http().post(api(`/orders/me/${orderId}/cancel`)).set(auth(customer.token)).send({}).expect(409);
      await setStatus(orderId, 'PROCESSING').expect(200);
      await setStatus(orderId, 'SHIPPED').expect(200);
      const delivered = await setStatus(orderId, 'DELIVERED').expect(200);
      expect(delivered.body.data).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID', allowedNextStatuses: [] });
      expect(delivered.body.data.history.map((h: any) => h.status)).toEqual(['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);

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

      // Customer cancels a pending order → stock comes back.
      const before = await stockOf(0);
      const second = await place('lifecycle-2');
      expect(await stockOf(0)).toBe(before - 1);
      await setStatus(second, 'CANCELLED').expect(422); // brand must give a reason
      await ctx.http().post(api(`/orders/me/${second}/cancel`)).set(auth(customer.token)).send({ reason: 'changed my mind' }).expect(200);
      expect(await stockOf(0)).toBe(before);

      const myOrders = await ctx.http().get(api('/orders/me')).set(auth(customer.token)).expect(200);
      expect(myOrders.body.meta.total).toBeGreaterThanOrEqual(3);
      const customers = await ctx.http().get(api('/brand/customers')).set(auth(shop.owner.token)).expect(200);
      expect(customers.body.data[0]).toMatchObject({ name: 'Mona', deliveredCount: 1 });
    });

    it('reports analytics for the brand and the platform', async () => {
      const brand = await ctx.http().get(api('/brand/analytics/overview')).set(auth(shop.owner.token)).expect(200);
      expect(brand.body.data.orders.byStatus.DELIVERED).toBe(1);
      expect(brand.body.data.topProducts[0].productId).toBe(product._id);
      expect(brand.body.data.plan).toMatchObject({ maxActiveProducts: 200 });

      const platform = await ctx.http().get(api('/admin/analytics/overview')).set(auth(admin)).expect(200);
      expect(platform.body.data.subscriptions.active).toBeGreaterThan(0);
      expect(platform.body.data.subscriptions.mrr).toBeGreaterThan(0);
      expect(platform.body.data.subscriptions.renewalsInRange).toBeGreaterThanOrEqual(1);
    });

    it('hides a brand when its subscription ends and blocks new orders', async () => {
      const brands = ctx.app.get<Model<Brand>>(getModelToken(Brand.name));
      const jobs = ctx.app.get(SubscriptionJobs);

      // Two days before the end: the owner gets a reminder.
      const ends = (await brands.findById(other.brandId).lean())!.subscriptionEndsAt!;
      await jobs.run(new Date(ends.getTime() - 2 * 86_400_000));
      await jobs.run(new Date(ends.getTime() - 2 * 86_400_000)); // de-duplicated
      const notes = await ctx.http().get(api('/notifications/me')).set(auth(other.owner.token)).expect(200);
      expect(notes.body.data.filter((n: any) => n.type === 'SUBSCRIPTION_EXPIRING')).toHaveLength(1);

      await brands.updateOne({ _id: other.brandId }, { $set: { subscriptionEndsAt: new Date(Date.now() - 1000) } });
      await ctx.http().get(api(`/brands/${other.slug}`)).expect(404);
      const otherProduct = await createProduct(other.owner.token, { status: 'DRAFT' });
      await ctx
        .http()
        .post(api(`/carts/${other.brandId}/items`))
        .set(auth(customer.token))
        .send({ productId: otherProduct.body.data._id, variantId: otherProduct.body.data.variants[0]._id, quantity: 1 })
        .expect(404);
    });
  });
});
