"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { voidCard } from "@/lib/server/cards";
import { getPool } from "@/lib/server/db";
import { generateCards } from "@/lib/server/engine";
import { EngineError } from "@/lib/server/errors";
import { getStaffUser } from "@/lib/server/supabase";

const MAX_PER_BATCH = 1000;
const UUID = /^[0-9a-f-]{36}$/i;

export interface GenerateState {
  error: string | null;
}

async function staff() {
  const s = await getStaffUser();
  if (!s || s === "not_staff") redirect("/admin/login");
  return s;
}

export async function generateLinks(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await staff();
  const campaignId = String(formData.get("campaignId") ?? "");
  const quantity = Number(formData.get("quantity"));
  const label = String(formData.get("label") ?? "").trim() || null;

  if (!UUID.test(campaignId)) return { error: "Choose a campaign." };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_BATCH) {
    return { error: `Quantity must be between 1 and ${MAX_PER_BATCH.toLocaleString("en-US")}.` };
  }

  let batchId: string;
  try {
    const result = await generateCards(getPool(), {
      campaignId,
      count: quantity,
      cardLabel: label,
      batchLabel: label,
      actor: `staff:${user.id}`,
      createdBy: user.id,
    });
    batchId = result.batchId;
  } catch (err) {
    if (err instanceof EngineError) return { error: err.message };
    console.error(err);
    return { error: "Something went wrong. Please try again." };
  }
  revalidatePath("/admin/links");
  revalidatePath("/admin/campaigns");
  redirect(`/admin/links?campaign=${campaignId}&batch=${batchId}`);
}

export async function voidCardAction(cardId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await staff();
  try {
    await voidCard(getPool(), cardId, `staff:${user.id}`);
  } catch (err) {
    if (err instanceof EngineError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  revalidatePath("/admin/links");
  return { ok: true };
}
