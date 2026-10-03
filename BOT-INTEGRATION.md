# Telegram integration (API version 1)

The bot and website share customer and order records. The bot owner implements Telegram menus, private-chat identity verification, cart review, confirmation, and messages. Brenstore owns the linking UI and order API. This document describes the new integration; it is not evidence that a hosted deployment or the colleague's bot has been verified.

## Authentication and environments

**Hosted backend deployed on 2026-10-02:** use `https://gwdpxgezgztbvhiynaqp.supabase.co/functions/v1/bren-bot-api` for the current Brenstore project. The configured website origin is `https://brenstore-pxzh.vercel.app`. The new website linking screens have not yet been published, so do not enable customer linking/ordering until the frontend release and real-bot acceptance checks are complete. The integration key must be shared separately through a secure channel.

Send JSON POST requests to `https://<project>.supabase.co/functions/v1/bren-bot-api`:

```http
Content-Type: application/json
X-Bren-Bot-Key: <dedicated-integration-secret>
```

Use a separate key, Supabase project, website origin, and bot for dev/test/prod. Never send a Supabase service-role key, customer JWT, password, or bot token in these requests. The dedicated key belongs only on the bot server and in Edge Function secrets. Production traffic must use HTTPS.

The key authenticates your server, not an individual Telegram user. Take `telegram_user_id` from the verified Telegram update's `message.from.id` or `callback_query.from.id`. Never take it from chat text, usernames, forwarded authors, or user-controlled callback data. Restrict account/order actions to private chats and verify callback ownership against your server-side cart. Follow Telegram's webhook secret verification or authenticated polling guidance. A compromised integration key can act for linked users: revoke/rotate it immediately.

## Request envelope

```json
{
  "version": 1,
  "op": "account.status",
  "telegram_user_id": "987654321",
  "input": {}
}
```

IDs are positive decimal **strings** (at most 16 digits, no leading zero). Only documented keys are accepted. `input` is required. Maximum body size is 32 KiB. All operations require the integration key, including the public catalog.

| Operation | Input | Result |
| --- | --- | --- |
| `link.start` | Optional `name`, `username` (display only) | `request_id`, `expires_at`, `url` |
| `link.status` | `request_id` | Link state; approved account's display name only |
| `link.confirm` | `request_id` | Connected state after both sides approve |
| `account.status` | `{}` | `linked`, and linked customer's display name when connected |
| `catalog.list` | `{}` | `categories`, `plans` (public catalog only) |
| `order.create` | Checkout payload below | `order`, `items`, `deliveries`, `payment_instructions`, `url` |
| `order.list` | Optional `page` (default 1), `page_size` (default 20, max 100) | `rows`, `total`, `page`, `page_size` |
| `order.get` | `id` (order UUID) | Same customer-safe detail shape as create |

Success: `{"ok":true,"data":{...},"request_id":"<server-trace-uuid>"}`.
Failure: `{"ok":false,"error":{"code":"ACCOUNT_NOT_LINKED","message":"...","retryable":false},"request_id":"<server-trace-uuid>"}`.
The top-level trace ID is different from the linking request ID inside `data`.

## Account linking

1. Call `link.start` using the Telegram user's actual ID. Send the returned URL as a **Connect account** button. Do not post it in groups.
2. The customer signs in/registers on the website and explicitly approves the displayed Telegram identity. A link expires after **10 minutes**. A new start supersedes unfinished requests for that Telegram user. Never automatically restart while they are approving.
3. Offer a **Check connection** button, or poll `link.status` no more frequently than every five seconds while the flow is active. Stop on terminal states or expiry.
4. `state: approved` is **not yet linked**. Show `customer_name` so the customer can detect a wrong account, and ask them to confirm the connection in Telegram.
5. Only after that user taps the confirmation button, call `link.confirm` with the same request ID. Never confirm automatically on receiving website approval.
6. `state: connected` means ordering is enabled. Retrying that same confirmation is safe while the same active link exists.

Status results contain `request_id`, `state`, `expires_at`, and nullable `customer_name`. States: `pending`, `approved`, `connected`, `rejected`, `superseded`, `revoked`, `expired`. An unknown request or one owned by another Telegram user is unavailable.

One website account links to one Telegram user and vice versa. Customers disconnect at `/account/telegram` before replacing a link. Unlink revokes future access but preserves orders and does not delete earlier Telegram messages. Do not automatically merge accounts by name, email, or username.

Example:

```json
{"version":1,"op":"link.start","telegram_user_id":"987654321","input":{"name":"Example","username":"example_user"}}
```

## Creating an order

Read `catalog.list`, let the user choose exact plan IDs, currency and quantity, collect required contact details, and display a final review. Only call `order.create` after explicit confirmation.

```json
{
  "version": 1,
  "op": "order.create",
  "telegram_user_id": "987654321",
  "input": {
    "idempotency_key": "<new-uuid-for-this-confirmed-checkout>",
    "currency": "ETB",
    "name": "Example Customer",
    "phone": "<customer-provided-phone>",
    "items": [
      {"plan_id": "<exact-catalog-plan-uuid>", "qty": 1, "unit_minor": 50000}
    ]
  }
}
```

The example price is illustrative, not a store price. Use integers in minor units, never decimal floats or currency conversion. USD and ETB prices are maintained independently. `unit_minor` must equal the reviewed catalog price. Orders contain 1-50 distinct plans, with quantity 1-9 each. `name` and `phone` are required; an optional `telegram` contact string is not identity verification.

Top-up lines require a numeric `player_id` string of 6-20 digits. Never combine top-ups and subscriptions in one order. Service purchase options and durations have distinct plan IDs. Package user counts are not order quantity.

The backend calculates totals, checks price/availability, and assigns the linked customer and `source: telegram`. Do not send customer IDs, source, payment status, or admin commands. A saved order is **pending payment**, not paid or fulfilled. Pending subscriptions do not reserve stock. Staff retain payment confirmation and fulfillment responsibilities.

### Safe retries

- Persist the exact confirmed payload and UUID before sending.
- Retry uncertain network/503 responses with **that same payload and key**. Do not generate a new key because a reply was lost.
- Identical retries return the saved order even after catalog changes. Changed payload or source with the same key returns 409.
- Price/availability conflicts require a refreshed catalog and a new customer review. A newly confirmed, changed checkout uses a new key.
- If sending the Telegram success message fails, retry the message, not a new order.
- The order URL opens the authenticated website order page; it is not a public access link.

## Order responses and privacy

Order summaries contain `id`, `reference`, `currency`, `total_minor`, `status`, `payment_status`, `source`, `created_at`, and `updated_at`.
Detail includes item snapshots (`name`, option, duration, quantity, unit price), limited top-up progress, allowed manual payment instructions, and the website URL.

The bot API does not export profile email/phone, internal notes, staff identities, provider IDs/errors, payment credentials, or delivered access credentials. Even staff-linked Telegram users can only read their own customer orders. Unknown and non-owned order IDs return the same not-found result.

Status is on demand in this version. There is no automatic notification webhook or delivery queue. Keep carts separate between website and bot; saved orders appear in the same history.

### Example successful order response

```json
{
  "ok": true,
  "data": {
    "order": {
      "id": "20000000-0000-4000-8000-000000000001",
      "reference": "BR-EXAMPLE",
      "currency": "ETB",
      "total_minor": 50000,
      "status": "pending",
      "payment_status": "pending",
      "source": "telegram",
      "created_at": "2026-10-02T12:00:00+00:00",
      "updated_at": "2026-10-02T12:00:00+00:00"
    },
    "items": [{
      "plan_id": "30000000-0000-4000-8000-000000000001",
      "name": "Example monthly plan",
      "qty": 1,
      "unit_minor": 50000,
      "billing_days": 30,
      "service_name": null,
      "option_code": null,
      "users_included": null
    }],
    "deliveries": { "total": 0, "delivered": 0, "failed": 0 },
    "payment_instructions": "Follow the store's manual payment instructions.",
    "url": "https://shop.example.com/orders/20000000-0000-4000-8000-000000000001"
  },
  "request_id": "40000000-0000-4000-8000-000000000001"
}
```

`items` contains only the keys shown above. Nullable option fields describe historical snapshots, not inferred package sizes. `deliveries` counts provider-delivery records; these are created after payment, so zero while pending does **not** mean fulfilled. Always use `status` and `payment_status` as well. `order.list.rows` contains the same order summary objects, without item details or URLs.

### Calling from PowerShell

The bot can use any language's HTTPS client. For a manual smoke test, set `BREN_BOT_API_URL` and `BREN_BOT_API_KEY` in your shell using your secret manager, then:

```powershell
$headers = @{ 'X-Bren-Bot-Key' = $env:BREN_BOT_API_KEY }
$body = @{
  version = 1
  op = 'link.start'
  telegram_user_id = '<your-own-verified-Telegram-user-id>'
  input = @{ name = 'Test customer'; username = '<display-username>' }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri $env:BREN_BOT_API_URL -Headers $headers -ContentType 'application/json' -Body $body
```

For each subsequent action, send the same envelope with the following `op`/`input` pair. Replace all placeholders with values returned by the API:

```json
{"op":"link.status","input":{"request_id":"<link-request-uuid>"}}
{"op":"link.confirm","input":{"request_id":"<link-request-uuid>"}}
{"op":"account.status","input":{}}
{"op":"catalog.list","input":{}}
{"op":"order.list","input":{"page":1,"page_size":20}}
{"op":"order.get","input":{"id":"<saved-order-uuid>"}}
```

These are separate operations, not a script to run automatically. In particular, `link.confirm` must follow the user's explicit confirmation in the originating Telegram chat. Use the full `order.create` example above for checkout. Do not paste real secrets or connection URLs into shared terminals, issue trackers, or chat logs.

## Errors and limits

| HTTP | Codes / meaning | Action |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Fix request; do not retry unchanged |
| 401 | `UNAUTHORIZED` | Check server-only integration key |
| 403 | `ACCOUNT_NOT_LINKED`, `FORBIDDEN` | Connect account or stop unauthorized action |
| 404 | `NOT_FOUND` | Do not disclose whether another customer owns the record |
| 409 | `LINK_CONFLICT`, `LINK_NOT_APPROVED`, `IDEMPOTENCY_CONFLICT`, `ORDER_CHANGED` | Resolve conflict; obtain fresh review when needed |
| 410 | `LINK_UNAVAILABLE` | Restart linking explicitly |
| 413 | `REQUEST_TOO_LARGE` | Reduce body |
| 429 | `RATE_LIMITED` | Wait at least `Retry-After` seconds |
| 503 | `UNAVAILABLE` | Retry with backoff and unchanged checkout key |

Limits: 60 API requests per Telegram user per minute, 600 per integration per minute, and 5 link starts per Telegram user per 10 minutes. Limits persist across Edge Function instances. Bot requests with a valid envelope count even when the business operation fails; unauthenticated requests are rejected before customer lookup. Successful browser connection reads/actions have a separate 60/minute per-customer limit; rejected database transactions do not consume that browser quota.

## Deployment and handoff

1. Apply the additive Telegram migrations before deploying this frontend.
2. Set server secrets `APP_ORIGIN` (exact website origin), `BREN_BOT_API_KEY` (at least 32 random characters), and frontend `VITE_TELEGRAM_BOT_USERNAME` (bot username without `@`, optional; controls website discovery only). Never put the integration key in a `VITE_` variable.
3. Deploy `bren-bot-api`. Its gateway JWT check is disabled intentionally; the handler must enforce the dedicated integration key. Website linking RPCs still require the customer's normal Supabase JWT.
4. Share the endpoint/key securely outside source control. No bot token or Supabase admin key is needed by the other side.
5. Rotate by updating the Edge secret and the bot's key together; the old key stops working immediately. Remove the key to disable bot access without disabling website checkout.
6. Confirm two test customers can link, create orders, and see them on the website; cross-customer access is denied; retries save only one order; unlink revokes access. Verify the colleague really gates `link.confirm` and `order.create` on user confirmation.

Local database/browser tests are not a substitute for deployed Supabase Auth, Edge Function, and real-bot verification.

### Verified locally

- Native PostgreSQL tests exercise account linking, permissions, conflicting and concurrent confirmations, unlink races, order idempotency, source attribution, and customer-only projections.
- The real Edge handler is exercised with HTTP Request/Response objects backed by native PostgreSQL for linking, catalog, orders, conflicts, and revocation. This does not emulate the hosted gateway or PostgREST.
- Browser tests at 390px and 1440px exercise sign-in return, website approval, bot confirmation, persisted order history, and disconnect.
- Unit tests cover the API envelope, authentication, body limits, errors, browser linking states, signup email return, and callback return.
- Local Supabase Auth/REST integration requires Docker Desktop's Linux engine. When unavailable, its checks and the deployed real-bot acceptance remain pending rather than being treated as passed.
