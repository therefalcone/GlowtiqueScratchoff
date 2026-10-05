import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimCard,
  getCustomerProfile,
  getWallet,
  getWalletReward,
  lookupReward,
  recentRedemptions,
  regenerateWalletToken,
  searchCustomers,
} from "@/lib/server/customers";
import { generateCards, redeemReward, revealCard } from "@/lib/server/engine";
import { ValidationError } from "@/lib/server/errors";
import { createCampaign, newPool, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

const STAFF = "11111111-1111-1111-1111-111111111111";

async function card(opts: { rewardExpiryDays?: number; name?: string; title?: string } = {}) {
  const { campaignId } = await createCampaign(pool, {
    mode: "weighted",
    name: opts.name ?? "Autumn Glow",
    rewards: [{ title: opts.title ?? "$25 off any facial", weight: 1, valueCents: 2500 }],
    rewardExpiryDays: opts.rewardExpiryDays,
  });
  const gen = await generateCards(pool, { campaignId, count: 1, actor: "staff:test" });
  return gen.cards[0];
}

const lena = { firstName: "Lena", phone: "(239) 555-0142", email: "Lena.Rosetti@gmail.com", smsOptIn: true, emailOptIn: false, ip: "1.2.3.4" };

describe("claimCard", () => {
  it("creates a customer with a wallet token, stamps consent, attaches the card, and audits", async () => {
    const c = await card();
    const res = await claimCard(pool, c.token, lena);
    expect(res.state).toBe("claimed");
    if (res.state !== "claimed") return;
    expect(res.walletToken).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const cu = (await pool.query("select * from customers where id = $1", [res.customerId])).rows[0];
    expect(cu).toMatchObject({ first_name: "Lena", phone: "+12395550142", email: "lena.rosetti@gmail.com", sms_opt_in: true, email_opt_in: false, source: "card:Autumn Glow" });
    expect(cu.sms_opt_in_at).toBeInstanceOf(Date);
    expect(cu.email_opt_in_at).toBeNull();

    expect((await pool.query("select customer_id from cards where id = $1", [c.id])).rows[0].customer_id).toBe(res.customerId);
    const actions = (await pool.query("select action, after from audit_log where action in ('customer.created','card.claimed') order by id")).rows;
    expect(actions.map((a) => a.action)).toEqual(["customer.created", "card.claimed"]);
    expect(actions[0].after.ip).toBe("1.2.3.4");

    // Reveal now works and lands in that customer's wallet.
    const reveal = await revealCard(pool, c.token);
    expect(reveal.state).toBe("revealed");
    if (reveal.state === "revealed") expect(reveal.walletToken).toBe(res.walletToken);
  });

  it("matches an existing customer by phone, then by email, and never revokes consent", async () => {
    const first = await claimCard(pool, (await card()).token, lena);
    if (first.state !== "claimed") throw new Error();

    // Same phone, different email + name: reused, email stays, SMS stays opted in.
    const byPhone = await claimCard(pool, (await card()).token, { firstName: "L", phone: "+12395550142", email: "other@example.com", smsOptIn: false, emailOptIn: false });
    if (byPhone.state !== "claimed") throw new Error();
    expect(byPhone.customerId).toBe(first.customerId);

    // No phone match but same email (different number): reused, email opt-in now set.
    const byEmail = await claimCard(pool, (await card()).token, { firstName: "Lena", phone: "(239) 555-0199", email: "lena.rosetti@gmail.com", smsOptIn: false, emailOptIn: true });
    if (byEmail.state !== "claimed") throw new Error();
    expect(byEmail.customerId).toBe(first.customerId);

    const cu = (await pool.query("select * from customers where id = $1", [first.customerId])).rows[0];
    expect(cu).toMatchObject({ first_name: "Lena", phone: "+12395550142", email: "lena.rosetti@gmail.com", sms_opt_in: true, email_opt_in: true });
    expect(cu.email_opt_in_at).toBeInstanceOf(Date);
    expect((await pool.query("select count(*)::int as n from customers")).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int as n from cards where customer_id = $1", [first.customerId])).rows[0].n).toBe(3);
  });

  it("creates distinct customers when neither phone nor email match", async () => {
    await claimCard(pool, (await card()).token, lena);
    await claimCard(pool, (await card()).token, { firstName: "Maya", phone: "(239) 555-0100", email: null, smsOptIn: false, emailOptIn: false });
    expect((await pool.query("select count(*)::int as n from customers")).rows[0].n).toBe(2);
  });

  it("validates input", async () => {
    const c = await card();
    await expect(claimCard(pool, c.token, { ...lena, firstName: " " })).rejects.toMatchObject({ field: "firstName" });
    await expect(claimCard(pool, c.token, { ...lena, phone: "555" })).rejects.toMatchObject({ field: "phone" });
    await expect(claimCard(pool, c.token, { ...lena, email: "nope" })).rejects.toMatchObject({ field: "email" });
    await expect(claimCard(pool, c.token, { ...lena, email: null, emailOptIn: true })).rejects.toBeInstanceOf(ValidationError);
    expect((await pool.query("select count(*)::int as n from customers")).rows[0].n).toBe(0);
  });

  it("is idempotent for an already-claimed card and refuses dead cards", async () => {
    const c = await card();
    const a = await claimCard(pool, c.token, lena);
    const b = await claimCard(pool, c.token, { firstName: "Someone", phone: "(239) 555-0000", email: null, smsOptIn: false, emailOptIn: false });
    expect(b).toEqual(a);
    expect((await pool.query("select count(*)::int as n from customers")).rows[0].n).toBe(1);

    expect((await claimCard(pool, "AAAAAAAAAAAAAAAAAAAAAA", lena)).state).toBe("not_found");
    const v = await card();
    await pool.query("update cards set status = 'void' where id = $1", [v.id]);
    expect((await claimCard(pool, v.token, lena)).state).toBe("void");
    const e = await card();
    await pool.query("update cards set expires_at = now() - interval '1 day' where id = $1", [e.id]);
    expect((await claimCard(pool, e.token, lena)).state).toBe("expired");
  });
});

describe("wallet", () => {
  it("lists a customer's rewards, scoped by wallet token, with lazy expiry", async () => {
    const c1 = await card({ rewardExpiryDays: 30 });
    const c2 = await card({ name: "Welcome", title: "Free brow wax" });
    const claim = await claimCard(pool, c1.token, lena);
    await claimCard(pool, c2.token, lena);
    if (claim.state !== "claimed") throw new Error();
    const r1 = await revealCard(pool, c1.token);
    const r2 = await revealCard(pool, c2.token);
    if (r1.state !== "revealed" || r2.state !== "revealed") throw new Error();

    const wallet = await getWallet(pool, claim.walletToken);
    expect(wallet!.firstName).toBe("Lena");
    expect(wallet!.rewards.map((r) => [r.title, r.status, r.campaignName])).toEqual([
      ["$25 off any facial", "available", "Autumn Glow"],
      ["Free brow wax", "available", "Welcome"],
    ]);

    // Expire the first lazily on next read.
    await pool.query("update customer_rewards set expires_at = now() - interval '1 day' where redemption_code = $1", [r1.reward.redemptionCode]);
    const again = await getWallet(pool, claim.walletToken);
    expect(again!.rewards.map((r) => r.status)).toEqual(["available", "expired"]);
    expect((await pool.query("select count(*)::int as n from audit_log where action = 'reward.expired'")).rows[0].n).toBe(1);

    // Detail: right wallet works, wrong wallet does not.
    const detail = await getWalletReward(pool, claim.walletToken, again!.rewards[0].id);
    expect(detail).toMatchObject({ title: "Free brow wax", redemptionCode: r2.reward.redemptionCode, customerFirstName: "Lena" });
    expect(detail!.cardDisplayNumber).toMatch(/^[0-9A-F]{4}$/);
    expect(await getWalletReward(pool, "AAAAAAAAAAAAAAAAAAAAAA", again!.rewards[0].id)).toBeNull();

    const other = await claimCard(pool, (await card()).token, { firstName: "Maya", phone: "(239) 555-0100", email: null, smsOptIn: false, emailOptIn: false });
    if (other.state !== "claimed") throw new Error();
    expect(await getWalletReward(pool, other.walletToken, again!.rewards[0].id)).toBeNull();
    expect((await getWallet(pool, other.walletToken))!.rewards).toEqual([]);
    expect(await getWallet(pool, "not-a-token")).toBeNull();
  });
});

describe("customers admin", () => {
  it("searches by name, phone digits and email; profiles show cards, rewards and consent", async () => {
    const c = await card();
    const claim = await claimCard(pool, c.token, lena);
    if (claim.state !== "claimed") throw new Error();
    await revealCard(pool, c.token);
    await claimCard(pool, (await card()).token, { firstName: "Maya", phone: "(239) 555-0100", email: "maya@example.com", smsOptIn: false, emailOptIn: false });

    expect((await searchCustomers(pool, "")).length).toBe(2);
    expect((await searchCustomers(pool, "len")).map((r) => r.firstName)).toEqual(["Lena"]);
    expect((await searchCustomers(pool, "555-0100")).map((r) => r.firstName)).toEqual(["Maya"]);
    expect((await searchCustomers(pool, "rosetti@")).map((r) => r.firstName)).toEqual(["Lena"]);
    expect((await searchCustomers(pool, "zzz")).length).toBe(0);
    const lenaRow = (await searchCustomers(pool, "Lena"))[0];
    expect(lenaRow).toMatchObject({ cards: 1, availableRewards: 1, smsOptIn: true });

    const profile = await getCustomerProfile(pool, claim.customerId);
    expect(profile!.cards).toHaveLength(1);
    expect(profile!.cards[0]).toMatchObject({ campaignName: "Autumn Glow", status: "revealed", resultTitle: "$25 off any facial" });
    expect(profile!.rewards[0]).toMatchObject({ title: "$25 off any facial", status: "available" });
    expect(profile!.smsOptInAt).toBeInstanceOf(Date);
    expect(await getCustomerProfile(pool, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("does not expose the outcome of an unscratched card in the profile", async () => {
    const c = await card();
    const claim = await claimCard(pool, c.token, lena);
    if (claim.state !== "claimed") throw new Error();
    const profile = await getCustomerProfile(pool, claim.customerId);
    expect(profile!.cards[0].resultTitle).toBeNull();
    expect(JSON.stringify(profile)).not.toMatch(/facial/);
  });

  it("regenerates the wallet token: old link dies, new one works, audited", async () => {
    const claim = await claimCard(pool, (await card()).token, lena);
    if (claim.state !== "claimed") throw new Error();
    const next = await regenerateWalletToken(pool, claim.customerId, `staff:${STAFF}`);
    expect(next).not.toBe(claim.walletToken);
    expect(await getWallet(pool, claim.walletToken)).toBeNull();
    expect((await getWallet(pool, next))!.customerId).toBe(claim.customerId);
    expect((await pool.query("select count(*)::int as n from audit_log where action = 'customer.wallet_regenerated'")).rows[0].n).toBe(1);
  });
});

describe("redeem lookup", () => {
  it("finds a reward by code in any format, with guest and card details; recent list updates", async () => {
    const c = await card({ rewardExpiryDays: 10 });
    await claimCard(pool, c.token, lena);
    const reveal = await revealCard(pool, c.token);
    if (reveal.state !== "revealed") throw new Error();
    const code = reveal.reward.redemptionCode;

    const found = await lookupReward(pool, code.toLowerCase().replace(/-/g, " "));
    expect(found).toMatchObject({ title: "$25 off any facial", status: "available", campaignName: "Autumn Glow" });
    expect(found!.customer).toMatchObject({ firstName: "Lena", phone: "+12395550142" });
    expect(found!.card.displayNumber).toMatch(/^[0-9A-F]{4}$/);
    expect(await lookupReward(pool, "GLW-ZZZZ-ZZ")).toBeNull();
    expect(await recentRedemptions(pool)).toEqual([]);

    await redeemReward(pool, { code, staffUserId: STAFF });
    expect((await lookupReward(pool, code))!.status).toBe("redeemed");
    expect((await recentRedemptions(pool)).map((r) => r.code)).toEqual([code]);
  });
});
