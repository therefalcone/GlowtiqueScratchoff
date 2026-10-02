import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards } from "@/lib/server/engine";
import { PoolExhaustedError } from "@/lib/server/errors";
import { createCampaign, newPool, outcomeCounts, truncateAll } from "./helpers";

const pool = newPool(12);
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

describe("concurrent generation", () => {
  it("10 parallel batches drain a 50-card pool with no over-draw", async () => {
    const { campaignId } = await createCampaign(pool, {
      mode: "fixed_pool",
      rewards: [
        { title: "A", quantity: 30 },
        { title: "B", quantity: 20 },
      ],
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        generateCards(pool, { campaignId, count: 5, actor: "staff:test" })
      )
    );
    expect(results.every((r) => r.cards.length === 5)).toBe(true);

    const counts = await outcomeCounts(pool, campaignId);
    expect(counts).toEqual({ A: 30, B: 20 });
    const remaining = await pool.query(
      "select quantity_remaining from campaign_rewards where campaign_id = $1",
      [campaignId]
    );
    expect(remaining.rows.map((r) => r.quantity_remaining)).toEqual([0, 0]);
  });

  it("parallel batches racing for the last cards never overdraw", async () => {
    const { campaignId } = await createCampaign(pool, {
      mode: "fixed_pool",
      rewards: [{ title: "A", quantity: 5 }],
    });

    const settled = await Promise.allSettled([
      generateCards(pool, { campaignId, count: 5, actor: "staff:test" }),
      generateCards(pool, { campaignId, count: 5, actor: "staff:test" }),
      generateCards(pool, { campaignId, count: 5, actor: "staff:test" }),
    ]);
    const ok = settled.filter((s) => s.status === "fulfilled");
    const failed = settled.filter((s) => s.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason).toBeInstanceOf(PoolExhaustedError);
    }

    const cards = await pool.query("select count(*)::int as n from cards");
    expect(cards.rows[0].n).toBe(5);
    const remaining = await pool.query(
      "select quantity_remaining from campaign_rewards where campaign_id = $1",
      [campaignId]
    );
    expect(remaining.rows[0].quantity_remaining).toBe(0);
  });
});
