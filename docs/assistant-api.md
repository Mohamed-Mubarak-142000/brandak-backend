# Store assistant & seller copilot API

Base path: `/api/v1`. Every response uses the usual envelope:
`{ success: true, data, meta: { requestId, page?, limit?, total? } }` and errors
`{ success: false, error: { code, message, details? } }`.

Both features use Gemini (`GEMINI_API_KEY`). When the key is missing, the public info endpoint says
`enabled: false` and message endpoints answer `503 AI_UNAVAILABLE`.

## Website proxy (trusted client IP)

The website's server-side proxy should send on **every** call it forwards:

| Header | Value |
| --- | --- |
| `x-fatrina-proxy-key` | `WEB_PROXY_SECRET` (same value on both sides, ≥ 24 chars) |
| `x-fatrina-client-ip` | the visitor's IP (IPv4 or IPv6) |

With a matching key (constant-time compare) and a valid IP, that IP is used for rate limits
(all throttles, including the 5/min auth limits) and for session metadata (`auth/register`,
`auth/login`) and pixel events. Without the header or with a wrong key nothing changes (`req.ip`).

## Customer assistant (store page)

### `GET /brands/:slug/assistant` — public, CDN-cached 60 s

```json
{ "enabled": true, "name": "مساعد Daily Arts", "greeting": "أهلاً بيك في Daily Arts! ...", "suggestions": ["...", "...", "...", "..."] }
```

- `name` is already resolved (the owner's name, or `مساعد {store name}` when empty).
- `suggestions`: 4 questions that depend on the store type (WAREHOUSE: «سعر الجملة لو هاخد كمية كبيرة؟» ...).
- Store not visible / assistant switched off / AI not configured →
  `{ "enabled": false, "name": "", "greeting": "", "suggestions": [] }` (still 200).

### `POST /brands/:slug/assistant/messages` — public, optional `Authorization: Bearer`

Throttle: 8 requests/min per client IP. Body:

```json
{ "conversationId": "optional ObjectId", "visitorId": "uuid-kept-by-the-client", "text": "1–500 chars", "productId": "optional ObjectId of the product page" }
```

- `visitorId`: 1–64 chars of `[A-Za-z0-9_.:-]` (a UUID kept in localStorage/cookie).
- `conversationId` continues a chat only if it belongs to the same store **and** the same
  `visitorId` (or the same signed-in user); otherwise a new conversation is started silently —
  always use the `conversationId` returned.
- `productId`: send it when the chat is opened from a product page; it becomes the context of the
  conversation (kept for later messages).
- Sending a token makes the customer "signed in": the assistant can then read their last 5 orders
  **with this store**.

Response `200`:

```json
{
  "conversationId": "665f...",
  "reply": {
    "text": "عندنا كرتونة مناديل بـ 100 ج.م ...",
    "products": [ /* ProductCard, same shape as items of GET /products */ ],
    "actions": ["login" | "orders" | "whatsapp" | "open_app"],
    "unanswered": false
  }
}
```

ProductCard = `{ id, title, price, compareAtPrice, sale: {percent, endsAt, campaignId} | null, imageUrl, inStock, ratingAvg, ratingCount, wholesale, unit, brand: { id, name, slug, logoUrl } }` (max 6, only active products of this store).

Actions (render as buttons under the reply):

| action | when | suggested UI |
| --- | --- | --- |
| `login` | signed out and asked about their orders | link to sign in, then resend |
| `orders` | signed in and the assistant read their orders | link to "my orders" |
| `whatsapp` | the assistant couldn't answer / customer wants the store, and the store has WhatsApp | open the store's WhatsApp (`contact.whatsapp` from `GET /brands/:slug`) |
| `open_app` | model suggests the app | open/install Fatrina app |

`unanswered: true` = the assistant didn't have the information (the owner sees it flagged).

Errors:

| HTTP | code | meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | bad body (empty/too long text, bad ids) |
| 404 | `ASSISTANT_DISABLED` | store not visible or assistant switched off |
| 429 | `ASSISTANT_DAILY_LIMIT` | `details[0].reason` = `"store"` (store used its `ASSISTANT_DAILY_LIMIT` replies today) or `"visitor"` (40 messages/day per visitor, or per user when signed in) |
| 429 | `TOO_MANY_REQUESTS` | IP throttle (8/min) |
| 503 | `AI_BUSY` | model busy, retry in a minute |
| 503 | `AI_UNAVAILABLE` | AI not configured or failed |

Failed AI calls don't count toward either daily limit. Days are Cairo days.

## Owner (store dashboard) — `Authorization: Bearer`, caller must manage a store

### `GET /brand/assistant/settings`

```json
{ "enabled": true, "name": "", "tone": "friendly", "extraInfo": "", "displayName": "مساعد Daily Arts", "available": true }
```

`available` = the AI is configured on the server.

### `PATCH /brand/assistant/settings`

Partial body, any of: `{ "enabled": boolean, "name": "≤40 chars", "tone": "friendly" | "formal" | "brief", "extraInfo": "≤2000 chars" }`.
Returns the same shape as GET. The same fields are also accepted (partially) under
`settings.assistant` in `PATCH /brands/me`, and `GET /brands/me` returns `settings.assistant`
(defaults filled in for older stores).

### `GET /brand/assistant/conversations?unanswered=true&page=1&limit=20`

Paginated (`meta.page/limit/total`), newest activity first. Items:

```json
{
  "id": "...", "lastAt": "...", "createdAt": "...", "count": 4,
  "lastMessage": { "role": "assistant", "text": "first 140 chars", "at": "..." },
  "hasUnanswered": true, "signedIn": false, "customerFirstName": null,
  "productId": "... | null", "seen": false
}
```

No visitor id / user id is ever returned — only `signedIn` and the customer's first name.

### `GET /brand/assistant/conversations/:id`

Marks it seen (`seen` becomes true in the list until a new message arrives).

```json
{
  "id": "...", "brand": { "id", "name", "slug" }, "signedIn": true, "customerFirstName": "Ahmed",
  "product": { "id", "title", "imageUrl" } | null, "lastAt": "...", "createdAt": "...", "count": 4,
  "messages": [ { "role": "user" | "assistant", "text": "...", "at": "...", "unanswered": false, "products": [ { "id", "title", "imageUrl" } ] } ]
}
```

404 `CONVERSATION_NOT_FOUND` for another store's conversation.

### `GET /brand/assistant/stats`

```json
{ "today": { "used": 12, "limit": 500 }, "conversations7d": 30, "unanswered7d": 4 }
```

## Admin — super admin token

- `GET /admin/assistant/conversations?brandId=&unanswered=true&page=&limit=` — same items as the owner list plus `brand: { id, name, slug }`.
- `GET /admin/assistant/conversations/:id` — same as owner detail (doesn't mark seen).
- `GET /admin/brands/:id/assistant` — store's assistant settings (same as owner GET).
- `PATCH /admin/brands/:id/assistant` — same body/response as the owner PATCH.

## Seller copilot — `Authorization: Bearer`, caller must manage a store

### `POST /brand/copilot/messages`

Throttle 10/min. Body `{ "conversationId": "optional", "text": "1–1000 chars" }` →

```json
{ "conversationId": "...", "reply": { "text": "..." } }
```

Read-only: it answers from the store's sales overview (7/30 days), orders, low stock, top products,
search insights, unanswered product questions + assistant questions, and commission status; it can
also write descriptions, customer replies and offer ideas. For changes it points the owner to
website pages it assumes exist: `/seller/products`, `/seller/orders`, `/seller/settings`,
`/seller/questions`, `/seller/assistant`, `/seller/commissions`, `/seller/promotions`
(edit `SELLER_PAGES` in `src/assistant/assistant.prompt.ts` if the routes differ).

A conversation continues only for the same store and the same user.

Errors: `429 COPILOT_DAILY_LIMIT` (`COPILOT_DAILY_LIMIT` per store per Cairo day), `429 TOO_MANY_REQUESTS`,
`503 AI_BUSY`, `503 AI_UNAVAILABLE`, `403 NO_BRAND`.

### `GET /brand/copilot/conversations/:id`

```json
{ "id": "...", "lastAt": "...", "messages": [ { "role": "user" | "assistant", "text": "...", "at": "..." } ] }
```

## Environment

| Variable | Default | |
| --- | --- | --- |
| `WEB_PROXY_SECRET` | unset | ≥ 24 chars; enables the trusted client-IP headers |
| `ASSISTANT_DAILY_LIMIT` | 500 | customer-assistant replies per store per day |
| `COPILOT_DAILY_LIMIT` | 100 | copilot replies per store per day |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | existing | shared with product drafts |

Collections: `assistantConversations`, `assistantUsage`, `assistantVisitorUsage`, `copilotConversations`, `copilotUsage`.

## Notes for clients

- An expired/invalid token on the public message endpoint is not an error: the visitor is treated
  as signed out (refresh the token first if you want orders answers).
- The reply is plain text (short, Egyptian Arabic, prices in ج.م); render line breaks.
