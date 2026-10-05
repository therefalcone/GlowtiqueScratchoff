import type { Pool, PoolClient } from "pg";
import { cardDisplayNumber, TOKEN_RE } from "../card-display";
import { isValidEmail, normalizePhone } from "../phone";
import { withTransaction } from "./db";
import { ValidationError } from "./errors";
import { generateToken, normalizeRedemptionCode } from "./tokens";

/* ─────────────────────────── claim (capture form) ─────────────────────────── */

export interface ClaimInput {
  firstName: string;
  phone: string;
  email: string | null;
  smsOptIn: boolean;
  emailOptIn: boolean;
  /** recorded in the audit trail with the consent */
  ip?: string | null;
}

export type ClaimResult =
  | { state: "claimed"; customerId: string; walletToken: string }
  | { state: "not_found" }
  | { state: "expired" }
  | { state: "void" }
  | { state: "revealed" };

function validateClaim(input: ClaimInput): { firstName: string; phone: string; email: string | null } {
  const firstName = input.firstName.trim();
  if (!firstName) throw new ValidationError("Enter your first name.", "firstName");
  if (firstName.length > 80) throw new ValidationError("That name is too long.", "firstName");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ValidationError("Enter a valid mobile number.", "phone");
  const emailRaw = input.email?.trim() ?? "";
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  if (email && !isValidEmail(email)) throw new ValidationError("Enter a valid email address.", "email");
  if (input.emailOptIn && !email) throw new ValidationError("Add your email to receive emails.", "email");
  return { firstName, phone, email };
}

async function audit(
  client: PoolClient,
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await client.query(
    `insert into audit_log (actor, action, entity_type, entity_id, before, after)
     values ($1, $2, $3, $4, $5, $6)`,
    [actor, action, entityType, entityId, JSON.stringify(before ?? null), JSON.stringify(after ?? null)]
  );
}

/**
 * Attaches a customer to an unclaimed card. Matches existing customers by
 * phone, then email; otherwise creates one. Opt-ins only ever turn on here
 * (an unchecked box is "no new consent", not a revocation). Idempotent for a
 * card that already has a customer.
 */
export async function claimCard(pool: Pool, token: string, input: ClaimInput): Promise<ClaimResult> {
  if (!TOKEN_RE.test(token)) return { state: "not_found" };
  const clean = validateClaim(input);
  const actor = "customer";

  return withTransaction(pool, async (client) => {
    const cardRes = await client.query(
      `select c.*, cp.name as campaign_name
         from cards c join campaigns cp on cp.id = c.campaign_id
        where c.token = $1 for update of c`,
      [token]
    );
    if (cardRes.rowCount === 0) return { state: "not_found" };
    const card = cardRes.rows[0];
    const now = new Date();

    if ((card.status === "created" || card.status === "opened") && card.expires_at != null && card.expires_at <= now) {
      await client.query("update cards set status = 'expired', expired_at = $2 where id = $1", [card.id, now]);
      return { state: "expired" };
    }
    if (card.status === "expired") return { state: "expired" };
    if (card.status === "void") return { state: "void" };
    if (card.status === "revealed") return { state: "revealed" };

    if (card.customer_id) {
      const existing = await client.query("select wallet_token from customers where id = $1", [card.customer_id]);
      return { state: "claimed", customerId: card.customer_id, walletToken: existing.rows[0].wallet_token };
    }

    let customer = (
      await client.query("select * from customers where phone = $1 for update", [clean.phone])
    ).rows[0];
    if (!customer && clean.email) {
      customer = (
        await client.query(
          "select * from customers where lower(email) = $1 order by created_at limit 1 for update",
          [clean.email]
        )
      ).rows[0];
    }

    let customerId: string;
    let walletToken: string;
    if (!customer) {
      walletToken = generateToken();
      const created = await client.query(
        `insert into customers
           (first_name, phone, email, sms_opt_in, sms_opt_in_at, email_opt_in, email_opt_in_at, wallet_token, source)
         values ($1, $2, $3, $4, case when $4 then $6::timestamptz end, $5, case when $5 then $6::timestamptz end, $7, $8)
         returning id`,
        [
          clean.firstName,
          clean.phone,
          clean.email,
          input.smsOptIn,
          input.emailOptIn,
          now,
          walletToken,
          `card:${card.campaign_name}`,
        ]
      );
      customerId = created.rows[0].id;
      await audit(client, actor, "customer.created", "customer", customerId, null, {
        first_name: clean.firstName,
        phone: clean.phone,
        email: clean.email,
        sms_opt_in: input.smsOptIn,
        email_opt_in: input.emailOptIn,
        card_id: card.id,
        ip: input.ip ?? null,
      });
    } else {
      customerId = customer.id;
      walletToken = customer.wallet_token;
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (!customer.first_name) after.first_name = clean.firstName;
      if (!customer.phone) after.phone = clean.phone;
      if (!customer.email && clean.email) after.email = clean.email;
      if (input.smsOptIn && !customer.sms_opt_in) {
        before.sms_opt_in = false;
        after.sms_opt_in = true;
      }
      if (input.emailOptIn && !customer.email_opt_in) {
        before.email_opt_in = false;
        after.email_opt_in = true;
      }
      if (Object.keys(after).length > 0) {
        await client.query(
          `update customers
              set first_name = coalesce(first_name, $2),
                  phone = coalesce(phone, $3),
                  email = coalesce(email, $4),
                  sms_opt_in = sms_opt_in or $5,
                  sms_opt_in_at = case when not sms_opt_in and $5 then $7::timestamptz else sms_opt_in_at end,
                  email_opt_in = email_opt_in or $6,
                  email_opt_in_at = case when not email_opt_in and $6 then $7::timestamptz else email_opt_in_at end
            where id = $1`,
          [customerId, clean.firstName, clean.phone, clean.email, input.smsOptIn, input.emailOptIn, now]
        );
        await audit(client, actor, "customer.updated", "customer", customerId, before, {
          ...after,
          card_id: card.id,
          ip: input.ip ?? null,
        });
      }
    }

    await client.query("update cards set customer_id = $2 where id = $1", [card.id, customerId]);
    await audit(client, actor, "card.claimed", "card", card.id, { customer_id: null }, {
      customer_id: customerId,
      ip: input.ip ?? null,
    });
    return { state: "claimed", customerId, walletToken };
  });
}

/* ─────────────────────────────── wallet (public) ─────────────────────────────── */

export type RewardStatus = "available" | "redeemed" | "expired" | "void";

export interface WalletReward {
  id: string;
  title: string;
  campaignName: string;
  status: RewardStatus;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redemptionCode: string;
}

export interface Wallet {
  customerId: string;
  firstName: string | null;
  walletToken: string;
  rewards: WalletReward[];
}

/** Flips overdue available rewards to expired (audited), for one customer or all. */
async function expireRewards(client: Pool | PoolClient, customerId: string | null): Promise<void> {
  await client.query(
    `with expired as (
       update customer_rewards
          set status = 'expired'
        where status = 'available' and expires_at is not null and expires_at <= now()
          and ($1::uuid is null or customer_id = $1)
        returning id
     )
     insert into audit_log (actor, action, entity_type, entity_id, before, after)
     select 'system', 'reward.expired', 'customer_reward', id, '{"status":"available"}', '{"status":"expired"}'
       from expired`,
    [customerId]
  );
}

const STATUS_ORDER = `case cr.status when 'available' then 0 when 'redeemed' then 1 else 2 end`;

export async function getWallet(pool: Pool, walletToken: string): Promise<Wallet | null> {
  if (!TOKEN_RE.test(walletToken)) return null;
  const cu = await pool.query("select id, first_name from customers where wallet_token = $1", [walletToken]);
  if (cu.rowCount === 0) return null;
  const customerId: string = cu.rows[0].id;
  await expireRewards(pool, customerId);
  const rewards = await pool.query(
    `select cr.id, cr.status, cr.expires_at, cr.redeemed_at, cr.redemption_code, r.title, cp.name as campaign_name
       from customer_rewards cr
       join campaign_rewards r on r.id = cr.campaign_reward_id
       join campaigns cp on cp.id = r.campaign_id
      where cr.customer_id = $1
      order by ${STATUS_ORDER}, cr.expires_at asc nulls last, cr.redeemed_at desc, cr.created_at desc`,
    [customerId]
  );
  return {
    customerId,
    firstName: cu.rows[0].first_name,
    walletToken,
    rewards: rewards.rows.map((r) => ({
      id: r.id,
      title: r.title,
      campaignName: r.campaign_name,
      status: r.status,
      expiresAt: r.expires_at,
      redeemedAt: r.redeemed_at,
      redemptionCode: r.redemption_code,
    })),
  };
}

export interface WalletRewardDetail extends WalletReward {
  description: string | null;
  terms: string | null;
  retailValueCents: number;
  customerFirstName: string | null;
  customerLastName: string | null;
  cardDisplayNumber: string;
}

/** Scoped by wallet token: a reward is only returned to its owner's wallet. */
export async function getWalletReward(pool: Pool, walletToken: string, rewardId: string): Promise<WalletRewardDetail | null> {
  if (!TOKEN_RE.test(walletToken) || !/^[0-9a-f-]{36}$/i.test(rewardId)) return null;
  const cu = await pool.query("select id from customers where wallet_token = $1", [walletToken]);
  if (cu.rowCount === 0) return null;
  await expireRewards(pool, cu.rows[0].id);
  const res = await pool.query(
    `select cr.id, cr.status, cr.expires_at, cr.redeemed_at, cr.redemption_code,
            r.title, r.description, r.terms, r.retail_value_cents,
            cp.name as campaign_name, cu.first_name, cu.last_name, c.token as card_token
       from customer_rewards cr
       join customers cu on cu.id = cr.customer_id
       join campaign_rewards r on r.id = cr.campaign_reward_id
       join campaigns cp on cp.id = r.campaign_id
       join cards c on c.id = cr.card_id
      where cu.wallet_token = $1 and cr.id = $2`,
    [walletToken, rewardId]
  );
  if (res.rowCount === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    title: r.title,
    campaignName: r.campaign_name,
    status: r.status,
    expiresAt: r.expires_at,
    redeemedAt: r.redeemed_at,
    redemptionCode: r.redemption_code,
    description: r.description,
    terms: r.terms,
    retailValueCents: r.retail_value_cents,
    customerFirstName: r.first_name,
    customerLastName: r.last_name,
    cardDisplayNumber: cardDisplayNumber(r.card_token),
  };
}

/* ─────────────────────────────── customers (admin) ─────────────────────────────── */

export interface CustomerRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  smsOptIn: boolean;
  emailOptIn: boolean;
  cards: number;
  availableRewards: number;
  createdAt: Date;
}

export async function searchCustomers(pool: Pool, query: string, limit = 50): Promise<CustomerRow[]> {
  const q = query.trim();
  const digits = q.replace(/\D/g, "");
  const res = await pool.query(
    `select cu.*,
            (select count(*)::int from cards where customer_id = cu.id) as cards,
            (select count(*)::int from customer_rewards where customer_id = cu.id and status = 'available') as available
       from customers cu
      where $1 = ''
         or cu.first_name ilike '%' || $1 || '%'
         or cu.last_name ilike '%' || $1 || '%'
         or (cu.first_name || ' ' || coalesce(cu.last_name, '')) ilike '%' || $1 || '%'
         or cu.email ilike '%' || $1 || '%'
         or ($2 <> '' and cu.phone like '%' || $2 || '%')
      order by cu.created_at desc
      limit $3`,
    [q, digits, limit]
  );
  return res.rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    email: r.email,
    smsOptIn: r.sms_opt_in,
    emailOptIn: r.email_opt_in,
    cards: r.cards,
    availableRewards: r.available,
    createdAt: r.created_at,
  }));
}

export interface CustomerProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  smsOptIn: boolean;
  smsOptInAt: Date | null;
  emailOptIn: boolean;
  emailOptInAt: Date | null;
  walletToken: string;
  source: string | null;
  createdAt: Date;
  cards: Array<{
    id: string;
    displayNumber: string;
    campaignName: string;
    status: string;
    createdAt: Date;
    revealedAt: Date | null;
    /** reward title once revealed; never exposed before */
    resultTitle: string | null;
  }>;
  rewards: Array<{
    id: string;
    title: string;
    redemptionCode: string;
    status: RewardStatus;
    expiresAt: Date | null;
    redeemedAt: Date | null;
  }>;
}

export async function getCustomerProfile(pool: Pool, id: string): Promise<CustomerProfile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const cu = await pool.query("select * from customers where id = $1", [id]);
  if (cu.rowCount === 0) return null;
  await expireRewards(pool, id);
  const cards = await pool.query(
    `select c.id, c.token, c.status, c.created_at, c.revealed_at, cp.name as campaign_name,
            case when c.status = 'revealed' then r.title end as result_title
       from cards c
       join campaigns cp on cp.id = c.campaign_id
       join campaign_rewards r on r.id = c.campaign_reward_id
      where c.customer_id = $1
      order by c.created_at desc`,
    [id]
  );
  const rewards = await pool.query(
    `select cr.id, cr.status, cr.expires_at, cr.redeemed_at, cr.redemption_code, r.title
       from customer_rewards cr join campaign_rewards r on r.id = cr.campaign_reward_id
      where cr.customer_id = $1
      order by ${STATUS_ORDER}, cr.created_at desc`,
    [id]
  );
  const c = cu.rows[0];
  return {
    id: c.id,
    firstName: c.first_name,
    lastName: c.last_name,
    phone: c.phone,
    email: c.email,
    smsOptIn: c.sms_opt_in,
    smsOptInAt: c.sms_opt_in_at,
    emailOptIn: c.email_opt_in,
    emailOptInAt: c.email_opt_in_at,
    walletToken: c.wallet_token,
    source: c.source,
    createdAt: c.created_at,
    cards: cards.rows.map((r) => ({
      id: r.id,
      displayNumber: cardDisplayNumber(r.token),
      campaignName: r.campaign_name,
      status: r.status,
      createdAt: r.created_at,
      revealedAt: r.revealed_at,
      resultTitle: r.result_title,
    })),
    rewards: rewards.rows.map((r) => ({
      id: r.id,
      title: r.title,
      redemptionCode: r.redemption_code,
      status: r.status,
      expiresAt: r.expires_at,
      redeemedAt: r.redeemed_at,
    })),
  };
}

/** Replaces a lost or shared wallet link. The old link stops working immediately. */
export async function regenerateWalletToken(pool: Pool, customerId: string, actor: string): Promise<string> {
  return withTransaction(pool, async (client) => {
    const cu = await client.query("select wallet_token from customers where id = $1 for update", [customerId]);
    if (cu.rowCount === 0) throw new ValidationError("Customer not found.");
    const next = generateToken();
    await client.query("update customers set wallet_token = $2 where id = $1", [customerId, next]);
    await audit(client, actor, "customer.wallet_regenerated", "customer", customerId,
      { wallet_token_tail: cu.rows[0].wallet_token.slice(-4) },
      { wallet_token_tail: next.slice(-4) });
    return next;
  });
}

/* ─────────────────────────────── redeem (admin) ─────────────────────────────── */

export interface RedeemLookup {
  id: string;
  title: string;
  description: string | null;
  retailValueCents: number;
  status: RewardStatus;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  redeemedBy: string | null;
  redemptionCode: string;
  campaignName: string;
  customer: { id: string; firstName: string | null; lastName: string | null; phone: string | null };
  card: { displayNumber: string; revealedAt: Date | null };
}

export async function lookupReward(pool: Pool, code: string): Promise<RedeemLookup | null> {
  const normalized = normalizeRedemptionCode(code);
  if (!normalized) return null;
  await expireRewards(pool, null);
  const res = await pool.query(
    `select cr.id, cr.status, cr.expires_at, cr.redeemed_at, cr.redeemed_by, cr.redemption_code,
            r.title, r.description, r.retail_value_cents, cp.name as campaign_name,
            cu.id as customer_id, cu.first_name, cu.last_name, cu.phone,
            c.token as card_token, c.revealed_at
       from customer_rewards cr
       join campaign_rewards r on r.id = cr.campaign_reward_id
       join campaigns cp on cp.id = r.campaign_id
       join customers cu on cu.id = cr.customer_id
       join cards c on c.id = cr.card_id
      where cr.redemption_code = $1`,
    [normalized]
  );
  if (res.rowCount === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    retailValueCents: r.retail_value_cents,
    status: r.status,
    expiresAt: r.expires_at,
    redeemedAt: r.redeemed_at,
    redeemedBy: r.redeemed_by,
    redemptionCode: r.redemption_code,
    campaignName: r.campaign_name,
    customer: { id: r.customer_id, firstName: r.first_name, lastName: r.last_name, phone: r.phone },
    card: { displayNumber: cardDisplayNumber(r.card_token), revealedAt: r.revealed_at },
  };
}

export async function recentRedemptions(pool: Pool, limit = 3): Promise<Array<{ code: string; title: string; redeemedAt: Date }>> {
  const res = await pool.query(
    `select cr.redemption_code, cr.redeemed_at, r.title
       from customer_rewards cr join campaign_rewards r on r.id = cr.campaign_reward_id
      where cr.status = 'redeemed'
      order by cr.redeemed_at desc limit $1`,
    [limit]
  );
  return res.rows.map((r) => ({ code: r.redemption_code, title: r.title, redeemedAt: r.redeemed_at }));
}
