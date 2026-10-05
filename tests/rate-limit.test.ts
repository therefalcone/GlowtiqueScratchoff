import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { newPool, truncateAll } from "./helpers";

const pool = newPool();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

describe("checkRateLimit", () => {
  it("allows up to the limit per window, then denies, then resets", async () => {
    const opts = { key: "card:1.2.3.4", limit: 3, windowSeconds: 1 };
    // Align to the start of a window so the test never straddles two.
    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 600) await new Promise((r) => setTimeout(r, 1000 - msIntoSecond + 10));

    const results = [];
    for (let i = 0; i < 4; i++) results.push((await checkRateLimit(pool, opts)).allowed);
    expect(results).toEqual([true, true, true, false]);

    // Different keys are independent.
    expect((await checkRateLimit(pool, { ...opts, key: "card:9.9.9.9" })).allowed).toBe(true);

    await new Promise((r) => setTimeout(r, 1100));
    expect((await checkRateLimit(pool, opts)).allowed).toBe(true);
  });
});
