import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards } from "@/lib/server/engine";
import { InvalidRewardConfigError } from "@/lib/server/errors";
import { createCampaign, newPool, outcomeCounts, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

describe("weighted mode", () => {
  it("draws within tolerance of the configured weights over a large sample", async () => {
    const N = 10_000;
    const weights = { A: 40, B: 30, C: 20, D: 8, E: 2 };
    const { campaignId } = await createCampaign(pool, {
      mode: "weighted",
      rewards: Object.entries(weights).map(([title, weight]) => ({ title, weight })),
    });

    const result = await generateCards(pool, {
      campaignId,
      count: N,
      actor: "staff:test",
    });
    expect(result.cards).toHaveLength(N);

    const counts = await outcomeCounts(pool, campaignId);
    const total = Object.values(weights).reduce((a, w) => a + w, 0);
    for (const [title, weight] of Object.entries(weights)) {
      const share = (counts[title] ?? 0) / N;
      const expected = weight / total;
      // ±2 percentage points absolute; >10 sigma for every weight at N=10k.
      expect(Math.abs(share - expected), `${title} share ${share}`).toBeLessThan(0.02);
    }

    // Every draw is audited.
    const audits = await pool.query(
      "select count(*)::int as n from audit_log where action = 'card.generated'"
    );
    expect(audits.rows[0].n).toBe(N);

    // The outcome is never in the generation result.
    const flat = JSON.stringify(result);
    expect(flat).not.toContain("campaign_reward_id");
    expect(flat).not.toContain("rewardId");
  });

  it("a single-reward campaign is a guaranteed gift", async () => {
    const { campaignId, rewardIds } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [{ title: "Free brow wax", weight: 1 }],
    });
    await generateCards(pool, { campaignId, count: 50, actor: "staff:test" });
    const rows = await pool.query(
      "select distinct campaign_reward_id from cards where campaign_id = $1",
      [campaignId]
    );
    expect(rows.rows).toEqual([{ campaign_reward_id: rewardIds["Free brow wax"] }]);
  });

  it("rejects weighted campaigns with missing or non-positive weights", async () => {
    const { campaignId } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [{ title: "A", weight: 10 }, { title: "B" }], // B has no weight
    });
    await expect(
      generateCards(pool, { campaignId, count: 1, actor: "staff:test" })
    ).rejects.toBeInstanceOf(InvalidRewardConfigError);
    const cards = await pool.query("select count(*)::int as n from cards");
    expect(cards.rows[0].n).toBe(0);
  });

  it("stamps card expiry from card_expiry_days capped by ends_at", async () => {
    const endsAt = new Date(Date.now() + 10 * 86_400_000);
    const { campaignId } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [{ title: "A", weight: 1 }],
      cardExpiryDays: 30,
      endsAt,
    });
    await generateCards(pool, { campaignId, count: 1, actor: "staff:test" });
    const card = await pool.query("select expires_at from cards limit 1");
    expect(card.rows[0].expires_at.getTime()).toBe(endsAt.getTime());
  });
});
