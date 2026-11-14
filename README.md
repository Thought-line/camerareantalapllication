# LensLease — camera & gear rental demo

A small but complete rental application: browse a gear catalogue, check real availability
for a date range, build a cart, reserve it, and run the shop side (check-out, check-in,
inventory, revenue) from a staff dashboard.

**No dependencies and no build step.** Node's own `http` module serves the API and the
static frontend; data lives in a JSON file.

```bash
node server.js          # or: npm start
# → http://127.0.0.1:4173
```

Sign in with either demo account (no password):

| Account              | Role     | Sees                                        |
| -------------------- | -------- | ------------------------------------------- |
| `alex@demo.io`       | customer | catalogue, cart, own rentals                |
| `admin@lenslease.io` | staff    | everything, plus the **Staff** dashboard    |

`sam@demo.io` is a second customer, useful for showing two people competing for the same
single-stock item.

## What it demonstrates

- **Date-aware availability** — stock minus every overlapping active booking, recalculated
  whenever the pickup/return dates change. Items that are fully committed show "Booked out"
  and cannot be added.
- **Tiered pricing** — inclusive day count, 10% off at 3 days, 20% at 7, 25% at 14, an
  optional 9% damage waiver, 8.5% tax and a refundable deposit quoted separately.
- **Double-booking protection** — availability is re-checked server-side at reservation
  time, so two tabs racing for the last RED Komodo get a `409` instead of a conflict.
- **Booking lifecycle** — `reserved → picked_up → returned`, with `cancelled` from reserved
  only, and anything still out past its return date flipped to `overdue` on read.
- **Staff dashboard** — revenue, shelf utilisation, pickups and returns due today, most
  rented items, inline stock adjustment, add/remove gear, and a one-click demo reset.

## Try this path

1. Open the app, set pickup/return a few days apart — prices and availability update.
2. Add a **RED Komodo 6K** (stock: 1) and confirm the reservation as `alex@demo.io`.
3. Sign in as `sam@demo.io` and try the same dates — it now reads *Booked out*.
4. Sign in as `admin@lenslease.io` → **Staff** → check Alex's booking out, then back in.
   Utilisation and revenue move with it.
5. **Reset demo data** on the dashboard restores the original catalogue and bookings.

## Layout

```
server.js          HTTP server: routing, static files, JSON body parsing
src/api.js         REST handlers, demo sessions, validation, permissions
src/store.js       JSON persistence, availability maths, pricing engine
src/seed.js        12-item catalogue, 3 users, 2 opening bookings
public/index.html  app shell
public/styles.css  light studio theme (indigo accent)
public/app.js      hash-routed SPA: catalogue, detail, cart drawer, rentals, dashboard
data/db.json       created on first run (git-ignored); delete it to reseed
```

## API

| Method | Endpoint                    | Notes                                            |
| ------ | --------------------------- | ------------------------------------------------ |
| GET    | `/api/catalog`              | `from`, `to`, `search`, `category`, `brand`, `sort`, `availableOnly` |
| GET    | `/api/cameras/:id`          | one item + related, with availability             |
| POST   | `/api/cameras`              | staff — add gear                                  |
| PATCH  | `/api/cameras/:id`          | staff — edit price/stock                          |
| DELETE | `/api/cameras/:id`          | staff — blocked while on an active booking        |
| POST   | `/api/quote`                | price a cart without committing                   |
| GET    | `/api/bookings`             | own bookings, or all for staff                    |
| POST   | `/api/bookings`             | reserve; `409` if stock ran out                   |
| POST   | `/api/bookings/:id/status`  | `picked_up` / `returned` / `cancelled`            |
| GET    | `/api/stats`                | staff dashboard figures                           |
| POST   | `/api/auth/login`           | `{ email }` → bearer token                        |
| POST   | `/api/admin/reset`          | restore seed data                                 |

Set `PORT` or `HOST` to run somewhere else: `PORT=8080 node server.js`.

## Demo-only shortcuts

Sessions are in memory (restarting signs everyone out), login takes an email with no
password, there is no payment step, and writes go to a single JSON file with no locking.
Those are deliberate for a demo — not a template for production auth or storage.
