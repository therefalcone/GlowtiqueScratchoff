"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { regenerateWalletToken } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";
import { EngineError } from "@/lib/server/errors";
import { getStaffUser } from "@/lib/server/supabase";

export async function regenerateWalletLink(customerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await getStaffUser();
  if (!staff || staff === "not_staff") redirect("/admin/login");
  try {
    await regenerateWalletToken(getPool(), customerId, `staff:${staff.id}`);
  } catch (err) {
    if (err instanceof EngineError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  revalidatePath(`/admin/customers/${customerId}`);
  return { ok: true };
}
