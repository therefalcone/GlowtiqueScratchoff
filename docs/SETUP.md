# Setup — Supabase, local run, Vercel

## 1. Supabase project

1. Create a project at supabase.com (any region; note the database password you set).
2. **Postgres connection string** → `DATABASE_URL`
   - Dashboard → **Connect** (top bar) → pick the **Session pooler** string (port 5432) for
     local use and migrations, or the **Transaction pooler** (port 6543) for Vercel. Either
     works with this app; avoid the "direct" string (IPv6-only on some plans).
   - Append `?sslmode=require` to the string.
   - Example: `postgresql://postgres.abcd1234:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`
3. **API keys** → Project Settings → **API** (or "API Keys")
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` is listed in `.env.example` but not used yet; leave blank.
4. **Auth settings** → Authentication → Sign In / Providers
   - Email provider: keep **Email + password** enabled.
   - Turn **off** "Allow new users to sign up" — staff accounts are created by hand and
     gated by the `staff_users` allowlist anyway.

## 2. Apply the schema

From the repo, with `DATABASE_URL` pointing at Supabase:

```bash
npm install
DATABASE_URL='postgresql://...?sslmode=require' npm run db:migrate
```

This creates every table, the RLS policies, the audit-log and reward-lock triggers, and a
`schema_migrations` table so it is safe to re-run.

## 3. Create your staff login

1. Authentication → **Users** → **Add user** → *Create new user*: your email + a password,
   with **Auto Confirm User** checked.
2. Copy the new user's UUID, then in the SQL Editor:

```sql
insert into staff_users (user_id, display_name)
values ('<paste the user uuid>', 'Your Name');
```

Repeat for each staff member. Anyone not in `staff_users` is bounced from `/admin`.

## 4. Run locally

Create `.env.local` (git-ignored):

```
DATABASE_URL=postgresql://...?sslmode=require
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_BOOKING_URL=https://your-booking-page   # optional
```

Then `npm run dev` and open http://localhost:3000/admin — sign in, create a campaign,
publish it, generate links, and open one of the `/c/...` links on your phone (links use
the request host, so from a phone use your computer's LAN address or deploy to Vercel).

Tests need a local Postgres (`postgres://postgres:postgres@127.0.0.1:5432`, override with
`TEST_DATABASE_URL`); they never touch Supabase. `npm test`.

## 5. Vercel (recommended: skip local entirely)

The `vercel-build` script runs `npm run db:migrate` before `next build`, so every deploy
applies any pending migrations to the database in `DATABASE_URL`. No local step needed.

1. vercel.com → **Add New → Project** → import the GitHub repo. Framework preset Next.js,
   defaults are fine.
2. **Environment variables** (apply to Production and Preview):
   - `DATABASE_URL` — Supabase **Transaction pooler** string (port 6543) with `?sslmode=require`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_APP_URL` — leave unset until you have a custom domain; links use the
     deployment's own host until then
   - `NEXT_PUBLIC_BOOKING_URL` — optional
3. **Deploy.** The build log should show `applied 0001_schema.sql`, `applied 0002_rls.sql`.
4. Code lives on `claude/zen-cray-i0xpng` until it is merged: either merge it to `main`,
   or set **Settings → Git → Production Branch** to `claude/zen-cray-i0xpng` so pushes to it
   deploy to production.
5. Create your staff login (section 3), then open `https://<project>.vercel.app/admin`.

## Checklist

- [ ] Supabase project created, pooled `DATABASE_URL` with `?sslmode=require`
- [ ] `npm run db:migrate` ran clean
- [ ] Staff user created in Auth and inserted into `staff_users`
- [ ] Public sign-ups disabled
- [ ] `.env.local` (local) and/or Vercel env vars set
- [ ] Signed in at `/admin`, campaign published, a card link opens on a phone
