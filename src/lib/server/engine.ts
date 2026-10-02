import { randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "./db";
import {
  CampaignNotFoundError,
  CampaignStateError,
  InvalidRewardConfigError,
  PoolExhaustedError,
  RewardNotFoundError,
  RewardStateError,
} from "./errors";
import { generateRedemptionCode, generateToken } from "./tokens";

const DAY_MS = 86_400_000;
const MAX_BATCH = 10_000;
const INSERT_CHUNK = 500;

export interface GenerateCardsInput {
  campaignId: string;
  count: number;
  /** Applied to every card in this run (single-card label or batch-wide). */
  cardLabel?: string | null;
  /** Stored on the batch row, e.g. "Front desk · Week of Sep 28". */
  batchLabel?: string | null;
  actor: string;
  /** Staff auth user id, recorded on the batch. */
  createdBy?: string | null;
}

export interface GeneratedCard {
  id: string;
  token: string;
  label: string | null;
  status: "created";
  expiresAt: Date | null;
  createdAt: Date;
}

export interface GenerationResult {
  batchId: string;
  cards: GeneratedCard[];
}

export interface RevealedReward {
  title: string;
  description: string | null;
  terms: string | null;
  retailValueCents: number;
  redemptionCode: string;
  status: string;
  expiresAt: Date | null;
}

export type RevealResult =
  | { state: "not_found" }
  | { state: "expired" }
  | { state: "void" }
  | { state: "unclaimed" }
  | {
      state: "revealed";
      firstReveal: boolean;
      reward: RevealedReward;
      walletToken: string;
      revealedAt: Date;
    };

export interface RedeemResult {
  rewardId: string;
  title: string;
  redemptionCode: string;
  redeemedAt: Date;
  customerId: string;
}

async function insertAudit(
  client: PoolClient,
  rows: Array<{
    actor: string;
    action: string;
    entityType: string;
    entityId: string | null;
    before?: unknown;
    after?: unknown;
  }>
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const base = j * 6;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
      );
      params.push(
        r.actor,
        r.action,
        r.entityType,
        r.entityId,
        r.before === undefined ? null : JSON.stringify(r.before),
        r.after === undefined ? null : JSON.stringify(r.after)
      );
    });
    await client.query(
      `insert into audit_log (actor, action, entity_type, entity_id, before, after)
       values ${values.join(", ")}`,
      params
    );
  }
}

interface CampaignRow {
  id: string;
  mode: "weighted" | "fixed_pool";
  status: "draft" | "active" | "closed";
  ends_at: Date | null;
  card_expiry_days: number | null;
  reward_expiry_days: number | null;
  rewards_locked_at: Date | null;
}

function cardExpiry(campaign: CampaignRow, now: Date): Date | null {
  let expires: Date | null = null;
  if (campaign.card_expiry_days != null) {
    expires = new Date(now.getTime() + campaign.card_expiry_days * DAY_MS);
  }
  if (campaign.ends_at != null) {
    expires =
      expires == null || campaign.ends_at < expires ? campaign.ends_at : expires;
  }
  return expires;
}

/**
 * Generates `count` cards for a campaign, drawing each card's outcome on the
 * server with crypto.randomInt and storing it on the card. One transaction:
 * fixed-pool draws lock the reward rows (SELECT ... FOR UPDATE), decrement
 * quantity_remaining, and are all-or-nothing — if the pool cannot cover the
 * request, nothing is written. Every draw writes an audit_log row. The first
 * generation locks the campaign's reward pool. The outcome is never returned.
 */
export async function generateCards(
  pool: Pool,
  input: GenerateCardsInput
): Promise<GenerationResult> {
  const { campaignId, count, actor } = input;
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    throw new InvalidRewardConfigError(
      `count must be an integer between 1 and ${MAX_BATCH}`
    );
  }

  return withTransaction(pool, async (client) => {
    const campaignRes = await client.query<CampaignRow>(
      "select * from campaigns where id = $1 for update",
      [campaignId]
    );
    if (campaignRes.rowCount === 0) throw new CampaignNotFoundError(campaignId);
    const campaign = campaignRes.rows[0];
    const now = new Date();

    if (campaign.status === "closed") {
      throw new CampaignStateError("campaign is closed");
    }
    if (campaign.ends_at != null && campaign.ends_at <= now) {
      throw new CampaignStateError("campaign has ended");
    }

    const rewardsRes = await client.query(
      `select id, weight, quantity_total, quantity_remaining
         from campaign_rewards
        where campaign_id = $1
        order by position, id
          for update`,
      [campaignId]
    );
    const rewards = rewardsRes.rows as Array<{
      id: string;
      weight: number | null;
      quantity_total: number | null;
      quantity_remaining: number | null;
    }>;
    if (rewards.length === 0) {
      throw new InvalidRewardConfigError("campaign has no rewards");
    }

    // Draw outcomes (indices into rewards) with crypto.randomInt.
    const picks: number[] = new Array(count);
    if (campaign.mode === "weighted") {
      const weights = rewards.map((r) => r.weight);
      if (weights.some((w) => w == null || !Number.isInteger(w) || w <= 0)) {
        throw new InvalidRewardConfigError(
          "weighted mode requires a positive integer weight on every reward"
        );
      }
      const total = (weights as number[]).reduce((a, w) => a + w, 0);
      for (let i = 0; i < count; i++) {
        let r = randomInt(total);
        let idx = 0;
        while (r >= (weights[idx] as number)) {
          r -= weights[idx] as number;
          idx++;
        }
        picks[i] = idx;
      }
    } else {
      const remaining = rewards.map((r) => r.quantity_remaining);
      if (remaining.some((q) => q == null || !Number.isInteger(q) || q < 0)) {
        throw new InvalidRewardConfigError(
          "fixed_pool mode requires quantities on every reward"
        );
      }
      const local = remaining.map((q) => q as number);
      let totalRemaining = local.reduce((a, q) => a + q, 0);
      if (totalRemaining < count) {
        throw new PoolExhaustedError(totalRemaining, count);
      }
      for (let i = 0; i < count; i++) {
        let r = randomInt(totalRemaining);
        let idx = 0;
        while (r >= local[idx]) {
          r -= local[idx];
          idx++;
        }
        picks[i] = idx;
        local[idx] -= 1;
        totalRemaining -= 1;
      }
      for (let idx = 0; idx < rewards.length; idx++) {
        if (local[idx] !== remaining[idx]) {
          await client.query(
            "update campaign_rewards set quantity_remaining = $1 where id = $2",
            [local[idx], rewards[idx].id]
          );
        }
      }
    }

    const batchRes = await client.query(
      `insert into card_batches (campaign_id, label, created_by)
       values ($1, $2, $3) returning id`,
      [campaignId, input.batchLabel ?? null, input.createdBy ?? null]
    );
    const batchId: string = batchRes.rows[0].id;

    const expiresAt = cardExpiry(campaign, now);
    const label = input.cardLabel ?? null;
    const cards: GeneratedCard[] = [];
    const auditRows: Parameters<typeof insertAudit>[1] = [];

    for (let start = 0; start < count; start += INSERT_CHUNK) {
      const chunk = picks.slice(start, start + INSERT_CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((idx, j) => {
        const base = j * 6;
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        params.push(
          campaignId,
          generateToken(),
          rewards[idx].id,
          batchId,
          label,
          expiresAt
        );
      });
      const inserted = await client.query(
        `insert into cards (campaign_id, token, campaign_reward_id, batch_id, label, expires_at)
         values ${values.join(", ")}
         returning id, token, label, expires_at, created_at`,
        params
      );
      inserted.rows.forEach((row, j) => {
        cards.push({
          id: row.id,
          token: row.token,
          label: row.label,
          status: "created",
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        });
        auditRows.push({
          actor,
          action: "card.generated",
          entityType: "card",
          entityId: row.id,
          after: {
            campaign_id: campaignId,
            campaign_reward_id: rewards[chunk[j]].id,
            batch_id: batchId,
          },
        });
      });
    }

    if (campaign.rewards_locked_at == null) {
      await client.query(
        "update campaigns set rewards_locked_at = now() where id = $1",
        [campaignId]
      );
    }

    await insertAudit(client, auditRows);
    return { batchId, cards };
  });
}

/**
 * Reveals a card by token. Idempotent: the first call flips the card to
 * revealed and creates the customer_reward in the same transaction; later
 * calls (or concurrent ones, serialized by the row lock) return the same
 * reward. Expiry is applied lazily. Requires a linked customer.
 */
export async function revealCard(
  pool: Pool,
  token: string,
  opts: { actor?: string } = {}
): Promise<RevealResult> {
  const actor = opts.actor ?? "customer";
  return withTransaction(pool, async (client) => {
    const cardRes = await client.query(
      "select * from cards where token = $1 for update",
      [token]
    );
    if (cardRes.rowCount === 0) return { state: "not_found" };
    const card = cardRes.rows[0];
    const now = new Date();

    if (
      (card.status === "created" || card.status === "opened") &&
      card.expires_at != null &&
      card.expires_at <= now
    ) {
      await client.query(
        "update cards set status = 'expired', expired_at = $2 where id = $1",
        [card.id, now]
      );
      await insertAudit(client, [
        {
          actor: "system",
          action: "card.expired",
          entityType: "card",
          entityId: card.id,
          before: { status: card.status },
          after: { status: "expired" },
        },
      ]);
      return { state: "expired" };
    }

    if (card.status === "expired") return { state: "expired" };
    if (card.status === "void") return { state: "void" };

    if (card.status === "revealed") {
      const existing = await client.query(
        `select cr.redemption_code, cr.status, cr.expires_at,
                r.title, r.description, r.terms, r.retail_value_cents,
                cu.wallet_token, c.revealed_at
           from customer_rewards cr
           join campaign_rewards r on r.id = cr.campaign_reward_id
           join customers cu on cu.id = cr.customer_id
           join cards c on c.id = cr.card_id
          where cr.card_id = $1`,
        [card.id]
      );
      const row = existing.rows[0];
      return {
        state: "revealed",
        firstReveal: false,
        reward: {
          title: row.title,
          description: row.description,
          terms: row.terms,
          retailValueCents: row.retail_value_cents,
          redemptionCode: row.redemption_code,
          status: row.status,
          expiresAt: row.expires_at,
        },
        walletToken: row.wallet_token,
        revealedAt: row.revealed_at,
      };
    }

    if (card.customer_id == null) return { state: "unclaimed" };

    const campaignRes = await client.query<CampaignRow>(
      "select * from campaigns where id = $1",
      [card.campaign_id]
    );
    const campaign = campaignRes.rows[0];

    await client.query(
      `update cards
          set status = 'revealed', revealed_at = $2, opened_at = coalesce(opened_at, $2)
        where id = $1`,
      [card.id, now]
    );

    const rewardExpiresAt =
      campaign.reward_expiry_days != null
        ? new Date(now.getTime() + campaign.reward_expiry_days * DAY_MS)
        : null;

    // Insert the customer_reward; retry on the (unlikely) redemption-code
    // collision without aborting the transaction.
    let code = "";
    let insertedId = "";
    for (let attempt = 0; ; attempt++) {
      code = generateRedemptionCode();
      await client.query("savepoint reward_insert");
      try {
        const res = await client.query(
          `insert into customer_rewards
             (customer_id, card_id, campaign_reward_id, redemption_code, expires_at)
           values ($1, $2, $3, $4, $5)
           returning id`,
          [card.customer_id, card.id, card.campaign_reward_id, code, rewardExpiresAt]
        );
        insertedId = res.rows[0].id;
        await client.query("release savepoint reward_insert");
        break;
      } catch (err) {
        await client.query("rollback to savepoint reward_insert");
        const isCodeCollision =
          err instanceof Error &&
          "code" in err &&
          (err as { code?: string }).code === "23505" &&
          String((err as { constraint?: string }).constraint ?? "").includes(
            "redemption_code"
          );
        if (!isCodeCollision || attempt >= 4) throw err;
      }
    }

    await insertAudit(client, [
      {
        actor,
        action: "card.revealed",
        entityType: "card",
        entityId: card.id,
        before: { status: card.status },
        after: { status: "revealed", customer_reward_id: insertedId },
      },
    ]);

    const rewardRes = await client.query(
      `select r.title, r.description, r.terms, r.retail_value_cents, cu.wallet_token
         from campaign_rewards r, customers cu
        where r.id = $1 and cu.id = $2`,
      [card.campaign_reward_id, card.customer_id]
    );
    const reward = rewardRes.rows[0];
    return {
      state: "revealed",
      firstReveal: true,
      reward: {
        title: reward.title,
        description: reward.description,
        terms: reward.terms,
        retailValueCents: reward.retail_value_cents,
        redemptionCode: code,
        status: "available",
        expiresAt: rewardExpiresAt,
      },
      walletToken: reward.wallet_token,
      revealedAt: now,
    };
  });
}

/**
 * Redeems a customer reward by code: one-time, staff-attributed, audited.
 * Lazily expires an overdue reward instead of redeeming it.
 */
export async function redeemReward(
  pool: Pool,
  input: { code: string; staffUserId: string }
): Promise<RedeemResult> {
  // Failures that must still commit work (lazy expiry) are returned from the
  // transaction and thrown afterwards — throwing inside would roll them back.
  const outcome = await withTransaction<
    { ok: RedeemResult } | { failed: "not_found" } | { failed: "state"; status: string }
  >(pool, async (client) => {
    const res = await client.query(
      `select cr.*, r.title
         from customer_rewards cr
         join campaign_rewards r on r.id = cr.campaign_reward_id
        where cr.redemption_code = $1
          for update of cr`,
      [input.code]
    );
    if (res.rowCount === 0) return { failed: "not_found" };
    const reward = res.rows[0];
    const now = new Date();

    if (
      reward.status === "available" &&
      reward.expires_at != null &&
      reward.expires_at <= now
    ) {
      await client.query(
        "update customer_rewards set status = 'expired' where id = $1",
        [reward.id]
      );
      await insertAudit(client, [
        {
          actor: "system",
          action: "reward.expired",
          entityType: "customer_reward",
          entityId: reward.id,
          before: { status: "available" },
          after: { status: "expired" },
        },
      ]);
      return { failed: "state", status: "expired" };
    }
    if (reward.status !== "available") {
      return { failed: "state", status: reward.status };
    }

    await client.query(
      `update customer_rewards
          set status = 'redeemed', redeemed_at = $2, redeemed_by = $3
        where id = $1`,
      [reward.id, now, input.staffUserId]
    );
    await insertAudit(client, [
      {
        actor: `staff:${input.staffUserId}`,
        action: "reward.redeemed",
        entityType: "customer_reward",
        entityId: reward.id,
        before: { status: "available" },
        after: { status: "redeemed", redeemed_by: input.staffUserId },
      },
    ]);

    return {
      ok: {
        rewardId: reward.id,
        title: reward.title,
        redemptionCode: reward.redemption_code,
        redeemedAt: now,
        customerId: reward.customer_id,
      },
    };
  });

  if ("ok" in outcome) return outcome.ok;
  if (outcome.failed === "not_found") throw new RewardNotFoundError();
  throw new RewardStateError(outcome.status);
}
