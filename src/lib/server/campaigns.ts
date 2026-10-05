import type { Pool, PoolClient } from "pg";
import { type CampaignMode, type PoolRow, validatePool } from "../pool-math";
import { withTransaction } from "./db";
import { CampaignNotFoundError, CampaignStateError, InvalidRewardConfigError } from "./errors";

export type CampaignStatus = "draft" | "active" | "closed";

export interface CampaignInput {
  name: string;
  mode: CampaignMode;
  startsAt: Date | null;
  endsAt: Date | null;
  cardExpiryDays: number | null;
  rewardExpiryDays: number | null;
  officialRulesUrl: string | null;
  rewards: RewardInput[];
}

export interface RewardInput extends PoolRow {
  description: string | null;
  terms: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  mode: CampaignMode;
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  cardExpiryDays: number | null;
  rewardExpiryDays: number | null;
  officialRulesUrl: string | null;
  clonedFromId: string | null;
  rewardsLockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignReward extends RewardInput {
  id: string;
  quantityRemaining: number | null;
  position: number;
}

export interface CampaignWithRewards extends Campaign {
  rewards: CampaignReward[];
  generatedCount: number;
}

export interface CampaignListRow extends Campaign {
  generated: number;
  revealed: number;
  redeemed: number;
}

export interface CampaignStats {
  liveCampaigns: number;
  revealedLast30Days: number;
  redeemedLast30Days: number;
  /** redeemed / revealed, all time; null when nothing revealed yet */
  redemptionRate: number | null;
  cardsIssuedThisYear: number;
  campaignCount: number;
}

function mapCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    name: row.name as string,
    mode: row.mode as CampaignMode,
    status: row.status as CampaignStatus,
    startsAt: (row.starts_at as Date | null) ?? null,
    endsAt: (row.ends_at as Date | null) ?? null,
    cardExpiryDays: (row.card_expiry_days as number | null) ?? null,
    rewardExpiryDays: (row.reward_expiry_days as number | null) ?? null,
    officialRulesUrl: (row.official_rules_url as string | null) ?? null,
    clonedFromId: (row.cloned_from_id as string | null) ?? null,
    rewardsLockedAt: (row.rewards_locked_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function mapReward(row: Record<string, unknown>): CampaignReward {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    terms: (row.terms as string | null) ?? null,
    retailValueCents: row.retail_value_cents as number,
    weight: (row.weight as number | null) ?? null,
    quantityTotal: (row.quantity_total as number | null) ?? null,
    quantityRemaining: (row.quantity_remaining as number | null) ?? null,
    position: row.position as number,
  };
}

function validateInput(input: CampaignInput): void {
  if (!input.name.trim()) throw new InvalidRewardConfigError("Campaign name is required.");
  if (input.mode !== "weighted" && input.mode !== "fixed_pool") {
    throw new InvalidRewardConfigError("Unknown campaign mode.");
  }
  for (const [label, days] of [
    ["Card expiry", input.cardExpiryDays],
    ["Reward expiry", input.rewardExpiryDays],
  ] as const) {
    if (days != null && (!Number.isInteger(days) || days <= 0)) {
      throw new InvalidRewardConfigError(`${label} must be a positive number of days.`);
    }
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw new InvalidRewardConfigError("End date must be after the start date.");
  }
  // Drafts may be saved with an incomplete pool; row-level sanity still applies.
  for (const r of input.rewards) {
    if (!r.title.trim()) throw new InvalidRewardConfigError("Every reward needs a name.");
    if (!Number.isInteger(r.retailValueCents) || r.retailValueCents < 0) {
      throw new InvalidRewardConfigError(`"${r.title}" needs a retail value of $0 or more.`);
    }
    if (r.weight != null && (!Number.isInteger(r.weight) || r.weight <= 0)) {
      throw new InvalidRewardConfigError(`"${r.title}" weight must be a positive whole number.`);
    }
    if (r.quantityTotal != null && (!Number.isInteger(r.quantityTotal) || r.quantityTotal < 0)) {
      throw new InvalidRewardConfigError(`"${r.title}" quantity must be 0 or more.`);
    }
  }
}

async function insertRewards(
  client: PoolClient,
  campaignId: string,
  rewards: RewardInput[],
  mode: CampaignMode
): Promise<void> {
  for (const [i, r] of rewards.entries()) {
    const weight = mode === "weighted" ? r.weight : null;
    const qty = mode === "fixed_pool" ? r.quantityTotal : null;
    await client.query(
      `insert into campaign_rewards
         (campaign_id, title, description, terms, retail_value_cents,
          weight, quantity_total, quantity_remaining, position)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
      [campaignId, r.title.trim(), r.description, r.terms, r.retailValueCents, weight, qty, i]
    );
  }
}

async function audit(
  client: PoolClient,
  actor: string,
  action: string,
  campaignId: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await client.query(
    `insert into audit_log (actor, action, entity_type, entity_id, before, after)
     values ($1, $2, 'campaign', $3, $4, $5)`,
    [actor, action, campaignId, JSON.stringify(before ?? null), JSON.stringify(after ?? null)]
  );
}

async function loadForUpdate(client: PoolClient, id: string): Promise<CampaignWithRewards> {
  const c = await client.query("select * from campaigns where id = $1 for update", [id]);
  if (c.rowCount === 0) throw new CampaignNotFoundError(id);
  const r = await client.query(
    "select * from campaign_rewards where campaign_id = $1 order by position, id",
    [id]
  );
  const g = await client.query("select count(*)::int as n from cards where campaign_id = $1", [id]);
  return { ...mapCampaign(c.rows[0]), rewards: r.rows.map(mapReward), generatedCount: g.rows[0].n };
}

export async function getCampaign(pool: Pool, id: string): Promise<CampaignWithRewards | null> {
  const c = await pool.query("select * from campaigns where id = $1", [id]);
  if (c.rowCount === 0) return null;
  const r = await pool.query(
    "select * from campaign_rewards where campaign_id = $1 order by position, id",
    [id]
  );
  const g = await pool.query("select count(*)::int as n from cards where campaign_id = $1", [id]);
  return { ...mapCampaign(c.rows[0]), rewards: r.rows.map(mapReward), generatedCount: g.rows[0].n };
}

export async function createCampaign(
  pool: Pool,
  input: CampaignInput,
  actor: string
): Promise<string> {
  validateInput(input);
  return withTransaction(pool, async (client) => {
    const res = await client.query(
      `insert into campaigns
         (name, mode, status, starts_at, ends_at, card_expiry_days, reward_expiry_days, official_rules_url)
       values ($1, $2, 'draft', $3, $4, $5, $6, $7) returning id`,
      [
        input.name.trim(),
        input.mode,
        input.startsAt,
        input.endsAt,
        input.cardExpiryDays,
        input.rewardExpiryDays,
        input.officialRulesUrl,
      ]
    );
    const id: string = res.rows[0].id;
    await insertRewards(client, id, input.rewards, input.mode);
    await audit(client, actor, "campaign.created", id, null, { ...input, id });
    return id;
  });
}

/** Full replace of a draft campaign (fields and reward pool). Drafts only. */
export async function updateCampaign(
  pool: Pool,
  id: string,
  input: CampaignInput,
  actor: string
): Promise<void> {
  validateInput(input);
  await withTransaction(pool, async (client) => {
    const before = await loadForUpdate(client, id);
    if (before.status !== "draft") {
      throw new CampaignStateError("Only draft campaigns can be edited. Clone it to make changes.");
    }
    if (before.rewardsLockedAt) {
      throw new CampaignStateError("This campaign's rewards are locked. Clone it to make changes.");
    }
    await client.query(
      `update campaigns
          set name = $2, mode = $3, starts_at = $4, ends_at = $5,
              card_expiry_days = $6, reward_expiry_days = $7, official_rules_url = $8
        where id = $1`,
      [
        id,
        input.name.trim(),
        input.mode,
        input.startsAt,
        input.endsAt,
        input.cardExpiryDays,
        input.rewardExpiryDays,
        input.officialRulesUrl,
      ]
    );
    await client.query("delete from campaign_rewards where campaign_id = $1", [id]);
    await insertRewards(client, id, input.rewards, input.mode);
    await audit(client, actor, "campaign.updated", id, before, { ...input, id });
  });
}

/** draft → active. The pool must be valid for the campaign's mode. */
export async function activateCampaign(pool: Pool, id: string, actor: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const c = await loadForUpdate(client, id);
    if (c.status !== "draft") {
      throw new CampaignStateError(`Campaign is already ${c.status}.`);
    }
    const problem = validatePool(c.mode, c.rewards);
    if (problem) throw new InvalidRewardConfigError(problem);
    await client.query("update campaigns set status = 'active' where id = $1", [id]);
    await audit(client, actor, "campaign.activated", id, { status: "draft" }, { status: "active" });
  });
}

/** active → closed. */
export async function closeCampaign(pool: Pool, id: string, actor: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const c = await loadForUpdate(client, id);
    if (c.status !== "active") {
      throw new CampaignStateError(`Only active campaigns can be closed (this one is ${c.status}).`);
    }
    await client.query("update campaigns set status = 'closed' where id = $1", [id]);
    await audit(client, actor, "campaign.closed", id, { status: "active" }, { status: "closed" });
  });
}

/** Copies a campaign and its reward pool into a fresh, unlocked draft. */
export async function cloneCampaign(pool: Pool, id: string, actor: string): Promise<string> {
  return withTransaction(pool, async (client) => {
    const src = await loadForUpdate(client, id);
    const res = await client.query(
      `insert into campaigns
         (name, mode, status, starts_at, ends_at, card_expiry_days, reward_expiry_days,
          official_rules_url, cloned_from_id)
       values ($1, $2, 'draft', $3, $4, $5, $6, $7, $8) returning id`,
      [
        `${src.name} (copy)`,
        src.mode,
        src.startsAt,
        src.endsAt,
        src.cardExpiryDays,
        src.rewardExpiryDays,
        src.officialRulesUrl,
        id,
      ]
    );
    const newId: string = res.rows[0].id;
    await insertRewards(client, newId, src.rewards, src.mode);
    await audit(client, actor, "campaign.cloned", newId, null, { cloned_from_id: id });
    return newId;
  });
}

export async function listCampaigns(pool: Pool): Promise<CampaignListRow[]> {
  const res = await pool.query(`
    select c.*,
           coalesce(s.generated, 0)::int as generated,
           coalesce(s.revealed, 0)::int  as revealed,
           coalesce(s.redeemed, 0)::int  as redeemed
      from campaigns c
      left join (
        select cd.campaign_id,
               count(*) as generated,
               count(*) filter (where cd.status = 'revealed') as revealed,
               count(cr.id) filter (where cr.status = 'redeemed') as redeemed
          from cards cd
          left join customer_rewards cr on cr.card_id = cd.id
         group by cd.campaign_id
      ) s on s.campaign_id = c.id
     order by (c.status = 'active') desc, c.created_at desc
  `);
  return res.rows.map((row) => ({
    ...mapCampaign(row),
    generated: row.generated,
    revealed: row.revealed,
    redeemed: row.redeemed,
  }));
}

export async function campaignStats(pool: Pool): Promise<CampaignStats> {
  const res = await pool.query(`
    select
      (select count(*)::int from campaigns)                                   as campaign_count,
      (select count(*)::int from campaigns where status = 'active')           as live,
      (select count(*)::int from cards
        where revealed_at >= now() - interval '30 days')                      as revealed_30,
      (select count(*)::int from customer_rewards
        where redeemed_at >= now() - interval '30 days')                      as redeemed_30,
      (select count(*)::int from cards where status = 'revealed')             as revealed_all,
      (select count(*)::int from customer_rewards where status = 'redeemed')  as redeemed_all,
      (select count(*)::int from cards
        where created_at >= date_trunc('year', now()))                        as issued_year
  `);
  const r = res.rows[0];
  return {
    campaignCount: r.campaign_count,
    liveCampaigns: r.live,
    revealedLast30Days: r.revealed_30,
    redeemedLast30Days: r.redeemed_30,
    redemptionRate: r.revealed_all ? r.redeemed_all / r.revealed_all : null,
    cardsIssuedThisYear: r.issued_year,
  };
}
