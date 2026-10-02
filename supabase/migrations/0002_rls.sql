-- RLS and privileges. Posture: the browser never talks to Postgres directly —
-- all reads and writes go through Next.js server code. RLS is defense in
-- depth: anon gets nothing, authenticated staff get read-only, writes only via
-- the server's service-role/owner connection. Wallet/card pages are rendered
-- server-side and scoped by token, so a wallet page can only ever show that
-- customer's rewards.
--
-- Requires the Supabase roles (anon, authenticated, service_role) and
-- auth.uid(); the test harness stubs these for local Postgres.

alter table campaigns enable row level security;
alter table campaign_rewards enable row level security;
alter table customers enable row level security;
alter table card_batches enable row level security;
alter table cards enable row level security;
alter table customer_rewards enable row level security;
alter table audit_log enable row level security;
alter table staff_users enable row level security;
alter table rate_limits enable row level security;

-- Client roles get no write privileges at all; anon gets no read either.
revoke all on all tables in schema public from anon, authenticated;

grant select on campaigns, campaign_rewards, customers, card_batches,
  cards, customer_rewards, audit_log, staff_users to authenticated;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users where user_id = auth.uid());
$$;

create policy staff_read_campaigns on campaigns
  for select to authenticated using (is_staff());
create policy staff_read_campaign_rewards on campaign_rewards
  for select to authenticated using (is_staff());
create policy staff_read_customers on customers
  for select to authenticated using (is_staff());
create policy staff_read_card_batches on card_batches
  for select to authenticated using (is_staff());
create policy staff_read_cards on cards
  for select to authenticated using (is_staff());
create policy staff_read_customer_rewards on customer_rewards
  for select to authenticated using (is_staff());
create policy staff_read_audit_log on audit_log
  for select to authenticated using (is_staff());
create policy staff_read_staff_users on staff_users
  for select to authenticated using (is_staff());
