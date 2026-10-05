import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activateCampaign,
  campaignStats,
  cloneCampaign,
  closeCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  type CampaignInput,
} from "@/lib/server/campaigns";
import { generateCards } from "@/lib/server/engine";
import { CampaignStateError, InvalidRewardConfigError } from "@/lib/server/errors";
import { newPool, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

const ACTOR = "staff:11111111-1111-1111-1111-111111111111";

function input(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return {
    name: "Autumn Glow",
    mode: "weighted",
    startsAt: new Date("2026-09-15T00:00:00Z"),
    endsAt: new Date("2026-12-31T23:59:59.999Z"),
    cardExpiryDays: 30,
    rewardExpiryDays: 60,
    officialRulesUrl: "https://glowtique.example/rules",
    rewards: [
      { title: "$25 off any facial", description: null, terms: null, retailValueCents: 2500, weight: 40, quantityTotal: null },
      { title: "Free brow wax", description: "Brows only.", terms: "One per visit.", retailValueCents: 2800, weight: 30, quantityTotal: null },
    ],
    ...overrides,
  };
}

async function actions(): Promise<string[]> {
  const res = await pool.query("select action from audit_log order by id");
  return res.rows.map((r) => r.action);
}

describe("campaign lifecycle", () => {
  it("creates a draft with its reward pool and audits it", async () => {
    const id = await createCampaign(pool, input(), ACTOR);
    const c = await getCampaign(pool, id);
    expect(c).toMatchObject({ name: "Autumn Glow", status: "draft", mode: "weighted", generatedCount: 0 });
    expect(c!.rewards.map((r) => r.title)).toEqual(["$25 off any facial", "Free brow wax"]);
    expect(c!.rewards[1]).toMatchObject({ description: "Brows only.", terms: "One per visit.", weight: 30 });
    expect(await actions()).toEqual(["campaign.created"]);
  });

  it("edits a draft (full replace of fields and rewards)", async () => {
    const id = await createCampaign(pool, input(), ACTOR);
    await updateCampaign(
      pool,
      id,
      input({
        name: "Autumn Glow II",
        mode: "fixed_pool",
        rewards: [
          { title: "A", description: null, terms: null, retailValueCents: 100, weight: null, quantityTotal: 99 },
          { title: "B", description: null, terms: null, retailValueCents: 100, weight: null, quantityTotal: 1 },
        ],
      }),
      ACTOR
    );
    const c = await getCampaign(pool, id);
    expect(c!.name).toBe("Autumn Glow II");
    expect(c!.mode).toBe("fixed_pool");
    expect(c!.rewards.map((r) => [r.title, r.quantityTotal, r.quantityRemaining])).toEqual([
      ["A", 99, 99],
      ["B", 1, 1],
    ]);
    expect(await actions()).toEqual(["campaign.created", "campaign.updated"]);
  });

  it("rejects activation of an invalid pool, then activates once fixed", async () => {
    const id = await createCampaign(
      pool,
      input({
        rewards: [
          { title: "A", description: null, terms: null, retailValueCents: 0, weight: 10, quantityTotal: null },
          { title: "B", description: null, terms: null, retailValueCents: 0, weight: null, quantityTotal: null },
        ],
      }),
      ACTOR
    );
    await expect(activateCampaign(pool, id, ACTOR)).rejects.toBeInstanceOf(InvalidRewardConfigError);
    expect((await getCampaign(pool, id))!.status).toBe("draft");

    await updateCampaign(pool, id, input(), ACTOR);
    await activateCampaign(pool, id, ACTOR);
    expect((await getCampaign(pool, id))!.status).toBe("active");
    expect(await actions()).toContain("campaign.activated");
  });

  it("rejects activating an empty campaign", async () => {
    const id = await createCampaign(pool, input({ rewards: [] }), ACTOR);
    await expect(activateCampaign(pool, id, ACTOR)).rejects.toThrow(/at least one reward/);
  });

  it("only drafts can be edited; only active campaigns can be closed", async () => {
    const id = await createCampaign(pool, input(), ACTOR);
    await expect(closeCampaign(pool, id, ACTOR)).rejects.toBeInstanceOf(CampaignStateError);

    await activateCampaign(pool, id, ACTOR);
    await expect(updateCampaign(pool, id, input({ name: "x" }), ACTOR)).rejects.toBeInstanceOf(
      CampaignStateError
    );
    await expect(activateCampaign(pool, id, ACTOR)).rejects.toBeInstanceOf(CampaignStateError);

    await closeCampaign(pool, id, ACTOR);
    expect((await getCampaign(pool, id))!.status).toBe("closed");
    await expect(closeCampaign(pool, id, ACTOR)).rejects.toBeInstanceOf(CampaignStateError);
  });

  it("only active campaigns generate cards", async () => {
    const id = await createCampaign(pool, input(), ACTOR);
    await expect(generateCards(pool, { campaignId: id, count: 1, actor: ACTOR })).rejects.toThrow(
      /only active campaigns/
    );
    await activateCampaign(pool, id, ACTOR);
    const gen = await generateCards(pool, { campaignId: id, count: 3, actor: ACTOR });
    expect(gen.cards).toHaveLength(3);
    await closeCampaign(pool, id, ACTOR);
    await expect(generateCards(pool, { campaignId: id, count: 1, actor: ACTOR })).rejects.toThrow(
      /only active campaigns/
    );
  });

  it("clones a locked campaign into a fresh, unlocked draft with a reset pool", async () => {
    const id = await createCampaign(
      pool,
      input({
        mode: "fixed_pool",
        rewards: [
          { title: "A", description: "desc", terms: "terms", retailValueCents: 500, weight: null, quantityTotal: 10 },
          { title: "B", description: null, terms: null, retailValueCents: 900, weight: null, quantityTotal: 5 },
        ],
      }),
      ACTOR
    );
    await activateCampaign(pool, id, ACTOR);
    await generateCards(pool, { campaignId: id, count: 7, actor: ACTOR });

    const src = await getCampaign(pool, id);
    expect(src!.rewardsLockedAt).not.toBeNull();
    expect(src!.rewards.reduce((a, r) => a + (r.quantityRemaining ?? 0), 0)).toBe(8);

    const cloneId = await cloneCampaign(pool, id, ACTOR);
    const clone = await getCampaign(pool, cloneId);
    expect(clone).toMatchObject({
      name: "Autumn Glow (copy)",
      status: "draft",
      mode: "fixed_pool",
      clonedFromId: id,
      rewardsLockedAt: null,
      generatedCount: 0,
      cardExpiryDays: 30,
      rewardExpiryDays: 60,
    });
    expect(clone!.rewards.map((r) => [r.title, r.quantityTotal, r.quantityRemaining, r.description])).toEqual([
      ["A", 10, 10, "desc"],
      ["B", 5, 5, null],
    ]);

    // The clone is editable even though the source is locked.
    await updateCampaign(
      pool,
      cloneId,
      input({
        mode: "fixed_pool",
        rewards: [{ title: "C", description: null, terms: null, retailValueCents: 1, weight: null, quantityTotal: 1 }],
      }),
      ACTOR
    );
    expect((await getCampaign(pool, cloneId))!.rewards.map((r) => r.title)).toEqual(["C"]);
    expect(await actions()).toContain("campaign.cloned");
  });

  it("validates fields", async () => {
    await expect(createCampaign(pool, input({ name: "  " }), ACTOR)).rejects.toThrow(/name is required/);
    await expect(createCampaign(pool, input({ cardExpiryDays: 0 }), ACTOR)).rejects.toThrow(/positive number of days/);
    await expect(
      createCampaign(pool, input({ startsAt: new Date("2026-12-31"), endsAt: new Date("2026-01-01") }), ACTOR)
    ).rejects.toThrow(/after the start/);
    await expect(
      createCampaign(
        pool,
        input({ rewards: [{ title: "A", description: null, terms: null, retailValueCents: -1, weight: 1, quantityTotal: null }] }),
        ACTOR
      )
    ).rejects.toThrow(/retail value/);
  });
});

describe("campaign list and stats", () => {
  it("reports generated / revealed / redeemed per campaign and headline stats", async () => {
    const id = await createCampaign(pool, input(), ACTOR);
    await activateCampaign(pool, id, ACTOR);
    await generateCards(pool, { campaignId: id, count: 4, actor: ACTOR });
    await createCampaign(pool, input({ name: "Draft one" }), ACTOR);

    const list = await listCampaigns(pool);
    expect(list.map((c) => [c.name, c.status, c.generated, c.revealed, c.redeemed])).toEqual([
      ["Autumn Glow", "active", 4, 0, 0],
      ["Draft one", "draft", 0, 0, 0],
    ]);

    const stats = await campaignStats(pool);
    expect(stats).toMatchObject({
      campaignCount: 2,
      liveCampaigns: 1,
      revealedLast30Days: 0,
      redeemedLast30Days: 0,
      redemptionRate: null,
      cardsIssuedThisYear: 4,
    });
  });
});
