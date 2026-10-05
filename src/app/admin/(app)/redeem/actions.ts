"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/server/db";
import { redeemReward } from "@/lib/server/engine";
import { EngineError } from "@/lib/server/errors";
import { getStaffUser } from "@/lib/server/supabase";

export async function confirmRedemption(formData: FormData): Promise<void> {
  const staff = await getStaffUser();
  if (!staff || staff === "not_staff") redirect("/admin/login");
  const code = String(formData.get("code") ?? "");
  let outcome: "done" | string;
  try {
    await redeemReward(getPool(), { code, staffUserId: staff.id });
    outcome = "done";
  } catch (err) {
    outcome = err instanceof EngineError ? err.message : "Something went wrong. Please try again.";
    if (!(err instanceof EngineError)) console.error(err);
  }
  revalidatePath("/admin/redeem");
  revalidatePath("/admin/customers");
  const params = new URLSearchParams({ code });
  if (outcome === "done") params.set("done", "1");
  else params.set("error", outcome);
  redirect(`/admin/redeem?${params.toString()}`);
}
