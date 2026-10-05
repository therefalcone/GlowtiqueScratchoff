import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateCards } from "@/lib/server/engine";
import { createCampaign, newPool, TEST_DATABASE_URL, truncateAll } from "./helpers";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const pool = newPool();
let POST: typeof import("@/app/api/cards/[token]/claim/route").POST;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/cards/[token]/claim/route"));
});
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

function call(token: string, body: unknown, ip = "10.1.1.1") {
  const req = new Request(`http://glow.test/api/cards/${token}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "glow.test", "x-forwarded-proto": "https", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ token }) });
}

describe("POST /api/cards/[token]/claim", () => {
  it("validates, claims, and returns the wallet URL", async () => {
    const { campaignId } = await createCampaign(pool, { mode: "weighted", rewards: [{ title: "A", weight: 1 }] });
    const [c] = (await generateCards(pool, { campaignId, count: 1, actor: "staff:test" })).cards;

    expect((await call(c.token, "not json")).status).toBe(400);
    const bad = await call(c.token, { firstName: "Lena", phone: "12", email: null });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: "phone" });

    const ok = await call(c.token, { firstName: "Lena", phone: "(239) 555-0142", email: "", smsOptIn: true });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.state).toBe("claimed");
    expect(body.walletUrl).toMatch(/^https:\/\/glow\.test\/w\/[A-Za-z0-9_-]{22}$/);

    expect((await call("AAAAAAAAAAAAAAAAAAAAAA", { firstName: "L", phone: "(239) 555-0142" })).status).toBe(404);
    await pool.query("update cards set status = 'void' where id = $1", [c.id]);
    expect((await call(c.token, { firstName: "L", phone: "(239) 555-0142" })).status).toBe(410);
  });

  it("rate-limits by IP", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await call("AAAAAAAAAAAAAAAAAAAAAA", {}, "203.0.113.50")).status;
    expect(last).toBe(429);
  });
});
