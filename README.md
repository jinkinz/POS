# POS

Full-suite point-of-sale system for food & beverage **and retail/consignment** businesses in Malaysia and Singapore.

| Module | What it does |
|---|---|
| **POS terminal** (`apps/pos`) | Offline-first selling: menu grid, barcode/SKU scanning, modifiers, tables, members, vouchers, split tender, cash rounding (MY 5 sen), gateway QR payments, shift open/close with printed Z-report, staff clock in/out |
| **Kitchen display** (`apps/kds`) | Real-time station tickets with timers, bump/recall, all-day counts |
| **QR ordering** (`apps/qr`) | Customers scan a table QR, order from their phone, track item status |
| **Back office** (`apps/backoffice`) | Dashboard & daily reports, shifts, members/campaigns, menu, inventory (ingredients + retail units), consignment settlements, tables & printable QRs, devices, staff, payroll, e-invoicing, settings |
| **Print bridge** (`apps/print-bridge`) | On-site agent driving ESC/POS receipt & kitchen printers (TCP :9100) |
| **API** (`apps/api`) | NestJS modular monolith: auth/RBAC, orders, payments (mock + HitPay adapters), realtime socket, inventory & recipes, CRM/loyalty/vouchers, LHDN MyInvois e-invoicing, delivery-aggregator webhooks, HR/payroll, shifts |

Shared packages: `packages/shared` (money/tax/rounding pipeline used by server **and** offline POS), `packages/db` (Prisma schema + migrations).

See [FEATURES.md](FEATURES.md) for the feature map and [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions.

## Prerequisites

- **Node.js >= 22** and **pnpm 9** (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- **PostgreSQL** — either your own server, or use the zero-install embedded dev database below (downloads real Postgres binaries; no Docker/Homebrew needed)
- Python 3 (only for running the e2e suites)

## Quick start (development)

```bash
git clone https://github.com/jinkinz/POS.git && cd POS
pnpm install
pnpm -r build

# 1. Start the embedded dev database (keeps running; Ctrl-C to stop)
pnpm --filter @pos/db devdb

# 2. In a new terminal — configure env and apply migrations
cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
(cd packages/db && npx prisma migrate deploy)

# 3. Seed demo data (a Malaysian kopitiam with menu, tables, staff)
pnpm --filter @pos/api seed

# 4. Start the API
pnpm --filter @pos/api dev        # http://localhost:3000/api

# 5. Start the apps you want (each in its own terminal)
pnpm --filter @pos/pos dev        # POS terminal  -> http://localhost:5173
pnpm --filter @pos/kds dev        # Kitchen display -> http://localhost:5174
pnpm --filter @pos/qr dev         # QR ordering   -> http://localhost:5175/?t=<qrToken>
pnpm --filter @pos/backoffice dev # Back office   -> http://localhost:5176
```

### Demo credentials (from the seed)

- **Back office**: `owner@demokopitiam.my` / `password12345`
- **POS / KDS PIN**: `1234` (owner) or `5678` (cashier)

### First-run walkthrough

1. Open the **back office** (`:5176`), sign in, go to **Devices → + Register device**, create a `POS` device and copy the one-time token.
2. Open the **POS** (`:5173`), paste the device token, then unlock with PIN `5678`. Sell something.
3. Register a `KDS` device the same way for the kitchen display (`:5174`) — orders appear in real time.
4. For QR ordering: **Tables & QR** in the back office shows each table's QR (encodes `http://localhost:5175/?t=<qrToken>`); open that URL to order as a customer.
5. **Print bridge** (optional): register a `PRINT_BRIDGE` device, then:
   ```bash
   cd apps/print-bridge
   cp printers.example.json printers.json   # point at your printers, or use {"receipt":{"type":"console"}}
   DEVICE_TOKEN=<token> pnpm dev
   ```
6. Simulate a QR-wallet payment (mock gateway): choose **QR / eWallet** at tender, then confirm the "scan" with:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/mock -H 'Content-Type: application/json' \
     -d '{"ref":"<providerRef from the gateway payment>","status":"completed","secret":"mock-secret"}'
   ```

## Tests

```bash
pnpm test        # unit tests (shared money/tax pipeline, POS offline sync engine)
pnpm typecheck   # all packages
pnpm e2e         # full end-to-end suites (needs devdb running + workspace built;
                 # boots its own API + print bridge, ~250 checks)
```

The e2e suites live in `e2e/` (API flows, Python) plus `apps/kds/e2e/` (socket flows) and `apps/pos/e2e/` (offline-sync parity). CI runs all of them against a fresh Postgres on every push — see `.github/workflows/ci.yml`.

> Local reruns are tolerated, but for a bit-exact CI-equivalent run start clean: stop devdb, `rm -rf packages/db/.devdb`, restart it, `npx prisma migrate deploy`, then `pnpm e2e`.

## Configuration (apps/api/.env)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | **Required in production**; dev fallback otherwise |
| `MOCK_GATEWAY_SECRET` | Secret for the dev payment-gateway webhook |
| `HITPAY_API_KEY` / `HITPAY_SALT` / `HITPAY_SANDBOX` | Enables the real HitPay adapter (PayNow/cards/wallets) |
| `MYINVOIS_CLIENT_ID` / `MYINVOIS_CLIENT_SECRET` / `MYINVOIS_SANDBOX` | Enables the real LHDN MyInvois e-invoice adapter |
| `PUBLIC_API_URL` | Public base URL used in gateway webhook callbacks |

## Deployment (Docker)

The whole stack ships as two images (API + web) plus Postgres:

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

- POS `:8081` · KDS `:8082` · QR ordering `:8083` · Back office `:8084` · API `:3000`
- The API container applies pending migrations on boot.
- nginx inside the web image serves each app and proxies `/api` + `/socket.io` to the API, so the same-origin assumption holds; put your TLS terminator (Caddy/Traefik/cloud LB) in front and map one (sub)domain per port.
- Export `HITPAY_*` / `MYINVOIS_*` before `docker compose up` to enable the real integrations; mock providers are off in production unless `MOCK_*_ENABLED=true`.
- The **print bridge** runs on-site (shop PC / Raspberry Pi), not in compose — see the walkthrough above.
- Works as-is on any Docker host (VPS, Fly.io, Railway, etc.); for managed platforms, deploy `deploy/Dockerfile.api` and `deploy/Dockerfile.web` as two services and point `DATABASE_URL` at managed Postgres.

## Production notes

- Rate limiting is built in: credential endpoints (staff login, PIN, QR/bridge sessions) allow 30 requests/min/IP, everything else 600/min (`THROTTLE_AUTH_LIMIT` / `THROTTLE_GLOBAL_LIMIT` to tune). Real client IPs are honored behind the bundled nginx (`trustProxy`).
- Apply schema with `npx prisma migrate deploy` (never `db push`) against managed Postgres.
- Set `NODE_ENV=production` (enforces `JWT_SECRET`, disables mock providers unless explicitly enabled).
- Payment/aggregator webhooks need `PUBLIC_API_URL` to be reachable from the internet.
- Schedule Postgres backups (managed-DB snapshots or `pg_dump`).
- Known gaps before real-money/real-payroll use: MyInvois X.509 document signing, official EPF/SOCSO/EIS bracket tables + PCB, gateway refund flow.
