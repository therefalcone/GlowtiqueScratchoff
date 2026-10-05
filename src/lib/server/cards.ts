import type { Pool } from "pg";
import { cardDisplayNumber, TOKEN_RE } from "../card-display";
import { toCsv } from "../csv";
import { withTransaction } from "./db";
import { CardNotFoundError, CardStateError } from "./errors";

export type CardStatus = "created" | "opened" | "revealed" | "expired" | "void";

interface CardBase {
  displayNumber: string;
  campaignName: string;
  rulesUrl: string | null;
}

/** What the public card page may know. Never includes the outcome before reveal. */
export type PublicCard =
  | { state: "invalid" }
  | ({ state: "expired"; expiredAt: Date | null } & CardBase)
  | ({ state: "void" } & CardBase)
  | ({ state: "ready" | "unclaimed"; validThrough: Date | null } & CardBase)
  | ({
      state: "revealed";
      revealedAt: Date | null;
      rewardTitle: string;
      rewardDescription: string | null;
      rewardExpiresAt: Date | null;
      walletToken: string;
    } & CardBase);

/**
 * Loads a card for the public page, applying lazy expiry and flipping
 * created → opened on first view.
 */
export async function loadPublicCard(pool: Pool, token: string): Promise<PublicCard> {
  if (!TOKEN_RE.test(token)) return { state: "invalid" };
  const res = await pool.query(
    `select c.id, c.status, c.customer_id, c.expires_at, c.expired_at, c.revealed_at,
            cp.name as campaign_name, cp.official_rules_url
       from cards c join campaigns cp on cp.id = c.campaign_id
      where c.token = $1`,
    [token]
  );
  if (res.rowCount === 0) return { state: "invalid" };
  const card = res.rows[0];
  const base: CardBase = {
    displayNumber: cardDisplayNumber(token),
    campaignName: card.campaign_name,
    rulesUrl: card.official_rules_url,
  };
  const now = new Date();

  if (
    (card.status === "created" || card.status === "opened") &&
    card.expires_at != null &&
    card.expires_at <= now
  ) {
    await pool.query(
      "update cards set status = 'expired', expired_at = $2 where id = $1 and status in ('created','opened')",
      [card.id, now]
    );
    return { state: "expired", expiredAt: card.expires_at, ...base };
  }

  switch (card.status as CardStatus) {
    case "expired":
      // Show the date the card stopped being valid, not when we noticed.
      return { state: "expired", expiredAt: card.expires_at ?? card.expired_at, ...base };
    case "void":
      return { state: "void", ...base };
    case "revealed": {
      const r = await pool.query(
        `select cr.expires_at, r.title, r.description, cu.wallet_token
           from customer_rewards cr
           join campaign_rewards r on r.id = cr.campaign_reward_id
           join customers cu on cu.id = cr.customer_id
          where cr.card_id = $1`,
        [card.id]
      );
      const row = r.rows[0];
      return {
        state: "revealed",
        revealedAt: card.revealed_at,
        rewardTitle: row.title,
        rewardDescription: row.description,
        rewardExpiresAt: row.expires_at,
        walletToken: row.wallet_token,
        ...base,
      };
    }
    case "created":
      await pool.query(
        "update cards set status = 'opened', opened_at = $2 where id = $1 and status = 'created'",
        [card.id, now]
      );
    // fall through
    case "opened":
      return {
        state: card.customer_id ? "ready" : "unclaimed",
        validThrough: card.expires_at,
        ...base,
      };
  }
}

/** Staff voids an unrevealed card. Audited. The drawn outcome is not returned to a fixed pool. */
export async function voidCard(pool: Pool, cardId: string, actor: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const res = await client.query("select status from cards where id = $1 for update", [cardId]);
    if (res.rowCount === 0) throw new CardNotFoundError();
    const status: CardStatus = res.rows[0].status;
    if (status !== "created" && status !== "opened") {
      throw new CardStateError(status, `Only unscratched cards can be voided (this one is ${status}).`);
    }
    await client.query("update cards set status = 'void', voided_at = now() where id = $1", [cardId]);
    await client.query(
      `insert into audit_log (actor, action, entity_type, entity_id, before, after)
       values ($1, 'card.voided', 'card', $2, $3, $4)`,
      [actor, cardId, JSON.stringify({ status }), JSON.stringify({ status: "void" })]
    );
  });
}

export interface LinkCampaign {
  id: string;
  name: string;
  mode: "weighted" | "fixed_pool";
  generated: number;
  poolRemaining: number | null;
  poolTotal: number | null;
  /** expiry a card generated right now would get */
  expiryPreview: Date | null;
}

export async function listCampaignsForLinks(pool: Pool): Promise<LinkCampaign[]> {
  const res = await pool.query(`
    select c.id, c.name, c.mode, c.ends_at, c.card_expiry_days,
           (select count(*)::int from cards where campaign_id = c.id) as generated,
           (select sum(quantity_remaining)::int from campaign_rewards where campaign_id = c.id) as pool_remaining,
           (select sum(quantity_total)::int from campaign_rewards where campaign_id = c.id) as pool_total
      from campaigns c
     where c.status = 'active' and (c.ends_at is null or c.ends_at > now())
     order by c.created_at desc
  `);
  const now = Date.now();
  return res.rows.map((r) => {
    let expiry: Date | null = null;
    if (r.card_expiry_days != null) expiry = new Date(now + r.card_expiry_days * 86_400_000);
    if (r.ends_at != null && (expiry == null || r.ends_at < expiry)) expiry = r.ends_at;
    return {
      id: r.id,
      name: r.name,
      mode: r.mode,
      generated: r.generated,
      poolRemaining: r.mode === "fixed_pool" ? r.pool_remaining : null,
      poolTotal: r.mode === "fixed_pool" ? r.pool_total : null,
      expiryPreview: expiry,
    };
  });
}

export interface BatchCard {
  id: string;
  token: string;
  label: string | null;
  status: CardStatus;
  createdAt: Date;
}

export interface Batch {
  id: string;
  campaignId: string;
  campaignName: string;
  label: string | null;
  createdAt: Date;
  cards: BatchCard[];
}

export async function getBatch(pool: Pool, batchId: string): Promise<Batch | null> {
  const b = await pool.query(
    `select b.id, b.campaign_id, b.label, b.created_at, c.name as campaign_name
       from card_batches b join campaigns c on c.id = b.campaign_id
      where b.id = $1`,
    [batchId]
  );
  if (b.rowCount === 0) return null;
  const cards = await pool.query(
    `select id, token, label, status, created_at from cards where batch_id = $1 order by created_at, id`,
    [batchId]
  );
  return {
    id: b.rows[0].id,
    campaignId: b.rows[0].campaign_id,
    campaignName: b.rows[0].campaign_name,
    label: b.rows[0].label,
    createdAt: b.rows[0].created_at,
    cards: cards.rows.map((c) => ({
      id: c.id,
      token: c.token,
      label: c.label,
      status: c.status,
      createdAt: c.created_at,
    })),
  };
}

export async function latestBatchId(pool: Pool, campaignId: string): Promise<string | null> {
  const res = await pool.query(
    "select id from card_batches where campaign_id = $1 order by created_at desc limit 1",
    [campaignId]
  );
  return res.rows[0]?.id ?? null;
}

export function cardUrl(appUrl: string, token: string): string {
  return `${appUrl}/c/${token}`;
}

/** Batch export: link, label, created_at — never the outcome. */
export function batchCsv(batch: Batch, appUrl: string): string {
  return toCsv([
    ["link", "label", "created_at"],
    ...batch.cards.map((c) => [cardUrl(appUrl, c.token), c.label ?? "", c.createdAt.toISOString()]),
  ]);
}
