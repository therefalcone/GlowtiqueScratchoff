# Project: Scratch-off loyalty cards (v1)

You are building a web app for Glowtique Salon & MedSpa (one business, not multi-tenant). Staff create scratch-off campaigns and generate a unique link per card. Staff share the links themselves; the app does not send anything. The recipient opens the link, scratches to reveal a pre-assigned reward, and the reward lands in their account for staff to redeem.

## How to work
- Plan first. Read this spec and the design exports in /design, save this spec as docs/SPEC.md, then write docs/PLAN.md with the schema, routes, and a phase checklist. Stop for my approval before writing code.
- Build one phase at a time. At the end of each phase: run tests, update the checklist in docs/PLAN.md, summarize in under 10 lines, and stop.
- Do not add features, dependencies, or abstractions that are not in this spec. If something is ambiguous, ask one question instead of guessing.
- /design is the source of truth for UI. Match it; do not redesign.

## Stack
Next.js (App Router) + TypeScript, Postgres via Supabase (auth, RLS), Tailwind, Vitest. Deploy to Vercel. No messaging providers.

## Roles
- Staff/admin: email login. Manage campaigns, generate card links, view customers, redeem rewards.
- Customer: no password and no login. Arrives by card link; returns to their wallet through a private wallet link.

## Data model (rename freely, keep the concepts)
- campaigns: name, mode ('weighted' | 'fixed_pool'), status (draft / active / closed), starts_at, ends_at, card_expiry_days, reward_expiry_days, official_rules_url
- campaign_rewards: campaign_id, title, description, terms, retail_value_cents, weight (weighted mode), quantity_total and quantity_remaining (fixed mode)
- customers: first_name, last_name, phone (E.164), email, sms_opt_in + timestamp, email_opt_in + timestamp, wallet_token, source
- cards: campaign_id, token, campaign_reward_id (the outcome), customer_id (nullable until captured), label (optional free text), status (created / opened / revealed / expired / void), a timestamp per status
- customer_rewards: customer_id, card_id, campaign_reward_id, redemption_code, status (available / redeemed / expired / void), expires_at, redeemed_at, redeemed_by
- audit_log: actor, action, entity, before/after, timestamp. Append-only.

## Reward engine (the core; build and test it first)
- The outcome is drawn on the server when the card is generated, using a CSPRNG (crypto.randomInt), and stored on the card. It never reaches the client before reveal.
- Weighted mode: each card is an independent draw by weight. Weights are relative; the UI shows normalized percentages.
- Fixed pool mode: draw without replacement. Pick among rewards with probability proportional to quantity_remaining, then decrement, in one transaction with row locking. Generation fails cleanly when the pool is empty. 99 of A plus 1 of B must yield exactly 99 A and 1 B across 100 cards.
- Once a campaign has generated any card, its rewards, weights, and quantities are locked. To change them, clone into a new campaign.
- No one can choose or change an individual card's outcome. Every draw writes an audit_log row. A guaranteed gift is simply a campaign with one reward.
- Tests: distribution test for weighted mode (large sample, within tolerance), exact-count test for fixed pool, concurrent generation test (no over-draw), locked-campaign test.

## Customer flow
1. GET /c/[token]: validate the token and show the unscratched card. No reward data in the page payload.
2. If the card has no linked customer, show a short form: first name, mobile, email, and separate unchecked SMS and email opt-in boxes. Match existing customers by phone, then email; otherwise create one. Attach the customer to the card.
3. Scratch: canvas overlay, touch and mouse. On the first scratch stroke call POST /api/cards/[token]/reveal. The server atomically marks the card revealed, creates the customer_reward, and returns the reward. Render it under the foil and auto-clear the foil at about 55% scratched. Include a "Reveal" button for keyboard and screen-reader users, and honor prefers-reduced-motion.
4. Reveal is idempotent: reloading shows the same revealed reward. Expired, void, and invalid tokens get clear dead-end screens.
5. Wallet at /w/[wallet_token]: list and detail views with redemption code and QR. After reveal, show the wallet link with "Save this link" and a copy button. Reopening a revealed card link also links through to that customer's wallet.

## Admin
- Campaigns: list, create and edit (draft only), clone, activate, close. Pool editor with mode toggle, live odds per reward, total cards (fixed mode), total retail prize value, and a visible warning when total prize value exceeds $5,000.
- Generate links: create one card or a batch of N for a campaign, with an optional label per card or per batch. Show results as a list: link, label, status, a copy button per link, and a QR per link. Export the batch as CSV (link, label, created_at). Never show or export the outcome. Staff can void an unrevealed card.
- Customers: search, profile with consent status, cards, rewards. Staff can copy a customer's wallet link and regenerate it if it is lost or shared.
- Redeem: enter or scan code, show reward and customer, confirm. One-time and audited.
- Reports per campaign: generated, opened, revealed, redeemed, outcome breakdown, CSV export.

## Security
Card and wallet tokens are at least 128 bits and URL-safe. Rate-limit token lookups. RLS so wallet pages read only that customer's rewards; all writes go through server routes. Secrets in env only.

## Out of scope for v1
Sending SMS or email from the app, customer login, multi-business support, booking or POS integration, payments, native apps, referrals, public "anyone can play" links.

## Phases
1. Schema, migrations, reward engine, tests.
2. Admin auth, campaigns, pool editor.
3. Link generation (single, batch, CSV, QR), public card page with scratch and reveal.
4. Customer capture, wallet link, redemption.
5. Reports, audit log viewer, edge states, accessibility pass.
