import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Brand } from '@/brands/brand.schema';
import { Order } from '@/orders/order.schema';
import { SupportTicket } from '@/support/ticket.schema';
import { auth, createTestApp, loginAdmin, registerUser, TestContext, upload } from './helpers';

/**
 * Batch 3: questions and photo reviews, organized returns, support tickets with buyer
 * protection, and paid placements.
 */
describe('Fatrina after-sales (e2e)', () => {
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

  async function onboardBrand(name: string) {
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
      .send({ settings: { shippingZones: [{ governorate: 'CAI', fee: 50 }], defaultShippingFee: null } })
      .expect(200);
    return { owner, brandId };
  }

  async function createProduct(token: string, body: Record<string, unknown> = {}) {
    const imageFileId = await upload(ctx, token, 'PRODUCT_IMAGE');
    const res = await ctx
      .http()
      .post(api('/brand/products'))
      .set(auth(token))
      .send({ title: 'قميص كتان', categoryId, price: 500, imageFileIds: [imageFileId], variants: [{ size: 'M', stock: 50 }], status: 'ACTIVE', ...body })
      .expect(201);
    return res.body.data;
  }

  const newCustomer = async (name: string) => {
    const c = await registerUser(ctx, name);
    const addr = await ctx
      .http()
      .post(api('/addresses/me'))
      .set(auth(c.token))
      .send({ recipientName: name, phone: '01022225555', governorate: 'CAI', city: 'Nasr City', street: '1 Street', location: { lat: 30, lng: 31 } })
      .expect(201);
    return { ...c, addressId: addr.body.data.id as string };
  };

  let keySeq = 0;
  /** Places an order for `quantity` of the product and walks it to DELIVERED. */
  async function deliveredOrder(store: { owner: { token: string }; brandId: string }, product: any, c: { token: string; addressId: string }, quantity = 1) {
    await ctx.http().post(api(`/carts/${store.brandId}/items`)).set(auth(c.token)).send({ productId: product._id, variantId: product.variants[0]._id, quantity }).expect(201);
    const res = await ctx.http().post(api(`/checkout/${store.brandId}/orders`)).set(auth(c.token)).set('Idempotency-Key', `as-${++keySeq}`).send({ addressId: c.addressId }).expect(201);
    if (res.body.data.status === 'AWAITING_CONFIRMATION') {
      await ctx.http().post(api('/orders/me/confirm')).set(auth(c.token)).send({ code: lastCode() }).expect(200);
    }
    const id = res.body.data.id as string;
    for (const status of ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
      await ctx.http().patch(api(`/brand/orders/${id}/status`)).set(auth(store.owner.token)).send({ status }).expect(200);
    }
    return id;
  }

  const stockOf = async (token: string, productId: string) => (await ctx.http().get(api(`/brand/products/${productId}`)).set(auth(token)).expect(200)).body.data.variants[0].stock as number;

  // ---------------------------------------------------------------- Questions & reviews

  describe('questions and reviews', () => {
    it('shows a question publicly only once the store answers it', async () => {
      const store = await onboardBrand('Q Store');
      const product = await createProduct(store.owner.token);
      const c = await registerUser(ctx, 'Sara Ali');

      await ctx.http().post(api(`/products/${product._id}/questions`)).send({ text: 'المقاس مظبوط؟' }).expect(401);
      const asked = await ctx.http().post(api(`/products/${product._id}/questions`)).set(auth(c.token)).send({ text: 'المقاس مظبوط ولا كبير؟' }).expect(201);
      expect(asked.body.data).toMatchObject({ userName: 'Sara', answer: null, mine: true });

      // Not public yet, but the asker sees it.
      expect((await ctx.http().get(api(`/products/${product._id}/questions`)).expect(200)).body.data).toHaveLength(0);
      const own = await ctx.http().get(api(`/products/${product._id}/questions`)).set(auth(c.token)).expect(200);
      expect(own.body.data).toHaveLength(1);

      const inbox = await ctx.http().get(api('/brand/questions?unanswered=true')).set(auth(store.owner.token)).expect(200);
      expect(inbox.body.data[0]).toMatchObject({ id: asked.body.data.id, productTitle: product.title });
      await ctx.http().post(api(`/brand/questions/${asked.body.data.id}/answer`)).set(auth(store.owner.token)).send({ text: 'مظبوط، اطلب مقاسك العادي' }).expect(200);

      const pub = await ctx.http().get(api(`/products/${product._id}/questions`)).expect(200);
      expect(pub.body.data[0]).toMatchObject({ answer: 'مظبوط، اطلب مقاسك العادي', mine: false });
      expect((await ctx.http().get(api('/brand/questions?unanswered=true')).set(auth(store.owner.token)).expect(200)).body.data).toHaveLength(0);

      // Another store can't answer it; an admin can hide it.
      const other = await onboardBrand('Other Q Store');
      await ctx.http().post(api(`/brand/questions/${asked.body.data.id}/answer`)).set(auth(other.owner.token)).send({ text: 'xx' }).expect(404);
      const mod = await ctx.http().get(api('/admin/questions?hidden=false&q=' + encodeURIComponent('المقاس'))).set(auth(admin)).expect(200);
      expect(mod.body.data[0]).toMatchObject({ id: asked.body.data.id, productTitle: product.title, brandName: 'Q Store', hidden: false });
      await ctx.http().get(api('/admin/questions')).set(auth(c.token)).expect(403);
      await ctx.http().post(api(`/admin/questions/${asked.body.data.id}/hidden`)).set(auth(admin)).send({ hidden: true }).expect(200);
      const hiddenList = await ctx.http().get(api('/admin/questions?hidden=true')).set(auth(admin)).expect(200);
      expect(hiddenList.body.data.map((x: any) => x.id)).toContain(asked.body.data.id);
      expect((await ctx.http().get(api(`/products/${product._id}/questions`)).expect(200)).body.data).toHaveLength(0);
    });

    it('takes review photos and lets the store reply once', async () => {
      const store = await onboardBrand('Review Store');
      const product = await createProduct(store.owner.token);
      const c = await newCustomer('Reviewer');
      const orderId = await deliveredOrder(store, product, c);
      const photo = await upload(ctx, c.token, 'REVIEW_IMAGE');
      const review = await ctx
        .http()
        .post(api(`/products/${product._id}/reviews`))
        .set(auth(c.token))
        .send({ orderId, rating: 4, comment: 'خامة حلوة', imageFileIds: [photo] })
        .expect(201);
      const reviewId = review.body.data.id ?? review.body.data._id;

      const mine = await ctx.http().get(api('/brand/reviews')).set(auth(store.owner.token)).expect(200);
      expect(mine.body.data[0].images).toHaveLength(1);
      await ctx.http().post(api(`/brand/reviews/${reviewId}/reply`)).set(auth(store.owner.token)).send({ text: 'شكراً لذوقك' }).expect(200);

      const pub = await ctx.http().get(api(`/products/${product._id}/reviews`)).expect(200);
      expect(pub.body.data[0]).toMatchObject({ reply: { text: 'شكراً لذوقك' } });
      expect(pub.body.data[0].images).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- Returns

  describe('returns', () => {
    it('runs a return from request to refund, restocking and giving back the commission', async () => {
      const store = await onboardBrand('Return Store');
      const product = await createProduct(store.owner.token);
      const c = await newCustomer('Returner');
      const orderId = await deliveredOrder(store, product, c, 2);
      const stockAfterSale = await stockOf(store.owner.token, product._id);
      const balanceBefore = (await ctx.http().get(api('/brand/commissions')).set(auth(store.owner.token)).expect(200)).body.data.balance;
      expect(balanceBefore).toBe(50); // 5% of 1000

      const elig = await ctx.http().get(api(`/orders/me/${orderId}/returns/eligibility`)).set(auth(c.token)).expect(200);
      expect(elig.body.data).toMatchObject({ open: true, returnDays: 14, items: [{ returnable: 2 }] });

      const variantId = product.variants[0]._id;
      const tooMany = await ctx.http().post(api(`/orders/me/${orderId}/returns`)).set(auth(c.token)).send({ items: [{ variantId, quantity: 3 }], reason: 'WRONG_SIZE' }).expect(422);
      expect(tooMany.body.error.code).toBe('RETURN_QUANTITY_EXCEEDED');

      const photo = await upload(ctx, c.token, 'CLAIM_IMAGE');
      const created = await ctx
        .http()
        .post(api(`/orders/me/${orderId}/returns`))
        .set(auth(c.token))
        .send({ items: [{ variantId, quantity: 1 }], reason: 'WRONG_SIZE', note: 'واسع', imageFileIds: [photo] })
        .expect(201);
      const id = created.body.data.id;
      expect(created.body.data).toMatchObject({ status: 'REQUESTED', refundAmount: 500, images: [expect.any(String)] });

      // Only one item is left to return now.
      const left = await ctx.http().post(api(`/orders/me/${orderId}/returns`)).set(auth(c.token)).send({ items: [{ variantId, quantity: 2 }], reason: 'WRONG_SIZE' }).expect(422);
      expect(left.body.error.code).toBe('RETURN_QUANTITY_EXCEEDED');

      // The store can't skip steps; another store can't touch it.
      await ctx.http().post(api(`/brand/returns/${id}/received`)).set(auth(store.owner.token)).send({}).expect(422);
      const other = await onboardBrand('Other Return Store');
      await ctx.http().post(api(`/brand/returns/${id}/approve`)).set(auth(other.owner.token)).send({}).expect(404);

      const list = await ctx.http().get(api('/brand/returns?status=REQUESTED')).set(auth(store.owner.token)).expect(200);
      expect(list.body.data.map((r: any) => r.id)).toContain(id);
      await ctx.http().post(api(`/brand/returns/${id}/approve`)).set(auth(store.owner.token)).send({ note: 'ابعته مع المندوب' }).expect(200);
      await ctx.http().post(api(`/brand/returns/${id}/received`)).set(auth(store.owner.token)).send({}).expect(200);
      expect(await stockOf(store.owner.token, product._id)).toBe(stockAfterSale + 1);
      // Once received, the customer can't cancel.
      await ctx.http().post(api(`/returns/me/${id}/cancel`)).set(auth(c.token)).expect(422);

      const refunded = await ctx.http().post(api(`/brand/returns/${id}/refunded`)).set(auth(store.owner.token)).send({}).expect(200);
      expect(refunded.body.data).toMatchObject({ status: 'REFUNDED', commissionReversed: 25 });
      const balanceAfter = (await ctx.http().get(api('/brand/commissions')).set(auth(store.owner.token)).expect(200)).body.data.balance;
      expect(balanceAfter).toBe(25);

      const mine = await ctx.http().get(api(`/returns/me/${id}`)).set(auth(c.token)).expect(200);
      expect(mine.body.data.history.map((h: any) => h.status)).toEqual(['REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED']);
    });

    it('closes returns after the store window and lets an admin overturn a rejection', async () => {
      const store = await onboardBrand('Window Store');
      const product = await createProduct(store.owner.token);
      const c = await newCustomer('Late Returner');
      const orderId = await deliveredOrder(store, product, c);
      const variantId = product.variants[0]._id;

      const r = await ctx.http().post(api(`/orders/me/${orderId}/returns`)).set(auth(c.token)).send({ items: [{ variantId, quantity: 1 }], reason: 'DAMAGED' }).expect(201);
      await ctx.http().post(api(`/brand/returns/${r.body.data.id}/reject`)).set(auth(store.owner.token)).send({ note: 'المنتج سليم' }).expect(200);
      // Rejected requests free the items again; the admin can still approve it.
      const approved = await ctx.http().post(api(`/admin/returns/${r.body.data.id}/approved`)).set(auth(admin)).send({ note: 'الصور بتأكد العيب' }).expect(200);
      expect(approved.body.data.status).toBe('APPROVED');

      const orders = ctx.app.get<Model<Order>>(getModelToken(Order.name));
      await orders.updateOne({ _id: orderId }, { $set: { deliveredAt: new Date(Date.now() - 15 * 86_400_000) } });
      const late = await ctx.http().post(api(`/orders/me/${orderId}/returns`)).set(auth(c.token)).send({ items: [{ variantId, quantity: 1 }], reason: 'DAMAGED' }).expect(422);
      expect(late.body.error.code).toBe('RETURN_WINDOW_CLOSED');

      // A store with returns turned off.
      await ctx.http().patch(api('/brands/me')).set(auth(store.owner.token)).send({ settings: { returnDays: 0 } }).expect(200);
      const elig = await ctx.http().get(api(`/orders/me/${orderId}/returns/eligibility`)).set(auth(c.token)).expect(200);
      expect(elig.body.data).toMatchObject({ open: false, returnDays: 0 });
    });
  });

  // ---------------------------------------------------------------- Support

  describe('support and buyer protection', () => {
    it('handles a general ticket between the customer and Fatrina support', async () => {
      const c = await registerUser(ctx, 'Helpme');
      const t = await ctx.http().post(api('/support/tickets')).set(auth(c.token)).send({ type: 'ACCOUNT', subject: 'مش عارف أغير الإيميل', text: 'محتاج مساعدة في تغيير الإيميل' }).expect(201);
      expect(t.body.data).toMatchObject({ status: 'OPEN', protection: false });
      const shot = await upload(ctx, admin, 'CLAIM_IMAGE');
      const adminReply = await ctx.http().post(api(`/admin/tickets/${t.body.data.id}/messages`)).set(auth(admin)).send({ text: 'من الإعدادات > الحساب', imageFileIds: [shot] }).expect(201);
      expect(adminReply.body.data.messages[1].images).toHaveLength(1);
      const reply = await ctx.http().post(api(`/support/tickets/${t.body.data.id}/messages`)).set(auth(c.token)).send({ text: 'تمام شكراً' }).expect(201);
      expect(reply.body.data.messages.map((m: any) => m.author)).toEqual(['CUSTOMER', 'ADMIN', 'CUSTOMER']);
      await ctx.http().post(api(`/support/tickets/${t.body.data.id}/close`)).set(auth(c.token)).expect(200);
      await ctx.http().post(api(`/support/tickets/${t.body.data.id}/messages`)).set(auth(c.token)).send({ text: 'تاني' }).expect(422);

      // Others can't read it.
      const stranger = await registerUser(ctx, 'Stranger');
      await ctx.http().get(api(`/support/tickets/${t.body.data.id}`)).set(auth(stranger.token)).expect(404);
    });

    it('escalates unanswered protection cases and suspends a store after three lost cases', async () => {
      const store = await onboardBrand('Shady Store');
      const product = await createProduct(store.owner.token);
      const c = await newCustomer('Protected Buyer');
      const orderId = await deliveredOrder(store, product, c);
      const tickets = ctx.app.get<Model<SupportTicket>>(getModelToken(SupportTicket.name));
      const brands = ctx.app.get<Model<Brand>>(getModelToken(Brand.name));

      const noOrder = await ctx.http().post(api('/support/tickets')).set(auth(c.token)).send({ type: 'NOT_RECEIVED', subject: 'موصلش', text: 'الطلب موصلش لحد دلوقتي' }).expect(422);
      expect(noOrder.body.error.code).toBe('ORDER_REQUIRED');

      for (let i = 1; i <= 3; i++) {
        const t = await ctx
          .http()
          .post(api('/support/tickets'))
          .set(auth(c.token))
          .send({ type: 'NOT_AS_DESCRIBED', orderId, subject: `مختلف عن الصورة ${i}`, text: 'اللون مختلف تماماً عن الصور' })
          .expect(201);
        expect(t.body.data).toMatchObject({ status: 'WAITING_STORE', protection: true, brandName: 'Shady Store' });
        if (i === 1) {
          await ctx.http().post(api('/support/tickets')).set(auth(c.token)).send({ type: 'NOT_AS_DESCRIBED', orderId, subject: 'تاني', text: 'نفس المشكلة تاني' }).expect(409);
          const seen = await ctx.http().get(api('/brand/tickets?active=true')).set(auth(store.owner.token)).expect(200);
          expect(seen.body.data.map((x: any) => x.id)).toContain(t.body.data.id);
        }
        if (i === 2) {
          // The store answered in time: the case goes to support, no escalation.
          const r = await ctx.http().post(api(`/brand/tickets/${t.body.data.id}/messages`)).set(auth(store.owner.token)).send({ text: 'هنبدله فوراً' }).expect(201);
          expect(r.body.data.status).toBe('OPEN');
        } else {
          // 48 hours pass without an answer.
          await tickets.updateOne({ _id: t.body.data.id }, { $set: { storeDeadline: new Date(Date.now() - 1000) } });
        }
        const list = await ctx.http().get(api('/admin/tickets?active=true')).set(auth(admin)).expect(200);
        const row = list.body.data.find((x: any) => x.id === t.body.data.id);
        expect(row.status).toBe(i === 2 ? 'OPEN' : 'ESCALATED');
        await ctx.http().post(api(`/admin/tickets/${t.body.data.id}/resolve`)).set(auth(admin)).send({ outcome: 'CUSTOMER', note: 'المتجر يرجّع الفلوس' }).expect(200);
      }
      const brand = await brands.findById(store.brandId).lean();
      expect(brand).toMatchObject({ protectionStrikes: 3, status: 'SUSPENDED' });
    });
  });

  // ---------------------------------------------------------------- Ads

  describe('paid placements', () => {
    it('sells a search placement through InstaPay review and puts the product first', async () => {
      const prices = await ctx.http().get(api('/ads/prices')).expect(200);
      expect(prices.body.data.find((p: any) => p.placement === 'SEARCH_TOP').weekPrice).toBe(150);
      await ctx.http().put(api('/admin/ads/prices')).set(auth(admin)).send({ SEARCH_TOP: 200 }).expect(200);

      const store = await onboardBrand('Ads Store');
      // An older, matching product from another store would normally come first... newest wins,
      // so the promoted product is created first and must still lead.
      const promoted = await createProduct(store.owner.token, { title: 'بنطلون جبردين مميز' });
      const rival = await onboardBrand('Rival Store');
      await createProduct(rival.owner.token, { title: 'بنطلون جبردين عادي' });

      const proof = await upload(ctx, store.owner.token, 'PAYMENT_PROOF');
      const ad = await ctx
        .http()
        .post(api('/brand/ads'))
        .set(auth(store.owner.token))
        .send({ productId: promoted._id, placement: 'SEARCH_TOP', weeks: 2, proofFileId: proof, transactionReference: 'IPN-77881' })
        .expect(201);
      expect(ad.body.data).toMatchObject({ status: 'PENDING_REVIEW', price: 400 });
      const proof2 = await upload(ctx, store.owner.token, 'PAYMENT_PROOF');
      await ctx
        .http()
        .post(api('/brand/ads'))
        .set(auth(store.owner.token))
        .send({ productId: promoted._id, placement: 'HOME_BANNER', weeks: 1, proofFileId: proof2, transactionReference: 'ipn 77881' })
        .expect(409);

      const before = await ctx.http().get(api(`/products?q=${encodeURIComponent('جبردين')}`)).expect(200);
      expect(before.body.data[0].sponsored).toBeUndefined();

      await ctx.http().post(api(`/admin/ads/${ad.body.data.id}/approve`)).set(auth(admin)).expect(200);
      const after = await ctx.http().get(api(`/products?q=${encodeURIComponent('جبردين')}&page=1`)).expect(200);
      expect(after.body.data[0]).toMatchObject({ id: promoted._id, sponsored: true, adId: ad.body.data.id });
      expect(after.body.data.filter((p: any) => p.id === promoted._id)).toHaveLength(1);

      await ctx.http().post(api(`/ads/${ad.body.data.id}/click`)).expect(204);
      const mine = await ctx.http().get(api('/brand/ads')).set(auth(store.owner.token)).expect(200);
      expect(mine.body.data[0]).toMatchObject({ status: 'ACTIVE', clicks: 1, productTitle: 'بنطلون جبردين مميز' });
      expect(mine.body.data[0].impressions).toBeGreaterThanOrEqual(1);
    });

    it('shows approved home placements in the featured rail', async () => {
      const store = await onboardBrand('Featured Store');
      const product = await createProduct(store.owner.token, { title: 'فستان سهرة' });
      const proof = await upload(ctx, store.owner.token, 'PAYMENT_PROOF');
      const ad = await ctx
        .http()
        .post(api('/brand/ads'))
        .set(auth(store.owner.token))
        .send({ productId: product._id, placement: 'HOME_BANNER', weeks: 1, proofFileId: proof, transactionReference: 'FEAT-1001' })
        .expect(201);
      const rejected = await ctx.http().post(api(`/admin/ads/${ad.body.data.id}/reject`)).set(auth(admin)).send({ reason: 'الإيصال مش واضح' }).expect(200);
      expect(rejected.body.data.status).toBe('REJECTED');
      expect((await ctx.http().get(api('/products/featured')).expect(200)).body.data).toHaveLength(0);

      const proof2 = await upload(ctx, store.owner.token, 'PAYMENT_PROOF');
      const again = await ctx
        .http()
        .post(api('/brand/ads'))
        .set(auth(store.owner.token))
        .send({ productId: product._id, placement: 'HOME_BANNER', weeks: 1, proofFileId: proof2, transactionReference: 'FEAT-1002' })
        .expect(201);
      await ctx.http().post(api(`/admin/ads/${again.body.data.id}/approve`)).set(auth(admin)).expect(200);
      const featured = await ctx.http().get(api('/products/featured')).expect(200);
      expect(featured.body.data[0]).toMatchObject({ id: product._id, sponsored: true });
    });
  });
});
