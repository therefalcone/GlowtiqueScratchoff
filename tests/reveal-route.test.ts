import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards } from "@/lib/server/engine";
import { claimCard, createCampaign, createCustomer, newPool, TEST_DATABASE_URL, truncateAll } from "./helpers";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const pool = newPool();
let POST: typeof import("@/app/api/cards/[token]/reveal/route").POST;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/cards/[token]/reveal/route"));
});
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

function call(token: string, ip = "10.0.0.1") {
  const req = new Request(`http://glow.test/api/cards/${token}/reveal`, {
    method: "POST",
    headers: { host: "glow.test", "x-forwarded-proto": "https", "x-forwarded-for": ip },
  });
  return POST(req, { params: Promise.resolve({ token }) });
}

describe("POST /api/cards/[token]/reveal", () => {
  it("maps engine states to HTTP statuses and returns the reward with a wallet URL", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call("AAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);

    const { campaignId } = await createCampaign(pool, {
      mode: "weighted",
      rewards: [{ title: "Free brow wax", weight: 1 }],
      rewardExpiryDays: 30,
    });
    const gen = await generateCards(pool, { campaignId, count: 2, actor: "staff:test" });
    const [unclaimed, claimed] = gen.cards;

    expect((await call(unclaimed.token)).status).toBe(409);

    await claimCard(pool, claimed.id, await createCustomer(pool));
    const first = await call(claimed.token);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toMatchObject({ state: "revealed", firstReveal: true, reward: { title: "Free brow wax" } });
    expect(body.walletUrl).toMatch(/^https:\/\/glow\.test\/w\/[A-Za-z0-9_-]{22}$/);
    expect(body.reward.redemptionCode).toBeUndefined();

    const again = await (await call(claimed.token)).json();
    expect(again.firstReveal).toBe(false);
    expect(again.walletUrl).toBe(body.walletUrl);

    await pool.query("update cards set status = 'void', voided_at = now() where id = $1", [unclaimed.id]);
    const gone = await call(unclaimed.token);
    expect(gone.status).toBe(410);
    expect(await gone.json()).toEqual({ state: "void" });
  });

  it("rate-limits by IP", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await call("AAAAAAAAAAAAAAAAAAAAAA", "203.0.113.7")).status;
    expect(last).toBe(429);
    expect((await call("AAAAAAAAAAAAAAAAAAAAAA", "203.0.113.8")).status).toBe(404);
  });
});
