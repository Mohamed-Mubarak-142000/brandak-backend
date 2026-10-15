# Brandak Backend

NestJS + MongoDB API for Brandak (براندك), a multi-brand marketplace. Small brands subscribe through manual InstaPay transfers that an admin reviews. Customers buy from each brand separately and pay cash on delivery.

## Run locally

```bash
npm install
cp .env.example .env        # already done once; edit secrets
npm run db:dev              # terminal 1: local MongoDB replica set (transactions need one)
npm run seed                # plans, categories, first super admin
npm run start:dev           # terminal 2: http://localhost:3000
```

- Swagger UI: http://localhost:3000/api/docs. `openapi.json` is regenerated on each start; the dashboard and the app use it as the API contract.
- Seeded admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`.
- Verification codes (OTP) are written to the server log in development (`LogContactChannel`). Replace it with a real SMS/email provider before launch.
- Instead of `db:dev`, you can point `MONGODB_URI` at MongoDB Atlas. It must be a replica set.

## Tests

```bash
npm test           # unit: pricing, order state machine, subscription dates, Arabic normalization
npm run test:e2e   # full journeys on an in-memory replica set
```

## Rules the code enforces (server-side)

| Rule | Where |
|---|---|
| A brand owner only ever sees their own brand's data. The brand is resolved from their membership, never from the request body. | `common/guards/brand-member.guard.ts` |
| Uploading a receipt never activates a subscription. Only an admin approval does, inside a transaction, exactly once. | `subscriptions/subscriptions.service.ts` |
| One InstaPay transfer reference can back only one approved payment (unique partial index). | `subscriptions/payment.schema.ts` |
| An early renewal starts when the current paid period ends. | `subscriptions/subscription-period.ts` |
| Only ACTIVE brands with a running subscription are visible to customers and can take orders. | `BrandsService.visibleFilter()` |
| Publishing products is limited by the current plan. | `ProductsService.assertCanPublish` |
| Each brand has its own cart. Each order belongs to one brand. Prices and shipping are always computed on the server. | `carts/`, `orders/pricing.ts` |
| Checkout is idempotent (`Idempotency-Key` header), never oversells, and rolls back stock if any step fails. | `orders/checkout.service.ts` |
| Orders follow a fixed status lifecycle. Cancelling before shipping restocks. Every change is recorded in the order history. | `orders/order-state.ts` |
| A customer can review a product only after an order containing it was delivered. | `reviews/reviews.service.ts` |
| Admin and financial actions are written to `auditLogs`. | `audit-logs/` |

## Before production

- Set strong JWT secrets, `STORAGE_DRIVER=cloudinary`, `NODE_ENV=production` and `CORS_ORIGINS`.
- Plug in real SMS and email delivery (`auth/contact-channel.ts`) and push notifications (`notifications.service.ts`).
- Check Google Play and App Store rules on paying for subscriptions outside their billing systems. The payment method sits behind `SubscriptionPaymentProvider` (`subscriptions/payment-provider.ts`), so it can be replaced.
- Set up backups and monitoring for the database.

## Deploy on Vercel

The API runs as one serverless function (`api/index.js` → `dist/serverless.js`). Every path is rewritten to it in `vercel.json`.

1. Import the GitHub repo in Vercel. Leave the Framework Preset as **Other**, because `vercel.json` sets the build.
2. Add these **Environment Variables** (Production):

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Atlas connection string (database `brandak`) |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different random strings (48+ chars) |
   | `STORAGE_DRIVER` | `cloudinary` |
   | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | from Cloudinary |
   | `INSTAPAY_RECEIVER`, `INSTAPAY_RECEIVER_NAME` | InstaPay receiving details |
   | `CRON_SECRET` | random string (16+ chars). Vercel Cron sends it automatically |
   | `PUBLIC_BASE_URL` | e.g. `https://brandak-backend.vercel.app` |
   | `CORS_ORIGINS` | admin dashboard URL(s), comma separated |

3. In MongoDB Atlas, go to **Network Access** and allow `0.0.0.0/0`. Vercel has no fixed outbound IPs.
4. Run `npm run seed` once from your machine against the same `MONGODB_URI`.

Notes:
- **Daily cron:** Vercel Cron calls `/api/v1/internal/cron/subscriptions` once a day (06:00 UTC). It expires ended subscriptions and sends renewal reminders.
- **Uploads:** they are limited to 4 MB, because Vercel rejects request bodies above 4.5 MB.
- **Swagger:** the docs are only served when running locally (`npm run start:dev`).
