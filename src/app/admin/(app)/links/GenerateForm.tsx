"use client";

import { useActionState, useState } from "react";
import { generateLinks, type GenerateState } from "./actions";

export interface FormCampaign {
  id: string;
  name: string;
  mode: "weighted" | "fixed_pool";
  generated: number;
  poolRemaining: number | null;
  poolTotal: number | null;
  expiryPreview: string | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function GenerateForm({ campaigns, selectedId }: { campaigns: FormCampaign[]; selectedId: string | null }) {
  const [state, formAction, pending] = useActionState<GenerateState, FormData>(generateLinks, { error: null });
  const [campaignId, setCampaignId] = useState(selectedId ?? "");
  const [quantity, setQuantity] = useState("25");
  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;
  const n = Math.max(0, Math.trunc(Number(quantity) || 0));

  return (
    <form action={formAction} className="flex flex-col gap-[14px]">
      {state.error && (
        <div role="alert" className="border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-100)] text-[var(--color-accent-800)] px-3 py-2 text-[13px]">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="campaignId">Campaign</label>
        <select id="campaignId" name="campaignId" className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={campaigns.length === 0}>
          {campaigns.length === 0 && <option value="">No live campaigns</option>}
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · Live
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="quantity">Quantity</label>
        <input id="quantity" name="quantity" type="number" min={1} max={1000} className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="label">Label (optional)</label>
        <input id="label" name="label" className="input" placeholder="Front desk · Week of Sep 28" maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="expiry">Expiry</label>
        <input
          id="expiry"
          className="input"
          readOnly
          value={campaign ? (campaign.expiryPreview ? `${fmtDate(campaign.expiryPreview)} (campaign default)` : "No expiry (campaign default)") : ""}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block mt-2" disabled={pending || !campaign || n < 1}>
        {pending ? "Generating…" : n === 1 ? "Generate 1 link" : `Generate ${n.toLocaleString("en-US")} links`}
      </button>
      {campaign && (
        <div className="text-muted text-[12px]">
          {campaign.mode === "fixed_pool"
            ? `Remaining in pool: ${(campaign.poolRemaining ?? 0).toLocaleString("en-US")} of ${(campaign.poolTotal ?? 0).toLocaleString("en-US")} cards.`
            : `Odds mode · ${campaign.generated.toLocaleString("en-US")} cards generated so far.`}
        </div>
      )}
    </form>
  );
}
