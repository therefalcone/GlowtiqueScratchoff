"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  formatDollars,
  formatPercent,
  summarizePool,
  type CampaignMode,
  type PoolRow,
} from "@/lib/pool-math";
import type { RewardInput } from "@/lib/server/campaigns";
import {
  cloneCampaignAction,
  closeCampaignAction,
  publishCampaign,
  saveCampaign,
  type CampaignPayload,
} from "./actions";

export interface BuilderReward extends RewardInput {
  quantityRemaining: number | null;
}

export interface BuilderCampaign {
  id: string;
  name: string;
  mode: CampaignMode;
  status: "draft" | "active" | "closed";
  startsAt: string | null;
  endsAt: string | null;
  cardExpiryDays: number | null;
  rewardExpiryDays: number | null;
  officialRulesUrl: string | null;
  locked: boolean;
  generatedCount: number;
  rewards: BuilderReward[];
}

interface RowState {
  key: number;
  title: string;
  valueDollars: string;
  weight: string;
  quantity: string;
  description: string;
  terms: string;
  detailsOpen: boolean;
  quantityRemaining: number | null;
}

const STATUS_TAG = {
  active: { label: "Live", cls: "tag tag-accent" },
  draft: { label: "Draft", cls: "tag tag-outline" },
  closed: { label: "Ended", cls: "tag tag-neutral" },
} as const;

let nextKey = 1;

function toRows(rewards: BuilderReward[]): RowState[] {
  return rewards.map((r) => ({
    key: nextKey++,
    title: r.title,
    valueDollars: r.retailValueCents ? String(r.retailValueCents / 100) : "",
    weight: r.weight == null ? "" : String(r.weight),
    quantity: r.quantityTotal == null ? "" : String(r.quantityTotal),
    description: r.description ?? "",
    terms: r.terms ?? "",
    detailsOpen: false,
    quantityRemaining: r.quantityRemaining,
  }));
}

function intOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function dollarsToCents(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function toPoolRows(rows: RowState[], mode: CampaignMode): PoolRow[] {
  return rows.map((r) => ({
    title: r.title,
    retailValueCents: dollarsToCents(r.valueDollars),
    weight: mode === "weighted" ? intOrNull(r.weight) : null,
    quantityTotal: mode === "fixed_pool" ? intOrNull(r.quantity) : null,
  }));
}

export function CampaignBuilder({ campaign }: { campaign: BuilderCampaign | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState(campaign?.name ?? "");
  const [mode, setMode] = useState<CampaignMode>(campaign?.mode ?? "weighted");
  const [startsAt, setStartsAt] = useState(campaign?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(campaign?.endsAt ?? "");
  const [cardExpiryDays, setCardExpiryDays] = useState(
    campaign?.cardExpiryDays == null ? "" : String(campaign.cardExpiryDays)
  );
  const [rewardExpiryDays, setRewardExpiryDays] = useState(
    campaign?.rewardExpiryDays == null ? "" : String(campaign.rewardExpiryDays)
  );
  const [rulesUrl, setRulesUrl] = useState(campaign?.officialRulesUrl ?? "");
  const [plannedCards, setPlannedCards] = useState("500");
  const [rows, setRows] = useState<RowState[]>(() =>
    campaign ? toRows(campaign.rewards) : []
  );

  const status = campaign?.status ?? "draft";
  const editable = status === "draft" && !campaign?.locked;
  const isOdds = mode === "weighted";

  const summary = useMemo(
    () => summarizePool(mode, toPoolRows(rows, mode), Number(plannedCards) || 0),
    [mode, rows, plannedCards]
  );

  const updateRow = (key: number, patch: Partial<RowState>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        key: nextKey++,
        title: "",
        valueDollars: "",
        weight: "",
        quantity: "",
        description: "",
        terms: "",
        detailsOpen: false,
        quantityRemaining: null,
      },
    ]);

  const payload = (): CampaignPayload => ({
    id: campaign?.id,
    name,
    mode,
    startsAt: startsAt || null,
    endsAt: endsAt || null,
    cardExpiryDays: intOrNull(cardExpiryDays),
    rewardExpiryDays: intOrNull(rewardExpiryDays),
    officialRulesUrl: rulesUrl || null,
    rewards: rows.map((r) => ({
      title: r.title,
      description: r.description || null,
      terms: r.terms || null,
      retailValueCents: dollarsToCents(r.valueDollars),
      weight: mode === "weighted" ? intOrNull(r.weight) : null,
      quantityTotal: mode === "fixed_pool" ? intOrNull(r.quantity) : null,
    })),
  });

  const run = (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      await fn();
    });
  };

  const onSaveDraft = () =>
    run(async () => {
      const res = await saveCampaign(payload());
      if (!res.ok) return setError(res.error);
      if (!campaign) router.push(`/admin/campaigns/${res.value.id}`);
      else {
        setNotice("Draft saved.");
        router.refresh();
      }
    });

  const onPublish = () =>
    run(async () => {
      const saved = await saveCampaign(payload());
      if (!saved.ok) return setError(saved.error);
      const published = await publishCampaign(saved.value.id);
      if (!published.ok) {
        setError(published.error);
        if (!campaign) router.push(`/admin/campaigns/${saved.value.id}`);
        return;
      }
      router.push(`/admin/campaigns/${saved.value.id}`);
      router.refresh();
    });

  const onClose = () => {
    if (!campaign) return;
    if (!window.confirm("Close this campaign? Links stop generating and it can't be reopened.")) return;
    run(async () => {
      const res = await closeCampaignAction(campaign.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  };

  const onClone = () => {
    if (!campaign) return;
    run(async () => {
      const res = await cloneCampaignAction(campaign.id);
      if (!res.ok) return setError(res.error);
      router.push(`/admin/campaigns/${res.value.id}`);
    });
  };

  const tag = STATUS_TAG[status];
  const amountLabel = isOdds ? "Weight" : "Quantity";
  const weightNote = isOdds
    ? summary.denominator === 100
      ? "Weights total 100%"
      : `Weights total ${summary.denominator}% — normalized to 100% for odds`
    : `${summary.denominator.toLocaleString("en-US")} cards in pool`;
  const weightWarn = isOdds && summary.denominator !== 100;

  return (
    <div className="grid grid-cols-[1fr_320px] gap-10 content-start">
      <div className="col-span-full flex items-end justify-between border-b-2 border-[var(--color-divider)] pb-4">
        <div>
          <div className="text-muted text-[12px]">
            <Link href="/admin/campaigns" className="text-inherit no-underline hover:underline">
              Campaigns
            </Link>{" "}
            / {campaign ? campaign.name : "New campaign"}
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-[32px]">Campaign builder</h1>
            {campaign && <span className={tag.cls}>{tag.label}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {editable && (
            <>
              <button type="button" className="btn btn-secondary" onClick={onSaveDraft} disabled={pending}>
                Save draft
              </button>
              <button type="button" className="btn btn-primary" onClick={onPublish} disabled={pending}>
                Publish
              </button>
            </>
          )}
          {campaign && status === "active" && (
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
              Close campaign
            </button>
          )}
          {campaign && (
            <button type="button" className="btn btn-secondary" onClick={onClone} disabled={pending}>
              Clone
            </button>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={
            "col-span-full border-l-2 px-3 py-2 text-[13px] " +
            (error
              ? "border-[var(--color-accent)] bg-[var(--color-accent-100)] text-[var(--color-accent-800)]"
              : "border-[var(--color-text)] bg-[var(--color-surface)]")
          }
        >
          {error ?? notice}
        </div>
      )}

      {campaign && !editable && (
        <div className="col-span-full text-[13px] text-muted">
          {campaign.locked
            ? `Rewards are locked — ${campaign.generatedCount.toLocaleString("en-US")} card${
                campaign.generatedCount === 1 ? "" : "s"
              } generated. Clone the campaign to change the pool.`
            : `This campaign is ${tag.label.toLowerCase()} and read-only. Clone it to make changes.`}
        </div>
      )}

      <div className="flex flex-col gap-5 min-w-0">
        <fieldset disabled={!editable} className="contents">
          <div className="grid grid-cols-3 gap-4">
            <div className="field">
              <label htmlFor="name">Campaign name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="starts">Starts</label>
              <input id="starts" type="date" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ends">Ends (cards expire)</label>
              <input id="ends" type="date" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cardExpiry">Card expiry (days after issue)</label>
              <input
                id="cardExpiry"
                type="number"
                min={1}
                className="input"
                placeholder="Until campaign ends"
                value={cardExpiryDays}
                onChange={(e) => setCardExpiryDays(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="rewardExpiry">Reward expiry (days after reveal)</label>
              <input
                id="rewardExpiry"
                type="number"
                min={1}
                className="input"
                placeholder="No expiry"
                value={rewardExpiryDays}
                onChange={(e) => setRewardExpiryDays(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="rules">Official rules URL</label>
              <input id="rules" type="url" className="input" placeholder="https://" value={rulesUrl} onChange={(e) => setRulesUrl(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t-2 border-[var(--color-divider)] pt-4">
            <div>
              <div className="font-[family-name:var(--font-heading)] font-extrabold text-[18px]">Reward pool</div>
              <div className="text-muted text-[13px]">
                {isOdds
                  ? "Odds mode — weights set each reward's share of the cards you generate."
                  : "Fixed pool — exact quantities; total cards is the sum."}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isOdds && (
                <label className="text-[13px] flex items-center gap-2 whitespace-nowrap">
                  Total cards
                  <input
                    className="input w-[90px] text-right"
                    inputMode="numeric"
                    value={plannedCards}
                    onChange={(e) => setPlannedCards(e.target.value)}
                    disabled={false}
                    aria-label="Planned total cards (for odds preview)"
                  />
                </label>
              )}
              <div className="seg" role="group" aria-label="Pool mode">
                <button type="button" className="seg-opt" aria-pressed={isOdds} onClick={() => setMode("weighted")}>
                  Odds
                </button>
                <button type="button" className="seg-opt" aria-pressed={!isOdds} onClick={() => setMode("fixed_pool")}>
                  Fixed pool
                </button>
              </div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th className="w-[40%]">Reward</th>
                <th className="text-right">Retail value</th>
                <th className="text-right">{amountLabel}</th>
                <th className="text-right">Odds</th>
                <th className="text-right">{isOdds ? "Cards" : campaign?.locked ? "Remaining" : "Cards"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted">
                    No rewards yet. Add one — a single reward makes every card a guaranteed gift.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <RowEditor
                  key={r.key}
                  row={r}
                  isOdds={isOdds}
                  odds={summary.odds[i]}
                  cards={summary.cards[i]}
                  showRemaining={!isOdds && Boolean(campaign?.locked)}
                  editable={editable}
                  onChange={(patch) => updateRow(r.key, patch)}
                  onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                />
              ))}
            </tbody>
          </table>

          <div className="flex justify-between items-center">
            {editable ? (
              <button type="button" className="btn btn-secondary" onClick={addRow}>
                Add reward
              </button>
            ) : (
              <span />
            )}
            <span className={"text-[13px] " + (weightWarn ? "text-[var(--color-accent-700)]" : "text-[var(--color-neutral-600)]")}>
              {weightNote}
            </span>
          </div>
        </fieldset>
      </div>

      <aside className="stat-grid grid-cols-1 self-start">
        <div className="stat-tile on-surface">
          <div className="stat-label">Total cards</div>
          <div className="stat-value">{summary.totalCards.toLocaleString("en-US")}</div>
        </div>
        <div className="stat-tile on-surface">
          <div className="stat-label">Total prize value</div>
          <div className="stat-value">{formatDollars(summary.totalPrizeCents)}</div>
          {summary.overPrizeWarning && (
            <div role="alert" className="mt-2 border-l-2 border-[var(--color-accent)] pl-2 text-[12px] text-[var(--color-accent-700)] font-semibold">
              Total prize value exceeds $5,000. Check with the owner before publishing.
            </div>
          )}
        </div>
        <div className="stat-tile on-surface">
          <div className="stat-label">Avg. value per card</div>
          <div className="stat-value">{formatDollars(summary.avgPrizeCents)}</div>
        </div>
        <div className="stat-tile on-surface flex flex-col gap-2">
          <div className="stat-label">Odds per reward</div>
          {rows.map((r, i) => (
            <div key={r.key} className="flex flex-col gap-[3px] text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="truncate">{r.title || "Untitled reward"}</span>
                <span className="font-semibold">{formatPercent(summary.odds[i])}</span>
              </div>
              <div className="h-1 bg-[var(--color-neutral-300)]">
                <div className="h-full bg-[var(--color-accent)]" style={{ width: `${Math.round(summary.odds[i] * 100)}%` }} />
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-muted text-[12px]">Add rewards to see odds.</div>}
        </div>
      </aside>
    </div>
  );
}

function RowEditor({
  row,
  isOdds,
  odds,
  cards,
  showRemaining,
  editable,
  onChange,
  onRemove,
}: {
  row: RowState;
  isOdds: boolean;
  odds: number;
  cards: number;
  showRemaining: boolean;
  editable: boolean;
  onChange: (patch: Partial<RowState>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <div className="flex items-center gap-2">
            <input
              className="input pl-0"
              style={{ background: "transparent", borderColor: "transparent" }}
              placeholder="Reward name"
              aria-label="Reward name"
              value={row.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost text-[12px] whitespace-nowrap"
              aria-expanded={row.detailsOpen}
              onClick={() => onChange({ detailsOpen: !row.detailsOpen })}
            >
              {row.detailsOpen ? "Hide" : "Details"}
            </button>
          </div>
        </td>
        <td className="text-right whitespace-nowrap">
          <span className="text-muted">$</span>
          <input
            className="input w-[80px] text-right inline-block"
            inputMode="decimal"
            aria-label="Retail value in dollars"
            value={row.valueDollars}
            onChange={(e) => onChange({ valueDollars: e.target.value })}
          />
        </td>
        <td className="text-right whitespace-nowrap">
          <input
            className="input w-[90px] text-right inline-block"
            inputMode="numeric"
            aria-label={isOdds ? "Weight" : "Quantity"}
            value={isOdds ? row.weight : row.quantity}
            onChange={(e) => onChange(isOdds ? { weight: e.target.value } : { quantity: e.target.value })}
          />
          <span className="text-muted ml-1 inline-block w-[14px]">{isOdds ? "%" : ""}</span>
        </td>
        <td className="text-right font-semibold pl-4 whitespace-nowrap">{formatPercent(odds)}</td>
        <td className="text-right pl-4 whitespace-nowrap">
          {showRemaining && row.quantityRemaining != null
            ? `${row.quantityRemaining.toLocaleString("en-US")} / ${cards.toLocaleString("en-US")}`
            : cards.toLocaleString("en-US")}
        </td>
        <td className="text-right">
          {editable && (
            <button type="button" className="btn btn-ghost text-[var(--color-text)]" onClick={onRemove}>
              Remove
            </button>
          )}
        </td>
      </tr>
      {row.detailsOpen && (
        <tr>
          <td colSpan={6} className="bg-[var(--color-surface)]">
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="field">
                <label>Description (shown on reveal)</label>
                <textarea
                  className="input"
                  rows={2}
                  value={row.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="Good toward any facial on our menu."
                />
              </div>
              <div className="field">
                <label>Terms (shown on the reward)</label>
                <textarea
                  className="input"
                  rows={2}
                  value={row.terms}
                  onChange={(e) => onChange({ terms: e.target.value })}
                  placeholder="One reward per visit. Not combinable with other offers."
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
