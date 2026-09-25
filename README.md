# Brenstore

React/TypeScript storefront and a Supabase-backed administration area at `/admin`.

The storefront deliberately has no navigation link to administration, including for signed-in staff. Staff should bookmark `/admin` and open it directly. Authentication and server-side role checks still protect access; hiding the link is not a security boundary.

On phones and tablets (up to 1020px wide), the storefront header keeps its brand, cart and menu button on one row. The menu contains Home, Products, Support and account actions; it closes on navigation, Escape, outside interaction or opening the cart. Escape restores focus to the menu button, and the panel scrolls on short screens. Desktop links remain inline. Admin navigation is separate and unchanged.

## Operating model

- Fresh deployments start with an empty catalog. Manage categories and plans in admin; migrations do not create demo inventory. The current hosted project's requested category setup is documented below.
- Plans have separately maintained **USD and ETB prices** in integer minor units. No exchange-rate conversion is performed.
- Checkout requires an authenticated customer. An order is successful only after the database persists it.
- Returning to checkout after a verified order shows the **Current cart** separately from the **Previous order — already saved** summary. Seat counts add quantities, not distinct product lines. Use **Review this cart**, then **Place pending order**, to deliberately create a separate order; the previous order is not modified. An unresolved attempt still locks checkout to its original request until resolved.
- Pending orders do **not** reserve seats. A customer must be told that availability is subject to confirmation.
- Owner/Manager confirms a manually verified payment. Payment recording and all seat allocations run in one transaction; insufficient capacity rolls back the entire confirmation.
- Fulfillment is a separate staff action. Releasing a seat requires a reason and confirmation that access was removed; it does not issue a refund.
- **Game top-up plans** (currently Free Fire packages) are provider-delivered instead of seat-based. Checkout collects a numeric player ID per top-up line, and top-up and subscription plans never share one order. Confirming a verified payment queues one provider delivery per unit in the same transaction; the `bren-topup` Edge Function then places and polls the provider orders. An order fulfills automatically when every unit is delivered; failed units keep the order paid, refund their provider points to the store balance automatically, and can be retried from the order page after the cause is resolved.
- Order snapshots remain unchanged when plans/prices change. USD and ETB reporting is separate. Provider package costs are shown to staff as reference points only; sell prices are the plan's own USD/ETB prices.
- Telegram links carry a saved order reference. They do not implement or imply bot automation.

### Roles

| Role | Access |
| --- | --- |
| Customer | Public catalog, own profile, own orders and signed-in checkout |
| Support | Orders/customers and internal notes; no catalog, inventory, financial mutations, staff or settings |
| Manager | Catalog/categories, inventory, customers, orders, manual payments and fulfillment |
| Owner | Manager capabilities plus staff, store settings and audit history |

Permissions are enforced in database functions as well as the UI. All application tables have RLS enabled and are not directly writable by browser clients. Staff roles never come from editable user metadata.

Team management shows access-registration dates and active/suspended access; it does not infer email delivery or invitation acceptance. Existing accounts receive staff access without another invitation email. New and reset passwords require at least eight characters. Existing accounts can still sign in with their previous password; Supabase remains authoritative for credential validation.

## Requirements

- Node.js 24+, npm.
- Docker Desktop with its Linux engine running for the full local Supabase stack, `db:test` and HTTP integration tests. Native `test:postgres`, `test:stress` and browser contract tests do not require Docker.
- Supabase project access for hosted deployment.

```powershell
npm ci
```

## Hosted configuration

Copy `.env.example` to `.env.local` and enter the matching project values:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-publishable-or-anon-key
```

The legacy environment variable name also accepts a publishable key. Save environment files as UTF-8 without a byte-order mark so the Supabase CLI can parse them on Windows. Never use a service-role/secret key in a `VITE_` variable. Frontend values are public and included in the build; configuration validation rejects recognized server-secret keys before Vite emits a bundle.

Missing configuration, rejected credentials and unavailable database functions are errors, not triggers for simulated sign-in or fake orders.

### Existing-project safety

Before deploying:

1. Run `npx supabase login` locally. Do not put access tokens or database passwords in source control or chat.
2. Confirm the project URL/public key and intended project reference.
3. Inspect its schema, migration history, functions, Auth configuration, RLS and backup/recovery options.
4. Review the migrations for collisions with existing `bren_*` objects and `bren_private`. The migrations were developed for isolated local use; do not assume an uninspected existing project matches.
5. Reconcile any existing migration history/schema before linking/pushing. Never use a database reset on the hosted project.
6. Review the pending migration list with a dry run before the real push.

```powershell
npx supabase link --project-ref YOUR_VERIFIED_PROJECT_REFERENCE
npx supabase migration list
npx supabase db push --dry-run
# Only after inspecting the exact target and pending changes:
npx supabase db push
```

### Current hosted status

The authorized CLI deployment to **brenstore** (`gwdpxgezgztbvhiynaqp`, `eu-west-1`) covers the four initial migrations, the `bren-invite` Edge Function, the `20260924000100_bren_topup` migration (top-up plans, player-ID snapshots, per-unit delivery tracking and the service-role delivery workflow), and the `bren-topup` Edge Function with the `GTOPUP_API_KEY` secret set server-side. The existing project was inspected first: no application tables or migration history existed, and its single unconfirmed Auth account was preserved. No sample plans, orders or staff were created.

Post-deployment checks verified: all five migrations are recorded remotely; the public catalog returns plan `kind` and never exposes `provider_package_id`; `bren-topup` rejects unauthenticated calls (401), untrusted origins (403) and non-POST methods (405), and its trusted-origin preflight succeeds (204); `bren-invite` still rejects unauthenticated calls after the secrets redeploy. The live staff flow — creating a top-up plan, a customer order with a player ID, payment confirmation and automatic provider delivery — still requires an end-to-end run with a real Owner/Manager session in the browser.

Read-only postdeployment checks verified:

- The deployed migration history matches all four local migrations.
- All 13 application tables have RLS enabled, no direct browser-role table privileges, and no browser access to the private schema.
- The public catalog, categories and settings return schema-valid responses; all 16 protected read resources reject anonymous access.
- Owner-bootstrap and service-only staff functions are not browser-callable.
- The deployed invitation function rejects missing/invalid sessions, untrusted origins and unsupported methods; its allowed-origin preflight succeeds.

The designated, email-confirmed account has been activated as the first Owner through the operator-only bootstrap. Its active Owner role was verified in the hosted database; the original unconfirmed account was not promoted. Refresh `/admin` or use **Check access again** after a role change. Real signed-in hosted browser workflows and invitation/recovery email delivery still require end-to-end verification with that account.

### Hosted categories

At the user's request, five active categories were added through the existing audited `save_category` operation:

| Category | Slug | Sort order |
| --- | --- | --- |
| Streaming | `streaming` | 10 |
| Music | `music` | 20 |
| AI Tools | `ai-tools` | 30 |
| Software | `software` | 40 |
| Gaming | `gaming` | 50 |

These preserve the earlier storefront's core taxonomy and normalize the SVOD, Music, AI, Software and Games labels inspected on [GamsGo](https://www.gamsgo.com/), one of the reference sites in the existing research alongside Sharesub, GoingBus and Subify. Marketplace, game top-ups and promotional filters are not subscription categories in this release. No competing service's products, prices or availability were imported.

Categories are stored in Supabase, editable at `/admin/categories`, and supplied to the storefront filters and plan editor by the same database. Staff has since created a real offer; use admin for current catalog and inventory values rather than this setup history. Category setup is not an automatic migration seed for other projects.

### Service-name shortcuts and logos

In **Plans > Create plan / Edit**, choose a **Category**, then use **Service / brand**:

- **Streaming:** Netflix, Prime Video, Disney+, HBO Max, Apple TV+, Crunchyroll, Paramount+, YouTube Premium.
- **Music:** Spotify, Apple Music, YouTube Music, Deezer, TIDAL.
- **AI Tools:** ChatGPT, Claude, Google Gemini, Perplexity.
- **Software:** Canva, Microsoft 365, Adobe Creative Cloud, Notion, NordVPN, Proton VPN, Duolingo.
- **Gaming:** Free Fire Diamonds, PUBG Mobile UC, PlayStation Plus, Xbox Game Pass, Nintendo Switch Online, Apple Arcade.

These are local name/branding shortcuts for the five standard category slugs, **not seeded products, subcategory database records, prices or stock**. Selecting a name does not save anything. It fills empty name/slug fields (or replaces a previous preset's unchanged defaults), applies the brand key/colors/initial and shows a preview. Custom names/slugs, entered prices and billing terms are preserved. Changing category alone preserves the existing branding; custom categories still support manual branding. Only **Create plan / Save plan** persists a plan; capacity remains managed separately in inventory.

Available vector logos come from the existing `simple-icons` dependency and are rendered locally, with no third-party logo requests. Netflix uses its actual red vector mark, not a typed N. HBO Max uses the HBO Max asset, not the unrelated Max software logo. An existing plan with a blank brand key and an exact known service name can display its logo without modifying Supabase; custom-named plans should select the service explicitly. Set the selector to **Custom service / fallback initial** to opt out.

Some service names have no logo in the installed library (for example Disney+ and Prime Video). Their choices explicitly say **initials only**; no imitation logo is fabricated. Brand marks do not imply an official partnership or grant rights to resell a provider's services. Check provider terms and brand-use rules before publishing.

PUBG Mobile UC uses the bundled PUBG brand mark; Free Fire Diamonds uses an explicitly labeled FF initial fallback. Free Fire Diamonds plans can additionally be created as **Game top-up** products wired to the provider integration below; the remaining gaming entries stay name shortcuts only and do not imply UC/subscription delivery.

The current Auth site URL and invitation `APP_ORIGIN` are `http://127.0.0.1:5173`. Only the loopback Auth callback patterns for `127.0.0.1:5173` and `localhost:5173` were added; hosted email confirmation remains enabled. A public frontend/domain has not been deployed. Update these settings for the actual host before launch. Do not push the complete local development configuration to the hosted project.

## Local development without changing hosted credentials

```powershell
npx supabase start --exclude realtime,storage-api,imgproxy,studio,postgres-meta,logflare,vector,supavisor
npx supabase migration up --local
npm run dev:local -- --host 127.0.0.1 --port 5173 --strictPort
```

`dev:local` reads the local CLI configuration, refuses non-loopback endpoints, checks the database, and passes only the local public connection values to Vite. It does not replace `.env.local` or print keys. The local database persists until explicitly removed. Local email confirmation is disabled in the development config; configure and test production email delivery/confirmation separately.

For the hosted configuration in `.env.local`, use `npm run dev`.

### First Owner

Create and confirm an actual account first. Verify that account's UUID in Supabase Auth. As the database administrator, run:

```sql
select bren_private.bootstrap_owner('VERIFIED_AUTH_USER_UUID'::uuid);
```

This privileged helper is not callable by browser or service-role clients and refuses to replace an existing active Owner. Never grant Owner automatically by signup email or editable profile fields. Additional staff are invited by an Owner through the Team page.

## Staff invitation function

The `bren-invite` Edge Function verifies the caller's Auth user and current Owner role before using server-side Auth administration. It explicitly verifies the session in its handler, so its platform-level `verify_jwt` setting is false. It does not permit unauthenticated invitations.

Configure `APP_ORIGIN` as the exact trusted app origin, without a trailing slash, in Supabase Edge Function secrets. The Supabase server URL/public key/service-role key are supplied by the function environment, not the frontend.

```powershell
npx supabase secrets set APP_ORIGIN=https://YOUR_STORE_HOST
npx supabase functions deploy bren-invite
```

For local function testing, provide `APP_ORIGIN=http://127.0.0.1:5173` in an ignored local function environment file and run:

```powershell
npx supabase functions serve bren-invite --env-file supabase\functions\.env.local
```

Set the Supabase Auth site URL and allowed callback URL(s) for the actual deployment, including callback query parameters (for example, `https://YOUR_STORE_HOST/auth/callback**`, not an unrestricted host wildcard). Local callback URLs are configured under `[auth]` in `supabase/config.toml`. Test invitation delivery, acceptance, recovery and expired links with the project's real email provider before launch.

An invitation to an existing account grants staff access to that account instead of creating a duplicate Auth identity. If email delivery succeeds but role registration fails, the function reports that partial failure explicitly; correct the permission issue and retry for the same email.

## Game top-up function

The `bren-topup` Edge Function brokers the gtopup.co provider API. Like `bren-invite`, it verifies the caller's Auth session in its handler (platform `verify_jwt` is false), restricts origins to `APP_ORIGIN`, and accepts POST only. Staff operations require an active Owner or Manager role:

- `packages` — returns the provider's current package list so the plan editor can link a plan to a package. Package IDs (not names) are stored; names repeat across providers, so the picker shows ID, name and points cost.
- `process` — for a paid order, starts queued per-unit deliveries with the provider, polls each until delivered or failed within a bounded budget, and records outcomes transactionally. Units still pending when the budget ends stay open and continue on the next staff-triggered run; the order page offers **Process / refresh deliveries** and **Retry failed**. Delivery state changes and automatic fulfillment run through service-role-only database functions; browser roles cannot call them.

The provider key is a server secret and is never exposed to the frontend:

```powershell
npx supabase secrets set GTOPUP_API_KEY=YOUR_PROVIDER_KEY
npx supabase functions deploy bren-topup
```

For local function testing, add `GTOPUP_API_KEY` alongside `APP_ORIGIN` in the ignored local function environment file and run:

```powershell
npx supabase functions serve bren-topup --env-file supabase\functions\.env.local
```

Delivery charges the store's provider balance; failed deliveries return their points automatically. There is no provider balance endpoint, so watch the provider panel separately. A wrong player ID delivers to the wrong game account — the checkout echoes the ID and staff should confirm it with the customer before retrying failures. Customer-side refunds for delivered or failed top-ups remain a manual off-platform process.

## Verification

```powershell
npm run build
npm run lint
npm run check:edge
npm test
npm run test:postgres
npm run db:test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

- Unit/UI tests cover money, form states and interface behavior.
- Database tests exercise permissions, validation, snapshots and transactional invariants.
- `test:postgres` uses a disposable native PostgreSQL 17 process, including real concurrent connections, without installing a Windows service or restarting Docker. Its minimal Auth/role SQL fixtures test database contracts only; they do not verify Supabase Auth, PostgREST, email or Edge Function integration.
- HTTP integration tests target loopback Supabase only and verify Auth/REST identity and permissions.
- Commerce browser contract tests exercise the actual React app and migrated native PostgreSQL through a test-only network adapter with controlled Auth responses. Navigation-only browser tests use read-only fixtures without starting a database and cover guest/staff menus, 320px through desktop widths, short screens, focus, dismissal and cart interactions. These tests are not a substitute for live Supabase Auth/PostgREST/Edge Function verification.
- Local test fixtures are explicitly identified and cleaned up; never point them at production.

### Bounded concurrency stress test

```powershell
npm run test:stress -- --silent=false --reporter=verbose
```

The seven tests in [stress.test.ts](tests/postgres/stress.test.ts) run eight contention waves against disposable native PostgreSQL, with at most **32 simultaneous clients**. Every call opens a real connection and executes the migrated transaction. Each wave prints JSON containing its client count, accepted/rejected count, total duration, p95 latency and maximum latency.

Verified outcomes:

| Contention | Required result |
| --- | --- |
| 32 retries of one checkout key | Exactly one saved order; all retries return it |
| 32 identical payment confirmations | One payment, one allocation and one allocation movement; three seats deducted once |
| 32 confirmations competing for eight seats | Eight succeed, 24 reject, and rejected transactions record no payment/allocation |
| 24 reversed-order, two-plan confirmations | Seven complete winners for two plans with seven seats each; no partial allocations |
| 16 orders sharing a normalized payment reference | One succeeds; 15 roll back |
| 24 releases of one allocation | One release/movement; inventory restored once and original payment preserved |
| 20 old-price quotes racing one price edit | Successful orders retain the approved old price; stale quotes reject |
| 24 mixed-currency confirmations | Exact separate totals of USD 119.76 and ETB 20,400.00; 48 allocated seats |

A standalone local run passed all seven tests in **23.60 seconds including database setup**. Per-wave p95 latency ranged from **654 to 1,077 ms** and maximum latency was **1,130 ms**. Timings include connection/auth-fixture setup and contention on this workstation; they are observations, not CI thresholds, an HTTP benchmark, a production capacity estimate or an SLA. Price-race winner counts are intentionally timing-dependent.

### Hardening review and operating risks

The source review inspected Auth/recovery, current-role authorization, customer order isolation, private-schema grants/RLS, privileged invitations, input handling and chat isolation. No high-confidence exploitable vulnerability was identified in that scope. `npm audit --omit=dev` reported zero known production dependency vulnerabilities at review time. Neither result certifies the live deployment or covers future dependency disclosures.

Final verification passed **145 application tests, 24 PostgreSQL tests (including the seven stress tests), and seven Chromium operational workflows**, plus the production build, lint and Edge Function type check. The build still reports the existing nonfatal main-bundle size warning (about 734 kB minified / 214 kB gzip); real low-end-device and mobile-network performance has not been benchmarked.

Confirmed reliability defects were fixed with regression coverage:

- Admin input limits now agree with server limits: 120-character slugs, 1,000,000-seat capacity/threshold, 3,650-day terms, sort order from -1,000,000 to 1,000,000, 200-character searches, 2,000-character internal/fulfillment/cancellation notes, and 1,000-character inventory reasons.
- Publishing without a category now produces a local form error instead of only a database error.
- Admin settings, the homepage and checkout reuse the same Telegram contact-link parser. Use `https://t.me/username`; unsupported invite/message/alternate-host links are rejected before saving. Query parameters and fragments are removed, matching the existing shop behavior.
- Team timestamps no longer claim an email was sent when an existing account was only granted staff access.

**Economic interpretation:** confirmed-payment totals are gross manually recorded receipts, not profit, recognized revenue, cash reconciliation or a refund-adjusted balance. USD and ETB must remain separate until a documented reporting/settlement exchange rate is applied outside this release. No supplier costs or verified margins are stored.

For each currency and billing term, calculate:

`contribution per sold seat = sale price excluding pass-through taxes - variable supplier cost - payment/FX fees - expected refunds/losses - variable support cost`

Use consistently tax-adjusted values. If a shared supplier subscription is paid regardless of seats sold, count it among fixed costs for that term instead of double-counting it as a variable expense. When contribution is positive, `break-even sold seats = ceiling(term fixed costs / contribution per seat)`. Verify that this is achievable within legally sellable capacity and realistic occupancy. Costs, fees, taxes and loss rates were not provided, so profitability and suitable selling prices cannot be asserted.

Operational controls still required:

- Pending orders do not reserve inventory. Confirm current availability before directing an external payment, and define an external refund/waitlist process if money arrives after seats sell out. A rejected database confirmation cannot reverse a bank transfer.
- Allocation terms begin at payment confirmation, not fulfillment. Fulfill promptly, track delayed access and expired allocations, and remove provider access before releasing seats. Expiry does not automatically free capacity.
- Confirm supplier resale/sharing rights, disclose service terms and renewal/refund rules, reconcile recorded payments with actual receipts, and maintain appropriate tax/privacy records.
- Before public launch, configure the real HTTPS domain and restricted Auth callbacks/invitation origin; verify live signup, invitation/recovery delivery, role isolation and order/payment workflows. Check backup restoration, monitoring and hosted Auth/API abuse controls. Load-test the real HTTP stack only in a separately authorized staging environment.
- Real email delivery, production-domain browser behavior and Tawk conversation delivery remain unverified. This review and the stress tests changed no hosted orders, inventory, prices or payments.

The checked-in database types were generated from the deployed public schema. Runtime response contracts are additionally validated against PostgreSQL tests. Regenerate types from the verified target schema after subsequent migrations:

```powershell
npx supabase gen types typescript --local --schema public
```

Save the generated TypeScript as UTF-8 in `src/types/database.ts`. Runtime RPC responses are also validated by the environment-independent Zod contracts in `src/features/contracts.ts`.

## Live support chat

The storefront uses the supplied Tawk property/widget (`6ab372e934848d34424e8448/1k36fholt`). [LiveSupportChat](src/components/LiveSupportChat.tsx) provides a floating launcher and an inline support button. It loads Tawk's direct-chat page only after the visitor opens chat.

Rather than granting a third-party script access to the app's JavaScript context and Auth storage, chat runs in a sandboxed, cross-origin frame with no page referrer. No customer identity, session token, order data or staff data is automatically passed to Tawk. Closing chat or navigating away destroys the provider frame. Sign-in, recovery, checkout, order and admin routes never mount it.

The dialog supports focus restoration, small screens, a slow-load notice, retries and a direct-chat link. Close it with the accessible Close button or Escape when focus is on its host controls; key events inside the cross-origin provider frame belong to Tawk, and Tab/Shift+Tab returns to the host controls. A frame's load event only confirms the document loaded, not that an agent is online or its internal scripts succeeded; the UI does not claim either. Tawk controls its own availability, offline form, conversation storage and agent dashboard. Visitors can voluntarily submit information in chat; account for this provider in the store's privacy disclosures before launch.

Automated tests use an explicitly labelled provider fixture to verify sandbox isolation, referrer suppression, routing, sizing and keyboard behavior without sending messages. The real direct-chat and embed endpoints returned HTTP 200 in a server-side check, but Tawk's Cloudflare protection returned HTTP 403 for the embed in automated Chromium, including the original supplied snippet outside the app. End-to-end conversation delivery therefore remains unverified; check it in a normal browser and the Tawk dashboard. No test conversation was sent.

## Hero 3D model

The storefront hero renders the licensed 3D model **"Female Cowgirl V4" by Fadly.W, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)**, self-hosted from `public/models/cowgirl/female-cowgirl-v4.glb` (the 1k-texture GLB, ~6 MB). [ModelAvatar](src/components/ModelAvatar.tsx) draws it with three.js in a lazy-loaded chunk: studio lighting, soft floor shadow, cursor tracking, and an idle bob/breathing loop (the source model ships no animations). Attribution requires crediting the author — the subtle credit line at the bottom of the storefront page satisfies CC BY 4.0 and must not be removed.

If the GLB is missing, fails to load, or WebGL is unavailable, the hero falls back to the model's official Sketchfab iframe embed ([SketchfabEmbed](src/components/SketchfabEmbed.tsx)), which mounts after first paint so the third-party viewer never blocks page load. In the fallback case, sketchfab.com viewer resources load on the storefront — include Sketchfab in the store's privacy disclosures before launch. The hero text and actions remain fully usable if both fail.

The earlier "Feng" model by Rumen Petrov "Gumbata" is **not** usable beyond the official embed (no license, downloads disabled — all rights reserved); it was replaced for that reason.

## Deployment

`npm run build` outputs the static app to `dist`. Configure the host to serve `index.html` for application paths such as `/admin/orders/...`, `/auth/callback`, `/checkout` and `/orders/...`; asset requests must still return the real asset or a 404. Set the public Supabase build variables, apply reviewed database migrations, deploy the invitation function, and verify Auth redirect URLs.

Before calling a deployment complete, verify persisted catalog edits, signed-in order creation, direct API role isolation, payment confirmation, concurrent last-seat requests, invitation/recovery delivery, and desktop/mobile behavior against that exact environment.

## Deliberately not implemented

Online payment collection, provider refunds, recurring billing, automatic subscription renewal/access revocation, external account credentials, physical shipping and license-key vaults are not part of this release. Payment state, order state and fulfillment are separate so a future verified server-to-server payment handler can reuse the transaction boundary without trusting a browser-supplied paid flag.
