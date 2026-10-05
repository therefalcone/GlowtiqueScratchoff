# PLAN — Glowtique scratch-off loyalty cards (v1)

Source of truth: `docs/SPEC.md` (requirements) and `/design` (UI). The design export
(`design/Glowtique Scratch Card.dc.html`) carries 12 screens: customer flow in direction
**1a "Gold foil on cream"** (01 landing, 02 info capture, 03 mid-scratch, 04 reveal,
05 wallet, 06 reward detail, 07a/b/c dead-ends) and five 1440px admin screens
(08 campaign list, 09 campaign builder, 10 generate links, 11 customer profile, 12 redeem)
built on the **Modernist** design system (`design/_ds/.../styles.css`: Archivo, 0 radius,
2px rules, ink `#201e1d` on `#f3f2f2`, accent `#ec3013`).

## Architecture decisions

- **Data access.** All reads and writes go through Next.js server code (route handlers +
  server actions). The browser never talks to Supabase directly. RLS is enabled on every
  table with **no anon policies** (deny-all) and read-only policies for authenticated staff;
  mutations use the service-role key server-side after verifying the staff session. Wallet
  and card pages are server-rendered: the server looks rows up by token, so a wallet page
  can only ever show that customer's rewards.
- **Staff auth.** Supabase email auth (magic link + password) via `@supabase/ssr`. A
  `staff_users` table (user_id → auth.users) is the allowlist; only listed users pass the
  `/admin` layout guard and RLS staff policies. Seeded by migration/SQL, no signup UI.
- **Reward engine transactions.** Fixed-pool draws need `SELECT … FOR UPDATE` +
  decrement + insert in one transaction, and the spec pins the CSPRNG to Node's
  `crypto.randomInt`. supabase-js has no transactions, so the engine uses the **`pg`**
  driver against the Supabase pooled connection string (`DATABASE_URL`). Draws happen in
  Node inside the transaction. Batch generation is all-or-nothing: if the pool can't cover
  N, the whole batch fails with a clear error and nothing is written.
- **Tokens.** Card and wallet tokens: 16 random bytes (`crypto.randomBytes`) →
  base64url, 22 chars, 128 bits. Redemption codes are short human-typeable codes in the
  design's format `GLW-XXXX-XX` (CSPRNG, unambiguous alphabet, unique index, retry on
  collision); they gate nothing by themselves — redemption is staff-authenticated.
- **Rate limiting.** Fixed-window per-IP counter in a small `rate_limits` table, checked
  in the token-lookup paths (`/c/[token]`, `/w/[wallet_token]`, claim/reveal APIs). No new
  infra; conservative limits (e.g. 30 lookups/min/IP) with a plain 429 page.
- **QR codes.** Server-generated SVGs via the `qrcode` package (card links in admin,
  redemption code on wallet detail).
- **CSV.** Hand-rolled (escape + join); no dependency.
- **Audit log.** Append-only enforced in Postgres: `REVOKE UPDATE, DELETE` + no RLS
  write policies; inserts only via server code. Actor is `staff:<uuid>`, `customer`, or
  `system`.
- **Card expiry.** `cards.expires_at` is stamped at generation from
  `campaigns.card_expiry_days` (and capped by `ends_at` if set); `customer_rewards.expires_at`
  from `reward_expiry_days` at reveal. Expiry is evaluated lazily on read (status flips to
  `expired` when past due) — no cron in v1.
- **Dependencies (full list).** `next`, `react`, `react-dom`, `typescript`, `tailwindcss`,
  `@supabase/supabase-js`, `@supabase/ssr`, `pg`, `qrcode`, `vitest` (+ types/dev tooling).
  Nothing else without asking.

## Schema (Postgres, one initial migration + per-phase additions)

```sql
create type campaign_mode  as enum ('weighted','fixed_pool');
create type campaign_status as enum ('draft','active','closed');
create type card_status    as enum ('created','opened','revealed','expired','void');
create type reward_status  as enum ('available','redeemed','expired','void');

campaigns (
  id uuid pk default gen_random_uuid(),
  name text not null,
  mode campaign_mode not null,
  status campaign_status not null default 'draft',
  starts_at timestamptz, ends_at timestamptz,
  card_expiry_days int, reward_expiry_days int,
  official_rules_url text,
  cloned_from_id uuid references campaigns(id),
  rewards_locked_at timestamptz,          -- set on first card generation
  created_at / updated_at timestamptz
)

campaign_rewards (
  id uuid pk, campaign_id uuid fk not null,
  title text not null, description text, terms text,
  retail_value_cents int not null default 0,
  weight int,                              -- weighted mode (> 0)
  quantity_total int, quantity_remaining int, -- fixed mode (>= 0, remaining <= total)
  position int not null default 0,
  check (quantity_remaining between 0 and quantity_total) -- fixed mode
)

customers (
  id uuid pk, first_name text, last_name text,
  phone text unique,                       -- E.164, nullable
  email citext,                            -- indexed, not unique (phone is primary match key)
  sms_opt_in bool not null default false,  sms_opt_in_at timestamptz,
  email_opt_in bool not null default false, email_opt_in_at timestamptz,
  wallet_token text unique not null,       -- 128-bit base64url
  source text,                             -- e.g. 'card:<campaign name>'
  created_at / updated_at timestamptz
)

card_batches (                             -- groups a generation run for CSV re-export
  id uuid pk, campaign_id uuid fk not null,
  label text, created_by uuid, created_at timestamptz
)

cards (
  id uuid pk, campaign_id uuid fk not null,
  token text unique not null,              -- 128-bit base64url
  campaign_reward_id uuid fk not null,     -- the pre-drawn outcome
  customer_id uuid fk,                     -- null until captured
  batch_id uuid references card_batches(id),
  label text,
  status card_status not null default 'created',
  expires_at timestamptz,
  created_at / opened_at / revealed_at / expired_at / voided_at timestamptz
)

customer_rewards (
  id uuid pk, customer_id uuid fk not null,
  card_id uuid fk not null unique,         -- unique ⇒ reveal idempotency at the DB level
  campaign_reward_id uuid fk not null,
  redemption_code text unique not null,    -- GLW-XXXX-XX
  status reward_status not null default 'available',
  expires_at timestamptz, redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id),
  created_at timestamptz
)

audit_log (
  id bigint identity pk,
  actor text not null, action text not null,
  entity_type text not null, entity_id text,
  before jsonb, after jsonb,
  created_at timestamptz not null default now()
)  -- append-only (revoke update/delete)

staff_users ( user_id uuid pk references auth.users(id), display_name text )
rate_limits ( key text, window_start timestamptz, count int, pk (key, window_start) )
```

Guards in the database, not just the app: a trigger rejects INSERT/UPDATE/DELETE on
`campaign_rewards` when the campaign's `rewards_locked_at` is set (engine decrements use a
session flag to pass); `customer_rewards.card_id` unique makes double-reveal impossible.

## Reward engine (`src/lib/server/engine.ts`, Phase 1)

- `generateCards({ campaignId, count, label?, batchLabel?, actor })` — one `pg`
  transaction: lock campaign row, verify active/draft + not expired; **weighted**: N
  independent `crypto.randomInt(totalWeight)` draws; **fixed_pool**:
  `SELECT … FOR UPDATE` the reward rows, then per card draw `crypto.randomInt(sumRemaining)`,
  map to a reward, decrement in place; fail the whole batch if remaining < N. Insert cards
  (token, outcome, expires_at, label, batch), set `rewards_locked_at` if first generation,
  one `audit_log` row per draw. Outcome never appears in any response, page payload, or CSV.
- `revealCard(token)` — transaction: `UPDATE cards SET status='revealed', revealed_at=now()
  WHERE token=$1 AND status IN ('created','opened') AND (not expired/void)`; on first reveal
  insert `customer_rewards` (code, expires_at) + audit; if already revealed return the
  existing reward (idempotent). Requires a linked customer.
- `redeemReward(code, staffId)` — transaction: lock row, must be `available` and unexpired,
  set redeemed + audit. One-time.

### Engine tests (Vitest, run against Postgres at `DATABASE_URL`)
- Weighted distribution: 10,000 draws over weights 40/30/20/8/2 → each share within
  tolerance (±2 points absolute).
- Fixed pool exact count: 99×A + 1×B → 100 cards, exactly 99 A and 1 B; 101st fails.
- Concurrency: pool of 50 drawn by 10 parallel batches of 5 → exactly 50 cards, remaining 0,
  no over-draw; parallel over-request fails cleanly.
- Locked campaign: reward edit after first generation is rejected (app + DB trigger).
- Reveal idempotency: two concurrent reveals → one `customer_reward`, same reward returned.

## Routes

### Public (customer, no auth — themed per design 1a)
| Route | Screen(s) in /design |
|---|---|
| `GET /c/[token]` | 01 landing · 02 info capture (no customer yet) · 03/04 scratch & reveal (customer linked) · 07a already-scratched (revealed by someone else / revisit) · 07b expired · void dead-end · 07c invalid token |
| `POST /api/cards/[token]/claim` | 02 — first name, mobile, email, two unchecked opt-ins; match by phone then email, else create; attach to card |
| `POST /api/cards/[token]/reveal` | 03→04 — called on first scratch stroke or the "Reveal" button; idempotent |
| `GET /w/[wallet_token]` | 05 wallet list with All/Available/Redeemed/Expired filters |
| `GET /w/[wallet_token]/rewards/[id]` | 06 reward detail: code, QR, terms, expiry |

Card page state machine: invalid → 07c; void → dead-end; expired → 07b; no customer →
02 capture; customer linked + not revealed → scratch (canvas overlay, touch + mouse +
"Reveal" button, reveal API on first stroke, auto-clear at ~55%, progress bar per 03,
confetti suppressed under `prefers-reduced-motion`); revealed → 04 for the linked
customer's session with wallet-link save/copy, 07a styling on revisit — both link through
to the wallet. First valid open flips `created → opened` (+ `opened_at`).

### Admin (staff auth, `/admin` layout guard — Modernist DS)
| Route | Screen |
|---|---|
| `GET /admin/login` | email login |
| `GET /admin/campaigns` | 08 list + stat tiles |
| `GET /admin/campaigns/new`, `/admin/campaigns/[id]` | 09 builder: name/dates/expiries/rules URL, pool editor with Odds ↔ Fixed-pool toggle, live normalized odds per reward, total cards (fixed = sum, weighted = planned count input), total retail prize value + avg per card, **warning banner when total prize value > $5,000**; editable in draft only; locked view shows Clone |
| server actions | create/update (draft only), activate, close, clone |
| `GET /admin/links` (`?campaign=`) | 10 generate: single or batch of N, label per batch and per card, results list with link + label + status + copy + QR, void unrevealed card |
| `GET /api/admin/batches/[id]/csv` | CSV: link, label, created_at — never the outcome |
| `GET /admin/customers`, `/admin/customers/[id]` | 11 search; profile: contact, consent + timestamps, card history, rewards, copy wallet link, regenerate wallet token |
| `GET /admin/redeem` | 12 enter/scan code → reward + customer + expiry → confirm (one-time, audited) |
| `GET /admin/campaigns/[id]/report` + `report.csv` | reports: generated/opened/revealed/redeemed, outcome breakdown |
| `GET /admin/audit` | audit log viewer (Phase 5) |

## UI implementation notes

- Tailwind theme maps the Modernist tokens (`design/_ds/.../styles.css`) — colors, Archivo
  via `next/font`, radius 0 everywhere, 2px divider rules; admin components follow the DS
  classes (`.btn-primary` solid accent, flush-left `.btn-block` labels, `.tag-*`, `.table`,
  `.field/.input`, `.seg`). Customer pages use the 1a palette exactly as in the export
  (cream `#f7f1e6`, ink `#1f1a14`, gold foil gradient, `#fffaf0` panels).
- Scratch foil: `<canvas>` painted with the 1a gold gradient + sheen, destination-out
  strokes for touch/mouse, percent-cleared sampling drives the 03 progress bar and the
  ~55% auto-clear; reveal panel is rendered under it only from the reveal API response.

## Deltas between /design and spec — assumptions (approve or correct)

1. **"Book now" buttons** (04/05/06/07): booking integration is out of scope → rendered as a
   plain external link from `NEXT_PUBLIC_BOOKING_URL`, hidden when unset.
2. **"Add to Apple Wallet"** (06): out of scope for v1 → omitted.
3. **07c "Have a card number? Enter it" / "Find my card"** and the **"Text us / Text the
   front desk"** buttons: there are no public card numbers (tokens only) and no messaging →
   invalid/dead-end pages keep the design's layout and copy tone, with the front-desk phone
   as static text; the number-lookup form and text-us actions are omitted.
4. **"Issue a card"** on the customer profile (11) links to `/admin/links` preselected for
   that campaign (cards attach to customers at claim time, not issuance).
5. Capture form (02) collects first name only, per spec; `last_name` stays a nullable column.
6. Design mock numbers ("NO. 0428 · 1 OF 500", service picker on redeem) are mock content:
   cards show a short token-derived display id, and redeem shows reward + customer + confirm
   without a POS-style service/price picker (POS is out of scope).

## Phase checklist

### Phase 1 — Schema, migrations, reward engine, tests ✅
- [x] Next.js + TS + Tailwind + Vitest scaffold; env wiring (`DATABASE_URL`, Supabase keys)
- [x] Migrations: enums, all tables, indexes, RLS deny-all + staff policies, audit append-only, lock trigger
- [x] Token/code generators (128-bit base64url; GLW-XXXX-XX)
- [x] Engine: `generateCards` (weighted + fixed pool, all-or-nothing, audit), `revealCard`, `redeemReward`
- [x] Tests: weighted distribution, fixed-pool exact count, concurrency no-over-draw, locked campaign, reveal idempotency — 19 tests, all passing against real Postgres

### Phase 2 — Admin auth, campaigns, pool editor ✅
- [x] Supabase email auth, `staff_users` allowlist, `/admin` guard + login page
- [x] Admin shell (sidebar per design) on Modernist tokens
- [x] Campaign list (08) with stat tiles; create/edit draft, activate, close, clone
- [x] Pool editor (09): mode toggle, live odds, totals, $5,000 warning; locked state → clone
- Notes: only **active** campaigns generate cards (engine tightened); the builder's
  "Total cards" in odds mode is a preview estimator, not persisted; reward description/terms
  (needed by the reveal and wallet screens) live behind a per-row "Details" toggle.

### Phase 3 — Links + public card page ✅
- [x] Generate single/batch with labels (10); results list with copy + QR; batch CSV; void card
- [x] Rate limiting on token lookups
- [x] `/c/[token]`: landing (01), scratch canvas + Reveal button + reduced-motion (03/04), reveal API, idempotent revisit, dead-ends (07b/c + void)
- Notes: one "Label" field stamps both the batch and each card (so the CSV carries it per
  link); voiding does not return a fixed-pool outcome to the pool; closing a campaign does
  not expire its outstanding cards (their own `expires_at` / campaign `ends_at` does); the
  02 capture screen is a placeholder until Phase 4 wires the claim form; link base URL
  comes from `NEXT_PUBLIC_APP_URL` or the request host.

### Phase 4 — Customer capture, wallet, redemption ✅
- [x] Capture form (02): match by phone→email, create, attach, consent timestamps
- [x] Reveal screen wallet-link save/copy (04); revealed card links through to wallet (07a)
- [x] Wallet list + filters (05), reward detail with code + QR (06)
- [x] Customers admin (11): search, profile, consent, copy/regenerate wallet link
- [x] Redeem (12): code entry, confirm, one-time, audited
- Notes: first name + mobile are required, email optional (email opt-in requires an email);
  an unchecked opt-in box never revokes an existing consent; the reward QR encodes the staff
  redeem URL with the code prefilled, so any phone camera "scans" it (no QR-decoding
  dependency); the design's POS service picker and "Add to Apple Wallet" are omitted per
  the approved deltas; reward expiry is applied lazily on wallet/admin reads (audited).

### Phase 5 — Reports, audit, edge states, a11y
- [ ] Per-campaign report + CSV export
- [ ] Audit log viewer
- [ ] Lazy expiry sweep on reads; remaining edge states polished
- [ ] Accessibility pass (keyboard reveal path, focus-visible, contrast, labels)
