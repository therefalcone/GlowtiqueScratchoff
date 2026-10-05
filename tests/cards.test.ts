import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cardDisplayNumber, TOKEN_RE } from "@/lib/card-display";
import {
  batchCsv,
  getBatch,
  latestBatchId,
  listCampaignsForLinks,
  loadPublicCard,
  voidCard,
} from "@/lib/server/cards";
import { generateCards, revealCard } from "@/lib/server/engine";
import { CardNotFoundError, CardStateError } from "@/lib/server/errors";
import { generateToken } from "@/lib/server/tokens";
import { claimCard, createCampaign, createCustomer, newPool, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

async function oneCard(opts: { cardExpiryDays?: number; name?: string } = {}) {
  const { campaignId } = await createCampaign(pool, {
    mode: "weighted",
    name: opts.name ?? "Autumn Glow",
    rewards: [{ title: "$25 off any facial", weight: 1 }],
    cardExpiryDays: opts.cardExpiryDays,
  });
  const gen = await generateCards(pool, { campaignId, count: 1, actor: "staff:test", batchLabel: "Front desk" });
  return { campaignId, card: gen.cards[0], batchId: gen.batchId };
}

describe("tokens and display numbers", () => {
  it("tokens are 22 url-safe chars and display numbers are 4 uppercase hex chars", () => {
    const t = generateToken();
    expect(TOKEN_RE.test(t)).toBe(true);
    expect(cardDisplayNumber(t)).toMatch(/^[0-9A-F]{4}$/);
    expect(cardDisplayNumber(t)).toBe(cardDisplayNumber(t));
  });
});

describe("loadPublicCard", () => {
  it("rejects malformed and unknown tokens without touching the database state", async () => {
    expect(await loadPublicCard(pool, "../etc/passwd")).toEqual({ state: "invalid" });
    expect(await loadPublicCard(pool, generateToken())).toEqual({ state: "invalid" });
  });

  it("flips created → opened on first view and reports unclaimed vs ready", async () => {
    const { card } = await oneCard({ cardExpiryDays: 30 });
    const first = await loadPublicCard(pool, card.token);
    expect(first).toMatchObject({ state: "unclaimed", campaignName: "Autumn Glow", displayNumber: cardDisplayNumber(card.token) });
    const row = await pool.query("select status, opened_at from cards where id = $1", [card.id]);
    expect(row.rows[0].status).toBe("opened");
    expect(row.rows[0].opened_at).not.toBeNull();

    await claimCard(pool, card.id, await createCustomer(pool));
    const second = await loadPublicCard(pool, card.token);
    expect(second.state).toBe("ready");
    if (second.state === "ready") expect(second.validThrough).toBeInstanceOf(Date);

    // No reward data before reveal.
    expect(JSON.stringify(second)).not.toMatch(/facial/);
  });

  it("lazily expires an overdue card and reports void cards", async () => {
    const { card } = await oneCard();
    await pool.query("update cards set expires_at = now() - interval '1 hour' where id = $1", [card.id]);
    const res = await loadPublicCard(pool, card.token);
    expect(res.state).toBe("expired");
    expect((await pool.query("select status from cards where id = $1", [card.id])).rows[0].status).toBe("expired");

    const other = await oneCard();
    await voidCard(pool, other.card.id, "staff:test");
    expect((await loadPublicCard(pool, other.card.token)).state).toBe("void");
  });

  it("returns the revealed reward and wallet token for a revealed card", async () => {
    const { card } = await oneCard();
    await claimCard(pool, card.id, await createCustomer(pool));
    const reveal = await revealCard(pool, card.token);
    if (reveal.state !== "revealed") throw new Error("expected reveal");
    const res = await loadPublicCard(pool, card.token);
    expect(res).toMatchObject({ state: "revealed", rewardTitle: "$25 off any facial", walletToken: reveal.walletToken });
  });
});

describe("voidCard", () => {
  it("voids unscratched cards only, and audits", async () => {
    const { card } = await oneCard();
    await voidCard(pool, card.id, "staff:test");
    expect((await pool.query("select status, voided_at from cards where id = $1", [card.id])).rows[0]).toMatchObject({ status: "void" });
    await expect(voidCard(pool, card.id, "staff:test")).rejects.toBeInstanceOf(CardStateError);

    const revealed = await oneCard();
    await claimCard(pool, revealed.card.id, await createCustomer(pool));
    await revealCard(pool, revealed.card.token);
    await expect(voidCard(pool, revealed.card.id, "staff:test")).rejects.toBeInstanceOf(CardStateError);

    await expect(voidCard(pool, "00000000-0000-0000-0000-000000000000", "staff:test")).rejects.toBeInstanceOf(CardNotFoundError);
    const audits = await pool.query("select count(*)::int as n from audit_log where action = 'card.voided'");
    expect(audits.rows[0].n).toBe(1);
  });
});

describe("batches", () => {
  it("lists a batch, finds the latest, and exports CSV without the outcome", async () => {
    const { campaignId, batchId } = await oneCard();
    const second = await generateCards(pool, { campaignId, count: 2, actor: "staff:test", cardLabel: "VIP, table 4", batchLabel: "VIP" });
    expect(await latestBatchId(pool, campaignId)).toBe(second.batchId);

    const batch = await getBatch(pool, second.batchId);
    expect(batch).toMatchObject({ label: "VIP", campaignName: "Autumn Glow" });
    expect(batch!.cards).toHaveLength(2);
    expect(batch!.cards[0].label).toBe("VIP, table 4");

    const csv = batchCsv(batch!, "https://glow.example");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("link,label,created_at");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^https:\/\/glow\.example\/c\/[A-Za-z0-9_-]{22},"VIP, table 4",\d{4}-/);
    expect(csv).not.toMatch(/facial|reward/i);

    expect(await getBatch(pool, batchId)).not.toBeNull();
    expect(await getBatch(pool, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("lists only live campaigns with pool counts and an expiry preview", async () => {
    const fixed = await createCampaign(pool, {
      mode: "fixed_pool",
      name: "Fixed",
      rewards: [{ title: "A", quantity: 10 }],
      cardExpiryDays: 7,
    });
    await generateCards(pool, { campaignId: fixed.campaignId, count: 3, actor: "staff:test" });
    await createCampaign(pool, { mode: "weighted", name: "Draft", status: "draft", rewards: [{ title: "A", weight: 1 }] });
    await createCampaign(pool, { mode: "weighted", name: "Over", rewards: [{ title: "A", weight: 1 }], endsAt: new Date(Date.now() - 1000) });

    const list = await listCampaignsForLinks(pool);
    expect(list.map((c) => c.name)).toEqual(["Fixed"]);
    expect(list[0]).toMatchObject({ generated: 3, poolRemaining: 7, poolTotal: 10 });
    const days = (list[0].expiryPreview!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});
