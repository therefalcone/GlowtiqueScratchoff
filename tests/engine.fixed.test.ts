import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards } from "@/lib/server/engine";
import { PoolExhaustedError } from "@/lib/server/errors";
import { createCampaign, newPool, outcomeCounts, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

describe("fixed pool mode", () => {
  it("99 of A plus 1 of B yields exactly 99 A and 1 B across 100 cards", async () => {
    const { campaignId } = await createCampaign(pool, {
      mode: "fixed_pool",
      rewards: [
        { title: "A", quantity: 99 },
        { title: "B", quantity: 1 },
      ],
    });

    // Drawn across several batches to exercise repeated lock/decrement.
    await generateCards(pool, { campaignId, count: 40, actor: "staff:test" });
    await generateCards(pool, { campaignId, count: 40, actor: "staff:test" });
    await generateCards(pool, { campaignId, count: 20, actor: "staff:test" });

    const counts = await outcomeCounts(pool, campaignId);
    expect(counts).toEqual({ A: 99, B: 1 });

    const remaining = await pool.query(
      "select sum(quantity_remaining)::int as n from campaign_rewards where campaign_id = $1",
      [campaignId]
    );
    expect(remaining.rows[0].n).toBe(0);

    // The pool is empty: one more card fails cleanly.
    await expect(
      generateCards(pool, { campaignId, count: 1, actor: "staff:test" })
    ).rejects.toBeInstanceOf(PoolExhaustedError);
    const cards = await pool.query("select count(*)::int as n from cards");
    expect(cards.rows[0].n).toBe(100);
  });

  it("over-requesting fails the whole batch with nothing written", async () => {
    const { campaignId } = await createCampaign(pool, {
      mode: "fixed_pool",
      rewards: [
        { title: "A", quantity: 5 },
        { title: "B", quantity: 5 },
      ],
    });
    await expect(
      generateCards(pool, { campaignId, count: 11, actor: "staff:test" })
    ).rejects.toBeInstanceOf(PoolExhaustedError);

    const cards = await pool.query("select count(*)::int as n from cards");
    expect(cards.rows[0].n).toBe(0);
    const remaining = await pool.query(
      "select sum(quantity_remaining)::int as n from campaign_rewards where campaign_id = $1",
      [campaignId]
    );
    expect(remaining.rows[0].n).toBe(10);
    const audits = await pool.query("select count(*)::int as n from audit_log");
    expect(audits.rows[0].n).toBe(0);
  });
});
