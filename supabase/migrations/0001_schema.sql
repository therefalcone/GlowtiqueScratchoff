-- Glowtique scratch-off loyalty cards — core schema.
-- Pure Postgres (no Supabase-specific objects); RLS and grants live in 0002.

create type campaign_mode as enum ('weighted', 'fixed_pool');
create type campaign_status as enum ('draft', 'active', 'closed');
create type card_status as enum ('created', 'opened', 'revealed', 'expired', 'void');
create type reward_status as enum ('available', 'redeemed', 'expired', 'void');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode campaign_mode not null,
  status campaign_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  card_expiry_days integer check (card_expiry_days > 0),
  reward_expiry_days integer check (reward_expiry_days > 0),
  official_rules_url text,
  cloned_from_id uuid references campaigns(id),
  rewards_locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaign_rewards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  title text not null,
  description text,
  terms text,
  retail_value_cents integer not null default 0 check (retail_value_cents >= 0),
  weight integer check (weight is null or weight > 0),
  quantity_total integer check (quantity_total is null or quantity_total >= 0),
  quantity_remaining integer,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint quantity_remaining_bounds check (
    quantity_remaining is null
    or (quantity_remaining >= 0 and quantity_remaining <= quantity_total)
  )
);
create index campaign_rewards_campaign_idx on campaign_rewards (campaign_id);

create table customers (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  phone text unique,
  email text,
  sms_opt_in boolean not null default false,
  sms_opt_in_at timestamptz,
  email_opt_in boolean not null default false,
  email_opt_in_at timestamptz,
  wallet_token text unique not null,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_email_idx on customers (lower(email));

create table card_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  label text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  token text unique not null,
  campaign_reward_id uuid not null references campaign_rewards(id),
  customer_id uuid references customers(id),
  batch_id uuid references card_batches(id),
  label text,
  status card_status not null default 'created',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  revealed_at timestamptz,
  expired_at timestamptz,
  voided_at timestamptz
);
create index cards_campaign_idx on cards (campaign_id);
create index cards_customer_idx on cards (customer_id);
create index cards_batch_idx on cards (batch_id);

create table customer_rewards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  card_id uuid not null unique references cards(id),
  campaign_reward_id uuid not null references campaign_rewards(id),
  redemption_code text unique not null,
  status reward_status not null default 'available',
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid,
  created_at timestamptz not null default now()
);
create index customer_rewards_customer_idx on customer_rewards (customer_id);

create table audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create index audit_log_created_idx on audit_log (created_at);

-- Staff allowlist: user_id mirrors auth.users(id) in Supabase (no FK so the
-- schema stays portable; rows are seeded manually/by migration).
create table staff_users (
  user_id uuid primary key,
  display_name text,
  created_at timestamptz not null default now()
);

-- Fixed-window rate limiting for public token lookups.
create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- updated_at maintenance
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function set_updated_at();
create trigger customers_set_updated_at
  before update on customers
  for each row execute function set_updated_at();

-- audit_log is append-only, for every role including table owners.
create function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- Once a campaign has generated any card (rewards_locked_at set), its reward
-- pool is immutable except for the engine's quantity_remaining decrements.
create function enforce_rewards_lock() returns trigger
language plpgsql as $$
declare
  locked timestamptz;
begin
  select rewards_locked_at into locked
  from campaigns
  where id = coalesce(new.campaign_id, old.campaign_id);

  if locked is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    raise exception 'campaign rewards are locked once cards have been generated; clone the campaign to change them';
  end if;

  -- UPDATE: only quantity_remaining may change (engine draws decrement it).
  if row(new.campaign_id, new.title, new.description, new.terms,
         new.retail_value_cents, new.weight, new.quantity_total, new.position)
     is distinct from
     row(old.campaign_id, old.title, old.description, old.terms,
         old.retail_value_cents, old.weight, old.quantity_total, old.position)
  then
    raise exception 'campaign rewards are locked once cards have been generated; clone the campaign to change them';
  end if;

  return new;
end $$;

create trigger campaign_rewards_lock
  before insert or update or delete on campaign_rewards
  for each row execute function enforce_rewards_lock();
