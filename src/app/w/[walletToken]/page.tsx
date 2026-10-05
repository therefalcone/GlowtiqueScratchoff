import type { Metadata } from "next";
import Link from "next/link";
import { getWallet, type WalletReward } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getAppUrl, getClientIp } from "@/lib/server/request";
import { BUSINESS, fmtDate, StatusChip, Swatch, WalletFrame, WalletNotFound } from "./ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My Rewards · Glowtique", robots: { index: false, follow: false } };

const FILTERS = ["All", "Available", "Redeemed", "Expired"] as const;
type Filter = (typeof FILTERS)[number];

function meta(r: WalletReward): string {
  if (r.status === "redeemed") return `Redeemed ${fmtDate(r.redeemedAt) ?? ""} at Glowtique`.trim();
  if (r.status === "expired") return `${r.campaignName} · Expired ${fmtDate(r.expiresAt) ?? ""}`.trim();
  const exp = fmtDate(r.expiresAt);
  return exp ? `${r.campaignName} · Expires ${exp}` : `${r.campaignName} · No expiry`;
}

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ walletToken: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { walletToken } = await params;
  const { f } = await searchParams;
  const pool = getPool();
  const limit = await checkRateLimit(pool, { key: `wallet:${await getClientIp()}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return <WalletNotFound />;

  const wallet = await getWallet(pool, walletToken);
  if (!wallet) return <WalletNotFound />;

  const filter: Filter = (FILTERS as readonly string[]).includes(f ?? "") ? (f as Filter) : "All";
  const rows = wallet.rewards.filter((r) => filter === "All" || r.status === filter.toLowerCase());
  const available = wallet.rewards.filter((r) => r.status === "available").length;
  const walletUrl = `${await getAppUrl()}/w/${walletToken}`;
  const bookingUrl = process.env.NEXT_PUBLIC_BOOKING_URL || null;

  return (
    <WalletFrame right={`${wallet.firstName ?? "My"} · Wallet`}>
      <div className="px-6 pt-6 flex justify-between items-end">
        <h1 className="font-heading font-extrabold text-[30px] leading-[1.05] tracking-[-.02em]">My Rewards</h1>
        <span className="text-[12px] text-card-soft">{available} available</span>
      </div>
      <nav className="px-6 pt-4 flex text-[12px]" aria-label="Filter rewards">
        {FILTERS.map((label, i) => {
          const active = filter === label;
          return (
            <Link
              key={label}
              href={label === "All" ? `/w/${walletToken}` : `/w/${walletToken}?f=${label}`}
              aria-current={active ? "page" : undefined}
              className={
                "border border-card-ink px-3 py-[7px] font-semibold no-underline " +
                (i === 0 ? "" : "border-l-0 ") +
                (active ? "bg-card-ink text-cream" : "text-card-ink")
              }
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <ul className="px-6 pt-5 list-none m-0 p-0">
        {rows.length === 0 && (
          <li className="border-t border-gold-rule py-4 text-[13px] text-card-muted">
            {wallet.rewards.length === 0 ? "No rewards yet. Scratch a card to add one." : `No ${filter.toLowerCase()} rewards.`}
          </li>
        )}
        {rows.map((r) => (
          <li key={r.id} className={"border-t border-gold-rule " + (r.status === "expired" ? "opacity-60" : "")}>
            <Link href={`/w/${walletToken}/rewards/${r.id}`} className="flex gap-[14px] items-start py-[14px] no-underline text-card-ink">
              <Swatch status={r.status} />
              <div className="flex-1 min-w-0">
                <div className="font-heading font-extrabold text-[16px] leading-[1.15]">{r.title}</div>
                <div className="text-[12px] text-card-soft mt-[3px]">{meta(r)}</div>
              </div>
              <StatusChip status={r.status} />
            </Link>
          </li>
        ))}
        <li className="border-t-2 border-card-ink" aria-hidden="true" />
      </ul>
      <div className="mt-auto px-6 pb-7 pt-6 flex flex-col gap-2">
        {bookingUrl && (
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="block bg-card-ink text-cream px-4 py-[14px] text-[15px] font-heading font-extrabold no-underline">
            Book now
          </a>
        )}
        <div className="text-[11px] text-card-soft break-all">
          Show any available reward at the front desk. {walletUrl.replace(/^https?:\/\//, "")}
        </div>
        <div className="text-[11px] text-card-soft">{BUSINESS}</div>
      </div>
    </WalletFrame>
  );
}
