import { NextResponse } from "next/server";
import { batchCsv, getBatch } from "@/lib/server/cards";
import { getPool } from "@/lib/server/db";
import { appUrlFrom } from "@/lib/server/request";
import { getStaffUser } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getStaffUser();
  if (!staff || staff === "not_staff") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const batch = await getBatch(getPool(), id);
  if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const slug = (batch.label ?? batch.campaignName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return new NextResponse(batchCsv(batch, appUrlFrom(request.headers)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="links-${slug || "batch"}.csv"`,
      "cache-control": "no-store",
    },
  });
}
