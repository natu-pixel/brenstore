# Going public — let others use the store and staff portal

This file is the concrete checklist for publishing and updating the store and
staff portal. See the deployment checkpoint below for the current host. It is
intentionally not run automatically — it changes live Auth and Edge Function
behavior. Run each step, in order, against the real host you choose.

### Deployment checkpoint (2026-10-02)

The existing website is `https://brenstore-pxzh.vercel.app`; the backend's `APP_ORIGIN` already points there and was preserved. The Telegram migrations and `bren-bot-api` are deployed to Brenstore, with live authentication/catalog/link smoke checks passing. No existing commerce data changed.

The new frontend is still pending because Vercel login was unavailable. Authenticate with `npx vercel login`, link this working directory to the **existing** Brenstore Vercel project using `npx vercel link` (do not create a replacement project), confirm its public Supabase build variables, and publish with `npx vercel deploy --prod`. Then verify the account-linking routes and complete the real-bot acceptance checklist. Do not release the bot ordering flow before that frontend update.

## 0. Admin security is already done

No extra work needed to "secure" the portal — it is enforced server-side:
- `/admin/*` requires a signed-in user **and** an active staff role.
- Every read/mutation re-checks the role inside PostgreSQL (`bren_require_role`);
  direct API calls without a role get `42501`.
- All `bren_private` tables are RLS-locked; only the guarded RPCs can reach them.
- The storefront nav has no admin link; staff open `/admin` directly. (Hiding the
  link is UX, not security — the role check is the security.)

Roles: Owner (everything + team + settings + audit) · Manager (catalog, inventory,
orders, payments, fulfillment) · Support (orders, customers, notes only).

## 1. Choose a public host and deploy the frontend

Any static host that serves `index.html` for app routes works. Example with Vercel:

```powershell
npm ci
npm run build            # outputs dist/
npx vercel deploy --prod # or: netlify deploy --prod --dir=dist
```

Host requirements:
- Serve `index.html` for `/admin/...`, `/checkout`, `/orders/...`, `/auth/callback`, `/account/telegram/...`;
  real assets must still return the real file or a 404.
- Build env vars must be the **public** Supabase values (never service-role):
  - `VITE_SUPABASE_URL=https://gwdpxgezgztbvhiynaqp.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<your publishable/anon key>`

Note the public hostname, e.g. `https://shop.example.com`.

## 2. Point Supabase Auth at the real host

In the Supabase dashboard → Authentication → URL Configuration (or `config.toml` +
`npx supabase db push` is **not** how hosted Auth config is set — use the dashboard
or the management API):
- **Site URL:** `https://shop.example.com`
- **Redirect URLs:** `https://shop.example.com/auth/callback**`
  (keep the `**` suffix; do not use a bare host wildcard)
- Remove the `127.0.0.1:5173` entries only after the live ones work.

Keep email confirmation **enabled** in production (local dev disables it).

## 3. Update the Edge Function origin

`APP_ORIGIN` gates CORS for both `bren-invite` and `bren-topup`:

```powershell
npx supabase secrets set APP_ORIGIN=https://shop.example.com
npx supabase functions deploy bren-invite
npx supabase functions deploy bren-topup
```

## 4. Verify the live flows

### Telegram API deployment (before releasing the updated frontend)

- Apply the additive order-channel and Telegram migrations using your normal reviewed Supabase migration process. Do not reset or seed the production database.
- Set `BREN_BOT_API_KEY` to a randomly generated 32+ character secret through your secret manager/Supabase secrets UI. Share only this dedicated integration key with the bot owner, never the service-role key.
- Keep `APP_ORIGIN` equal to the exact website origin with no trailing slash/path. Set optional build variable `VITE_TELEGRAM_BOT_USERNAME` to the ordering bot username without `@`.
- Deploy with `npx supabase functions deploy bren-bot-api`. Gateway JWT verification is off only because this server-to-server endpoint verifies `X-Bren-Bot-Key` itself. The website's connection RPC requires a normal signed-in customer JWT.
- Exclude raw account-link paths, authorization headers, and request bodies from hosting/proxy logs. Keep the document's no-referrer policy.
- Verify the API and bot in a non-production environment first. Follow the two-account acceptance checklist in [BOT-INTEGRATION.md](BOT-INTEGRATION.md). Native PostgreSQL or browser-adapter tests are not live Supabase/bot verification.
- Removing/rotating the bot key stops bot access; it does not disable website checkout. Customers can independently revoke their own connection under My Orders > Manage Telegram connection.

- Public catalog loads on the real URL.
- Sign up a new account → confirmation email arrives → link lands on the live host.
- Sign in, place a test order, see it under **My orders**.
- As Owner at `/admin/team`, invite a staff email → they accept, sign in, open
  `/admin` and see their role's views.
- Confirm a test payment and watch a top-up delivery run.
- Confirm direct unauthenticated calls to `/admin` API resources are rejected.

## 5. Only then tell people

Share the public URL with customers. Staff open `https://shop.example.com/admin`
directly after you invite them.

---

### If you only need to demo on your own network (no public host yet)

Run the dev server on your LAN and share your machine's IP:

```powershell
npm run dev:local -- --host 0.0.0.0 --port 5173
# share http://<your-LAN-IP>:5173 with people on the same network
```

This is demo-only: it uses the **local** Supabase stack and local Auth (no real
email delivery), and your machine must stay on. Do not expose this to the internet.
