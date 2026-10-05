"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  activateCampaign,
  closeCampaign,
  cloneCampaign,
  createCampaign,
  updateCampaign,
  type CampaignInput,
  type RewardInput,
} from "@/lib/server/campaigns";
import { getPool } from "@/lib/server/db";
import { EngineError } from "@/lib/server/errors";
import { getStaffUser } from "@/lib/server/supabase";

/** Wire format from the client builder: dates as yyyy-mm-dd. */
export interface CampaignPayload {
  id?: string;
  name: string;
  mode: "weighted" | "fixed_pool";
  startsAt: string | null;
  endsAt: string | null;
  cardExpiryDays: number | null;
  rewardExpiryDays: number | null;
  officialRulesUrl: string | null;
  rewards: RewardInput[];
}

export type ActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

async function actor(): Promise<string> {
  const staff = await getStaffUser();
  if (!staff || staff === "not_staff") redirect("/admin/login");
  return `staff:${staff.id}`;
}

function toInput(p: CampaignPayload): CampaignInput {
  return {
    name: p.name,
    mode: p.mode,
    // Date-only pickers: a start is the beginning of that UTC day, an end is
    // the last instant of it (the campaign runs "through" the end date).
    startsAt: p.startsAt ? new Date(`${p.startsAt}T00:00:00.000Z`) : null,
    endsAt: p.endsAt ? new Date(`${p.endsAt}T23:59:59.999Z`) : null,
    cardExpiryDays: p.cardExpiryDays,
    rewardExpiryDays: p.rewardExpiryDays,
    officialRulesUrl: p.officialRulesUrl?.trim() || null,
    rewards: p.rewards.map((r) => ({
      title: r.title,
      description: r.description?.trim() || null,
      terms: r.terms?.trim() || null,
      retailValueCents: r.retailValueCents,
      weight: r.weight,
      quantityTotal: r.quantityTotal,
    })),
  };
}

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof EngineError) return { ok: false, error: err.message };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function saveCampaign(payload: CampaignPayload): Promise<ActionResult<{ id: string }>> {
  const who = await actor();
  try {
    const input = toInput(payload);
    let id = payload.id;
    if (id) {
      await updateCampaign(getPool(), id, input, who);
    } else {
      id = await createCampaign(getPool(), input, who);
    }
    revalidatePath("/admin/campaigns");
    revalidatePath(`/admin/campaigns/${id}`);
    return { ok: true, value: { id } };
  } catch (err) {
    return failure(err);
  }
}

export async function publishCampaign(id: string): Promise<ActionResult> {
  const who = await actor();
  try {
    await activateCampaign(getPool(), id, who);
    revalidatePath("/admin/campaigns");
    revalidatePath(`/admin/campaigns/${id}`);
    return { ok: true, value: undefined };
  } catch (err) {
    return failure(err);
  }
}

export async function closeCampaignAction(id: string): Promise<ActionResult> {
  const who = await actor();
  try {
    await closeCampaign(getPool(), id, who);
    revalidatePath("/admin/campaigns");
    revalidatePath(`/admin/campaigns/${id}`);
    return { ok: true, value: undefined };
  } catch (err) {
    return failure(err);
  }
}

export async function cloneCampaignAction(id: string): Promise<ActionResult<{ id: string }>> {
  const who = await actor();
  try {
    const newId = await cloneCampaign(getPool(), id, who);
    revalidatePath("/admin/campaigns");
    return { ok: true, value: { id: newId } };
  } catch (err) {
    return failure(err);
  }
}
