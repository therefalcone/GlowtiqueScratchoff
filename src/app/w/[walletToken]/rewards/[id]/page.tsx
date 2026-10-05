import type { Metadata } from "next";
import Link from "next/link";
import { formatDollars } from "@/lib/pool-math";
import { getWalletReward } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";
import { qrSvg } from "@/lib/server/qr";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { getAppUrl, getClientIp } from "@/lib/server/request";
import { fmtDate, StatusChip, WalletFrame, WalletNotFound } from "../../ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reward · Glowtique", robots: { index: false, follow: false } };

export default async function RewardDetailPage({ params }: { params: Promise<{ walletToken: string; id: string }> }) {
  const { walletToken, id } = await params;
  const pool = getPool();
  const limit = await checkRateLimit(pool, { key: `wallet:${await getClientIp()}`, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) return <WalletNotFound />;

  const reward = await getWalletReward(pool, walletToken, id);
  if (!reward) return <WalletNotFound />;

  const appUrl = await getAppUrl();
  // The QR opens the staff redeem screen with the code filled in, so any phone camera "scans" it.
  const qr = reward.status === "available" ? await qrSvg(`${appUrl}/admin/redeem?code=${reward.redemptionCode}`) : null;
  const bookingUrl = process.env.NEXT_PUBLIC_BOOKING_URL || null;
  const who = [reward.customerFirstName, reward.customerLastName ? `${reward.customerLastName[0]}.` : null].filter(Boolean).join(" ");

  return (
    <WalletFrame
      right={<StatusChip status={reward.status} />}
    >
      <div className="px-6 pt-4">
        <Link href={`/w/${walletToken}`} className="inline-flex items-center gap-[6px] text-[13px] font-semibold text-card-ink no-underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          My Rewards
        </Link>
      </div>
      <div className="px-6 pt-4">
        <div className="text-[11px] tracking-[.12em] uppercase text-gold font-semibold">{reward.campaignName} · Reward</div>
        <h1 className="font-heading font-extrabold text-[32px] leading-[1.05] mt-2 tracking-[-.02em] text-pretty">{reward.title}</h1>
        <p className="mt-[10px] text-[14px] text-card-muted">
          {reward.status === "available"
            ? "Show this screen at the front desk. We'll apply it before you pay."
            : reward.status === "redeemed"
              ? `Redeemed ${fmtDate(reward.redeemedAt) ?? ""} at Glowtique.`
              : `This reward expired ${fmtDate(reward.expiresAt) ?? ""}.`}
        </p>
      </div>

      <div className="mx-6 mt-5 border-2 border-card-ink bg-cream-panel grid grid-cols-[1fr_auto]">
        <div className="p-[18px] flex flex-col justify-between border-r border-gold-rule min-w-0">
          <div>
            <div className="text-[11px] tracking-[.1em] uppercase text-card-soft">Redemption code</div>
            <div className="font-heading font-extrabold text-[20px] tracking-[.08em] mt-[6px] whitespace-nowrap">{reward.redemptionCode}</div>
          </div>
          <div className="text-[12px] text-card-soft mt-4">
            {who ? `${who} · ` : ""}Card no. {reward.cardDisplayNumber}
          </div>
        </div>
        <div className="p-[14px] flex items-center justify-center">
          {qr ? (
            <div className="w-[105px] h-[105px] bg-white p-[6px] border border-gold-rule [&>svg]:w-full [&>svg]:h-full" role="img" aria-label="QR code for this reward" dangerouslySetInnerHTML={{ __html: qr }} />
          ) : (
            <div className="w-[105px] h-[105px] border border-gold-rule flex items-center justify-center text-[11px] text-[#a89a80] text-center px-2">
              {reward.status === "redeemed" ? "Already used" : "No longer valid"}
            </div>
          )}
        </div>
      </div>

      <dl className="px-6 pt-5 text-[13px] m-0">
        <div className="flex justify-between py-[10px] border-t border-gold-rule"><dt className="text-card-soft">Expires</dt><dd className="font-semibold m-0">{fmtDate(reward.expiresAt) ?? "No expiry"}</dd></div>
        <div className="flex justify-between py-[10px] border-t border-gold-rule"><dt className="text-card-soft">Retail value</dt><dd className="font-semibold m-0">{formatDollars(reward.retailValueCents)}</dd></div>
        <div className="flex justify-between py-[10px] border-t border-gold-rule border-b-2 border-b-card-ink"><dt className="text-card-soft">Redeem at</dt><dd className="font-semibold m-0">Glowtique, Naples</dd></div>
      </dl>

      {(reward.terms || reward.description) && (
        <p className="px-6 pt-4 text-[11px] text-card-soft leading-[1.5] text-pretty">
          {reward.description && <>{reward.description} </>}
          {reward.terms && (
            <>
              <span className="font-semibold text-card-ink">Terms.</span> {reward.terms}
            </>
          )}
        </p>
      )}

      <div className="mt-auto px-6 pb-7 pt-6 flex flex-col gap-2">
        {bookingUrl && (
          <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="block bg-card-ink text-cream px-4 py-[14px] text-[15px] font-heading font-extrabold no-underline">
            Book now
          </a>
        )}
      </div>
    </WalletFrame>
  );
}
