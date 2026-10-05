import Link from "next/link";
import { campaignStats, listCampaigns, type CampaignListRow } from "@/lib/server/campaigns";
import { getPool } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const STATUS_TAG: Record<CampaignListRow["status"], { label: string; cls: string }> = {
  active: { label: "Live", cls: "tag tag-accent" },
  draft: { label: "Draft", cls: "tag tag-outline" },
  closed: { label: "Ended", cls: "tag tag-neutral" },
};

function shortDate(d: Date, withYear: boolean): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function runs(c: CampaignListRow): string {
  if (c.startsAt && c.endsAt) return `${shortDate(c.startsAt, false)} – ${shortDate(c.endsAt, true)}`;
  if (c.startsAt) return `From ${shortDate(c.startsAt, true)}`;
  if (c.endsAt) return `Through ${shortDate(c.endsAt, true)}`;
  return "Ongoing";
}

function pct(n: number, of: number): string | null {
  return of ? Math.round((n / of) * 100) + "%" : null;
}

function Count({ n, of }: { n: number; of: number }) {
  const p = pct(n, of);
  return (
    <>
      {n.toLocaleString("en-US")}
      {p && <span className="text-muted"> · {p}</span>}
    </>
  );
}

export default async function CampaignsPage() {
  const pool = getPool();
  const [campaigns, stats] = await Promise.all([listCampaigns(pool), campaignStats(pool)]);

  return (
    <>
      <div className="flex items-end justify-between border-b-2 border-[var(--color-divider)] pb-4">
        <div>
          <h1 className="text-[32px]">Campaigns</h1>
          <div className="text-muted text-[13px]">
            {stats.campaignCount} {stats.campaignCount === 1 ? "campaign" : "campaigns"} ·{" "}
            {stats.cardsIssuedThisYear.toLocaleString("en-US")} cards issued this year
          </div>
        </div>
        <Link href="/admin/campaigns/new" className="btn btn-primary">
          New campaign
        </Link>
      </div>

      <div className="stat-grid grid-cols-4">
        <div className="stat-tile">
          <div className="stat-label">Live campaigns</div>
          <div className="stat-value">{stats.liveCampaigns}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Scratched · 30 days</div>
          <div className="stat-value">{stats.revealedLast30Days.toLocaleString("en-US")}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Redeemed · 30 days</div>
          <div className="stat-value">{stats.redeemedLast30Days.toLocaleString("en-US")}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Redemption rate</div>
          <div className="stat-value">
            {stats.redemptionRate == null ? "—" : (stats.redemptionRate * 100).toFixed(1) + "%"}
          </div>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th>Runs</th>
            <th className="text-right">Generated</th>
            <th className="text-right">Scratched</th>
            <th className="text-right">Redeemed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted">
                No campaigns yet. Create one to start issuing cards.
              </td>
            </tr>
          )}
          {campaigns.map((c) => {
            const tag = STATUS_TAG[c.status];
            const none = c.status === "draft" && c.generated === 0;
            return (
              <tr key={c.id}>
                <td className="font-semibold">{c.name}</td>
                <td>
                  <span className={tag.cls}>{tag.label}</span>
                </td>
                <td className="text-muted">{runs(c)}</td>
                <td className="text-right">{none ? "—" : c.generated.toLocaleString("en-US")}</td>
                <td className="text-right">{none ? "—" : <Count n={c.revealed} of={c.generated} />}</td>
                <td className="text-right">{none ? "—" : <Count n={c.redeemed} of={c.revealed} />}</td>
                <td className="text-right">
                  <Link href={`/admin/campaigns/${c.id}`} className="btn btn-ghost">
                    {c.status === "draft" ? "Edit" : "Open"}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
