import { NextResponse } from "next/server";
import { TOKEN_RE } from "@/lib/card-display";
import { getPool } from "@/lib/server/db";
import { revealCard } from "@/lib/server/engine";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { appUrlFrom, clientIpFrom } from "@/lib/server/request";

export const dynamic = "force-dynamic";

/**
 * Called on the first scratch stroke (or the Reveal button). Atomically marks
 * the card revealed and creates the customer_reward; idempotent on repeat.
 */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = getPool();

  const limit = await checkRateLimit(pool, {
    key: `reveal:${clientIpFrom(request.headers)}`,
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ state: "not_found" }, { status: 404 });
  }

  const result = await revealCard(pool, token, { actor: "customer" });
  switch (result.state) {
    case "not_found":
      return NextResponse.json({ state: "not_found" }, { status: 404 });
    case "expired":
    case "void":
      return NextResponse.json({ state: result.state }, { status: 410 });
    case "unclaimed":
      return NextResponse.json({ state: "unclaimed" }, { status: 409 });
    case "revealed":
      return NextResponse.json({
        state: "revealed",
        firstReveal: result.firstReveal,
        reward: {
          title: result.reward.title,
          description: result.reward.description,
          terms: result.reward.terms,
          expiresAt: result.reward.expiresAt,
        },
        walletUrl: `${appUrlFrom(request.headers)}/w/${result.walletToken}`,
        revealedAt: result.revealedAt,
      });
  }
}
