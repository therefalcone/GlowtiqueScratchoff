import Link from "next/link";
import { formatPhone } from "@/lib/phone";
import { formatDollars } from "@/lib/pool-math";
import { lookupReward, recentRedemptions } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";
import { normalizeRedemptionCode } from "@/lib/server/tokens";
import { confirmRedemption } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
const fmtTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default async function RedeemPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; done?: string; error?: string }>;
}) {
  const { code = "", done, error } = await searchParams;
  const pool = getPool();
  const normalized = code ? normalizeRedemptionCode(code) : "";
  const [reward, recent] = await Promise.all([
    normalized ? lookupReward(pool, normalized) : Promise.resolve(null),
    recentRedemptions(pool),
  ]);
  const guest = reward ? [reward.customer.firstName, reward.customer.lastName].filter(Boolean).join(" ") || "Guest" : "";
  const daysLeft = reward?.expiresAt ? Math.ceil((reward.expiresAt.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="grid grid-cols-[420px_1fr] gap-10 content-start">
      <div className="col-span-full border-b-2 border-[var(--color-divider)] pb-4">
        <h1 className="text-[32px]">Redeem a reward</h1>
        <div className="text-muted text-[13px]">Scan the guest's QR with your phone camera, or type the code on their screen.</div>
      </div>

      <div className="flex flex-col gap-[14px]">
        <form className="field" action="/admin/redeem" method="get">
          <label htmlFor="code">Redemption code</label>
          <div className="flex gap-2">
            <input
              id="code"
              name="code"
              defaultValue={reward ? reward.redemptionCode : code}
              placeholder="GLW-7F3K-25"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="input font-[family-name:var(--font-heading)] font-extrabold text-[20px] tracking-[.08em] min-h-[48px] uppercase"
            />
            <button type="submit" className="btn btn-secondary min-h-[48px] flex-none">Look up</button>
          </div>
        </form>
        <div className="border-2 border-[var(--color-divider)] p-4 text-[13px] text-muted leading-relaxed">
          Every reward's QR code opens this page with its code filled in. Point your phone camera at the guest's screen, open the link, and confirm here.
        </div>
        {recent.length > 0 && (
          <div className="text-muted text-[12px]">
            Recent: {recent.map((r) => `${r.code} redeemed ${fmtTime(r.redeemedAt)}`).join(" · ")}
          </div>
        )}
      </div>

      <div className="stat-grid grid-cols-1 self-start">
        {!normalized && (
          <div className="stat-tile on-surface text-muted text-[13px]">Enter or scan a code to see the reward and guest.</div>
        )}
        {normalized && !reward && (
          <div className="stat-tile on-surface">
            <div className="card-kicker">No match</div>
            <div className="font-[family-name:var(--font-heading)] font-extrabold text-[20px] mt-1">No reward matches {normalized}</div>
            <div className="text-muted text-[13px] mt-1">Check the code on the guest's screen — letters O and I are never used.</div>
          </div>
        )}
        {reward && (
          <>
            <div className="stat-tile on-surface flex justify-between items-start gap-4">
              <div>
                <div className="card-kicker">{reward.campaignName} · Code found</div>
                <div className="font-[family-name:var(--font-heading)] font-extrabold text-[28px] mt-[6px]">{reward.title}</div>
                <div className="text-muted text-[13px] mt-1">
                  {reward.description ? `${reward.description} ` : ""}Retail value {formatDollars(reward.retailValueCents)}.
                </div>
              </div>
              <span className={reward.status === "available" ? "tag tag-accent" : reward.status === "redeemed" ? "tag tag-neutral" : "tag tag-outline"}>
                {reward.status === "redeemed" ? `Redeemed · ${fmt(reward.redeemedAt)}` : reward.status[0].toUpperCase() + reward.status.slice(1)}
              </span>
            </div>
            <div className="stat-tile on-surface grid grid-cols-3 gap-4 text-[14px]">
              <div>
                <div className="stat-label">Guest</div>
                <div className="font-semibold">
                  <Link href={`/admin/customers/${reward.customer.id}`} className="text-inherit no-underline hover:underline">{guest}</Link>
                </div>
                <div className="text-muted text-[13px]">{formatPhone(reward.customer.phone) || "—"}</div>
              </div>
              <div>
                <div className="stat-label">Expires</div>
                <div className="font-semibold">{fmt(reward.expiresAt)}</div>
                <div className="text-muted text-[13px]">{daysLeft == null ? "No expiry" : daysLeft > 0 ? `${daysLeft} days left` : "Expired"}</div>
              </div>
              <div>
                <div className="stat-label">Card</div>
                <div className="font-semibold">No. {reward.card.displayNumber}</div>
                <div className="text-muted text-[13px]">Scratched {fmt(reward.card.revealedAt)}</div>
              </div>
            </div>
            <div className="stat-tile on-surface flex flex-col gap-[14px]">
              {done === "1" && reward.status === "redeemed" ? (
                <div role="status" className="border-l-2 border-[var(--color-text)] pl-3 text-[14px]">
                  <span className="font-semibold">Redeemed.</span> {reward.title} for {guest} is marked used and logged to their history.
                </div>
              ) : reward.status === "available" ? (
                <form action={confirmRedemption} className="flex flex-col gap-[14px]">
                  <input type="hidden" name="code" value={reward.redemptionCode} />
                  {error && <div role="alert" className="border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-100)] text-[var(--color-accent-800)] px-3 py-2 text-[13px]">{error}</div>}
                  <div className="flex gap-2">
                    <button type="submit" className="btn btn-primary min-h-[44px] px-5">Confirm redemption</button>
                    <Link href="/admin/redeem" className="btn btn-secondary min-h-[44px]">Cancel</Link>
                  </div>
                  <div className="text-muted text-[12px]">Marks the reward Redeemed and logs you and today's date to the guest's history. Cannot be undone.</div>
                </form>
              ) : (
                <div className="text-[13px] text-muted">
                  {reward.status === "redeemed" ? `This reward was already redeemed on ${fmt(reward.redeemedAt)}.` : `This reward is ${reward.status} and can't be redeemed.`}
                  {error && <div role="alert" className="mt-2 text-[var(--color-accent-700)]">{error}</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
