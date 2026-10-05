import { NextResponse } from "next/server";
import { claimCard } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";
import { ValidationError } from "@/lib/server/errors";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { appUrlFrom, clientIpFrom } from "@/lib/server/request";

export const dynamic = "force-dynamic";

/** Capture form: attaches (or creates) the customer for an unclaimed card. */
export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = getPool();
  const ip = clientIpFrom(request.headers);

  const limit = await checkRateLimit(pool, { key: `claim:${ip}`, limit: 20, windowSeconds: 60 });
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await claimCard(pool, token, {
      firstName: String(body.firstName ?? ""),
      phone: String(body.phone ?? ""),
      email: body.email == null ? null : String(body.email),
      smsOptIn: body.smsOptIn === true,
      emailOptIn: body.emailOptIn === true,
      ip,
    });
    switch (result.state) {
      case "not_found":
        return NextResponse.json({ state: "not_found" }, { status: 404 });
      case "expired":
      case "void":
      case "revealed":
        return NextResponse.json({ state: result.state }, { status: 410 });
      case "claimed":
        return NextResponse.json({
          state: "claimed",
          walletUrl: `${appUrlFrom(request.headers)}/w/${result.walletToken}`,
        });
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }
}
