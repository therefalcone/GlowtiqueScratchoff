import { Pool } from "pg";
import { generateToken } from "@/lib/server/tokens";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/glowtique_test";

export function newPool(max = 12): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL, max });
}

export async function truncateAll(pool: Pool): Promise<void> {
  // TRUNCATE fires no row-level triggers, so the append-only audit guard
  // (an UPDATE/DELETE trigger) doesn't block test cleanup.
  await pool.query(`
    truncate customer_rewards, cards, card_batches, campaign_rewards,
             campaigns, customers, audit_log, rate_limits
      restart identity cascade
  `);
}

export interface RewardSpec {
  title: string;
  weight?: number;
  quantity?: number;
  valueCents?: number;
}

export interface TestCampaign {
  campaignId: string;
  /** reward id by title */
  rewardIds: Record<string, string>;
}

export async function createCampaign(
  pool: Pool,
  opts: {
    mode: "weighted" | "fixed_pool";
    rewards: RewardSpec[];
    status?: "draft" | "active" | "closed";
    cardExpiryDays?: number;
    rewardExpiryDays?: number;
    endsAt?: Date;
    name?: string;
  }
): Promise<TestCampaign> {
  const campaign = await pool.query(
    `insert into campaigns (name, mode, status, card_expiry_days, reward_expiry_days, ends_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      opts.name ?? "Test Campaign",
      opts.mode,
      opts.status ?? "active",
      opts.cardExpiryDays ?? null,
      opts.rewardExpiryDays ?? null,
      opts.endsAt ?? null,
    ]
  );
  const campaignId: string = campaign.rows[0].id;
  const rewardIds: Record<string, string> = {};
  for (const [i, r] of opts.rewards.entries()) {
    const res = await pool.query(
      `insert into campaign_rewards
         (campaign_id, title, retail_value_cents, weight, quantity_total, quantity_remaining, position)
       values ($1, $2, $3, $4, $5, $5, $6) returning id`,
      [campaignId, r.title, r.valueCents ?? 0, r.weight ?? null, r.quantity ?? null, i]
    );
    rewardIds[r.title] = res.rows[0].id;
  }
  return { campaignId, rewardIds };
}

export async function createCustomer(pool: Pool): Promise<string> {
  const res = await pool.query(
    `insert into customers (first_name, phone, wallet_token)
     values ('Lena', $1, $2) returning id`,
    [
      "+1239555" + String(Math.floor(Math.random() * 10000)).padStart(4, "0"),
      generateToken(),
    ]
  );
  return res.rows[0].id;
}

export async function claimCard(
  pool: Pool,
  cardId: string,
  customerId: string
): Promise<void> {
  await pool.query("update cards set customer_id = $2 where id = $1", [
    cardId,
    customerId,
  ]);
}

export async function outcomeCounts(
  pool: Pool,
  campaignId: string
): Promise<Record<string, number>> {
  const res = await pool.query(
    `select r.title, count(*)::int as n
       from cards c join campaign_rewards r on r.id = c.campaign_reward_id
      where c.campaign_id = $1
      group by r.title`,
    [campaignId]
  );
  return Object.fromEntries(res.rows.map((r) => [r.title, r.n]));
}
