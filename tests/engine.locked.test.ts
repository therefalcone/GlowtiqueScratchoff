import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards } from "@/lib/server/engine";
import { createCampaign, newPool, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

const LOCKED = /locked once cards have been generated/;

describe("reward pool locking", () => {
  it("rewards are editable before any card exists", async () => {
    const { campaignId, rewardIds } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [{ title: "A", weight: 10 }],
    });
    await pool.query("update campaign_rewards set weight = 20 where id = $1", [
      rewardIds["A"],
    ]);
    await pool.query(
      `insert into campaign_rewards (campaign_id, title, weight) values ($1, 'B', 5)`,
      [campaignId]
    );
    const n = await pool.query(
      "select count(*)::int as n from campaign_rewards where campaign_id = $1",
      [campaignId]
    );
    expect(n.rows[0].n).toBe(2);
  });

  it("the first generation locks weights, quantities, and membership", async () => {
    const { campaignId, rewardIds } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [
        { title: "A", weight: 10 },
        { title: "B", weight: 5 },
      ],
    });
    await generateCards(pool, { campaignId, count: 1, actor: "staff:test" });

    const locked = await pool.query(
      "select rewards_locked_at from campaigns where id = $1",
      [campaignId]
    );
    expect(locked.rows[0].rewards_locked_at).not.toBeNull();

    await expect(
      pool.query("update campaign_rewards set weight = 99 where id = $1", [
        rewardIds["A"],
      ])
    ).rejects.toThrow(LOCKED);
    await expect(
      pool.query("update campaign_rewards set title = 'renamed' where id = $1", [
        rewardIds["A"],
      ])
    ).rejects.toThrow(LOCKED);
    await expect(
      pool.query(
        "insert into campaign_rewards (campaign_id, title, weight) values ($1, 'C', 1)",
        [campaignId]
      )
    ).rejects.toThrow(LOCKED);
    await expect(
      pool.query("delete from campaign_rewards where id = $1", [rewardIds["B"]])
    ).rejects.toThrow(LOCKED);
  });

  it("locked fixed-pool campaigns still allow the engine's quantity_remaining decrements", async () => {
    const { campaignId, rewardIds } = await createCampaign(pool, {
      mode: "fixed_pool",
      rewards: [{ title: "A", quantity: 10 }],
    });
    await generateCards(pool, { campaignId, count: 1, actor: "staff:test" });

    // quantity_remaining-only updates pass the lock trigger (engine draws)...
    await pool.query(
      "update campaign_rewards set quantity_remaining = quantity_remaining - 1 where id = $1",
      [rewardIds["A"]]
    );
    // ...but quantity_total stays locked.
    await expect(
      pool.query("update campaign_rewards set quantity_total = 99 where id = $1", [
        rewardIds["A"],
      ])
    ).rejects.toThrow(LOCKED);

    // Further generation keeps working after lock.
    const more = await generateCards(pool, {
      campaignId,
      count: 2,
      actor: "staff:test",
    });
    expect(more.cards).toHaveLength(2);
  });
});
