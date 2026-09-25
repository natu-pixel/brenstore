# Going public — let others use the store and staff portal

Right now everything points to `http://127.0.0.1:5173` (your own machine). This
file is the concrete checklist to open the store to real users and staff. It is
intentionally not run automatically — it changes live Auth and Edge Function
behavior. Run each step, in order, against the real host you choose.

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
- Serve `index.html` for `/admin/...`, `/checkout`, `/orders/...`, `/auth/callback`;
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
