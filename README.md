# Brenstore

Brenstore is a digital storefront for subscription plans and game top-ups, with customer accounts, checkout, order tracking, and a role-protected staff portal. The app is built with React and TypeScript; Supabase provides authentication, PostgreSQL, and server-side functions.

## Features

- Product catalog with categories, service pages, search, and plan selection
- USD and ETB pricing, cart, authenticated checkout, and order history
- Staff tools for catalog, inventory, customers, orders, payments, and fulfillment
- Role-checked administration backed by PostgreSQL functions and row-level security
- Optional Telegram ordering API and game top-up provider integration

## Requirements

- Node.js 24 or newer and npm
- Supabase project for hosted use
- Docker Desktop for the full local Supabase stack and database integration tests

## Setup

Install dependencies:

```powershell
npm ci
```

Create `.env.local` from `.env.example` and set the public Supabase project values:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-publishable-or-anon-key
```

Use only a public publishable/anonymous key in `VITE_` variables. Never put a service-role or secret key in frontend configuration.

Start the app with `npm run dev`. To use the Supabase CLI's local project configuration, start the local Supabase services and use `npm run dev:local`.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run dev:local` | Start using the local Supabase CLI configuration |
| `npm run build` | Type-check and build the production app into `dist` |
| `npm run lint` | Run Oxlint |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run browser tests |
| `npm run test:integration` | Run Supabase HTTP integration tests |
| `npm run test:postgres` | Run PostgreSQL tests |

## Database and deployment

Database changes are in `supabase/migrations`. Review migrations and confirm the target Supabase project before applying them. Never reset a hosted database as part of deployment. Deploy Edge Functions from `supabase/functions` and configure their secrets in Supabase; provider and service-role secrets must stay server-side.

Build the frontend with `npm run build`. Configure the hosting provider to serve `index.html` for application routes while returning real files or 404s for asset requests. Set the production Supabase URL and public key in the hosting environment, configure the deployed HTTPS origin and Auth callbacks in Supabase, then verify sign-in, checkout, staff permissions, and order workflows against the deployed environment.

See [DEPLOY-PUBLIC.md](DEPLOY-PUBLIC.md) for the deployment checklist and [BOT-INTEGRATION.md](BOT-INTEGRATION.md) for the Telegram API contract.
