import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards, redeemReward, revealCard } from "@/lib/server/engine";
import { RewardNotFoundError, RewardStateError } from "@/lib/server/errors";
import {
  claimCard,
  createCampaign,
  createCustomer,
  newPool,
  truncateAll,
} from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

async function revealedCard(opts: { rewardExpiryDays?: number } = {}) {
  const { campaignId } = await createCampaign(pool, {
    mode: "weighted",
    rewards: [{ title: "$25 off any facial", weight: 1, valueCents: 2500 }],
    rewardExpiryDays: opts.rewardExpiryDays,
  });
  const gen = await generateCards(pool, { campaignId, count: 1, actor: "staff:test" });
  const customerId = await createCustomer(pool);
  await claimCard(pool, gen.cards[0].id, customerId);
  return { token: gen.cards[0].token, cardId: gen.cards[0].id, customerId };
}

describe("reveal", () => {
  it("is atomic and idempotent under concurrency: one customer_reward, same code", async () => {
    const { token, cardId } = await revealedCard();

    const [a, b] = await Promise.all([
      revealCard(pool, token),
      revealCard(pool, token),
    ]);
    expect(a.state).toBe("revealed");
    expect(b.state).toBe("revealed");
    if (a.state !== "revealed" || b.state !== "revealed") return;
    expect([a.firstReveal, b.firstReveal].sort()).toEqual([false, true]);
    expect(a.reward.redemptionCode).toBe(b.reward.redemptionCode);
    expect(a.reward.title).toBe("$25 off any facial");
    expect(a.walletToken).toBeTruthy();

    const rewards = await pool.query(
      "select count(*)::int as n from customer_rewards where card_id = $1",
      [cardId]
    );
    expect(rewards.rows[0].n).toBe(1);

    // A later reload returns the same revealed reward.
    const again = await revealCard(pool, token);
    expect(again.state).toBe("revealed");
    if (again.state === "revealed") {
      expect(again.firstReveal).toBe(false);
      expect(again.reward.redemptionCode).toBe(a.reward.redemptionCode);
    }

    const audit = await pool.query(
      "select count(*)::int as n from audit_log where action = 'card.revealed'"
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("stamps reward expiry from reward_expiry_days", async () => {
    const { token } = await revealedCard({ rewardExpiryDays: 30 });
    const res = await revealCard(pool, token);
    expect(res.state).toBe("revealed");
    if (res.state !== "revealed") return;
    const days =
      (res.reward.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("refuses to reveal a card with no linked customer", async () => {
    const { campaignId } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [{ title: "A", weight: 1 }],
    });
    const gen = await generateCards(pool, { campaignId, count: 1, actor: "staff:test" });
    const res = await revealCard(pool, gen.cards[0].token);
    expect(res.state).toBe("unclaimed");
    const rewards = await pool.query("select count(*)::int as n from customer_rewards");
    expect(rewards.rows[0].n).toBe(0);
  });

  it("returns not_found for unknown tokens", async () => {
    expect((await revealCard(pool, "nope")).state).toBe("not_found");
  });

  it("lazily expires overdue cards and dead-ends void cards", async () => {
    const { token, cardId } = await revealedCard();
    await pool.query("update cards set expires_at = now() - interval '1 day' where id = $1", [cardId]);
    expect((await revealCard(pool, token)).state).toBe("expired");
    const status = await pool.query("select status from cards where id = $1", [cardId]);
    expect(status.rows[0].status).toBe("expired");

    const second = await revealedCard();
    await pool.query(
      "update cards set status = 'void', voided_at = now() where id = $1",
      [second.cardId]
    );
    expect((await revealCard(pool, second.token)).state).toBe("void");
  });
});

describe("redeem", () => {
  it("redeems once, attributes the staff user, and audits", async () => {
    const { token } = await revealedCard();
    const reveal = await revealCard(pool, token);
    if (reveal.state !== "revealed") throw new Error("expected reveal");
    const code = reveal.reward.redemptionCode;
    const staffId = "11111111-1111-1111-1111-111111111111";

    const redeemed = await redeemReward(pool, { code, staffUserId: staffId });
    expect(redeemed.title).toBe("$25 off any facial");

    const row = await pool.query(
      "select status, redeemed_by from customer_rewards where redemption_code = $1",
      [code]
    );
    expect(row.rows[0]).toMatchObject({ status: "redeemed", redeemed_by: staffId });

    // One-time: a second redeem fails.
    await expect(
      redeemReward(pool, { code, staffUserId: staffId })
    ).rejects.toBeInstanceOf(RewardStateError);

    const audit = await pool.query(
      "select count(*)::int as n from audit_log where action = 'reward.redeemed'"
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("rejects unknown codes and lazily expires overdue rewards", async () => {
    await expect(
      redeemReward(pool, { code: "GLW-XXXX-XX", staffUserId: "11111111-1111-1111-1111-111111111111" })
    ).rejects.toBeInstanceOf(RewardNotFoundError);

    const { token } = await revealedCard({ rewardExpiryDays: 30 });
    const reveal = await revealCard(pool, token);
    if (reveal.state !== "revealed") throw new Error("expected reveal");
    await pool.query(
      "update customer_rewards set expires_at = now() - interval '1 day' where redemption_code = $1",
      [reveal.reward.redemptionCode]
    );
    await expect(
      redeemReward(pool, {
        code: reveal.reward.redemptionCode,
        staffUserId: "11111111-1111-1111-1111-111111111111",
      })
    ).rejects.toThrow(/expired/);
    const row = await pool.query(
      "select status from customer_rewards where redemption_code = $1",
      [reveal.reward.redemptionCode]
    );
    expect(row.rows[0].status).toBe("expired");
  });
});

describe("audit log immutability", () => {
  it("rejects updates and deletes", async () => {
    await pool.query(
      `insert into audit_log (actor, action, entity_type) values ('system', 'test', 'test')`
    );
    await expect(
      pool.query("update audit_log set action = 'tampered'")
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from audit_log")).rejects.toThrow(/append-only/);
  });
});
