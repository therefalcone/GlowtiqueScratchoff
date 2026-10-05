import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPhone } from "@/lib/phone";
import { getCustomerProfile } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";
import { getAppUrl } from "@/lib/server/request";
import { WalletLinkActions } from "./WalletLinkActions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

const REWARD_TAG: Record<string, string> = { available: "tag tag-accent", redeemed: "tag tag-neutral", expired: "tag tag-neutral", void: "tag tag-outline" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomerProfile(getPool(), id);
  if (!customer) notFound();
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer";
  const walletUrl = `${await getAppUrl()}/w/${customer.walletToken}`;

  return (
    <div className="grid grid-cols-[360px_1fr] gap-10 content-start">
      <div className="col-span-full flex items-end justify-between border-b-2 border-[var(--color-divider)] pb-4">
        <div>
          <div className="text-muted text-[12px]">
            <Link href="/admin/customers" className="text-inherit no-underline hover:underline">Customers</Link> / {name}
          </div>
          <h1 className="text-[32px]">{name}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/links" className="btn btn-primary">Issue a card</Link>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <section>
          <h6 className="mb-2">Contact</h6>
          <dl className="m-0 text-[14px]">
            <div className="flex justify-between py-2 border-t border-[var(--color-divider)]"><dt className="text-muted">Mobile</dt><dd className="m-0">{formatPhone(customer.phone) || "—"}</dd></div>
            <div className="flex justify-between py-2 border-t border-[var(--color-divider)]"><dt className="text-muted">Email</dt><dd className="m-0 break-all">{customer.email ?? "—"}</dd></div>
            <div className="flex justify-between py-2 border-t border-[var(--color-divider)] gap-4"><dt className="text-muted">Wallet</dt><dd className="m-0 break-all text-right">{walletUrl.replace(/^https?:\/\//, "")}</dd></div>
            <div className="flex justify-between py-2 border-t border-[var(--color-divider)] border-b-2"><dt className="text-muted">Customer since</dt><dd className="m-0">{fmt(customer.createdAt)}</dd></div>
          </dl>
          <div className="mt-3">
            <WalletLinkActions customerId={customer.id} walletUrl={walletUrl} />
          </div>
        </section>
        <section>
          <h6 className="mb-2">Consent</h6>
          <dl className="m-0 text-[14px]">
            <div className="flex justify-between items-center py-2 border-t border-[var(--color-divider)]">
              <dt>SMS marketing</dt>
              <dd className="m-0">{customer.smsOptIn ? <span className="tag tag-accent">Opted in · {fmt(customer.smsOptInAt)}</span> : <span className="tag tag-neutral">Not opted in</span>}</dd>
            </div>
            <div className="flex justify-between items-center py-2 border-t border-[var(--color-divider)] border-b-2">
              <dt>Email marketing</dt>
              <dd className="m-0">{customer.emailOptIn ? <span className="tag tag-accent">Opted in · {fmt(customer.emailOptInAt)}</span> : <span className="tag tag-neutral">Not opted in</span>}</dd>
            </div>
          </dl>
          <div className="text-muted text-[12px] mt-2">
            Consent captured via the card web form{customer.source ? ` (${customer.source})` : ""}; the audit log records the card and IP.
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-6 min-w-0">
        <section>
          <h6 className="mb-2">Card history</h6>
          <table className="table">
            <thead><tr><th>Card</th><th>Campaign</th><th>Issued</th><th>Scratched</th><th>Result</th></tr></thead>
            <tbody>
              {customer.cards.length === 0 && <tr><td colSpan={5} className="text-muted">No cards yet.</td></tr>}
              {customer.cards.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold">No. {c.displayNumber}</td>
                  <td>{c.campaignName}</td>
                  <td className="text-muted">{fmt(c.createdAt)}</td>
                  <td className="text-muted">{c.revealedAt ? fmt(c.revealedAt) : "—"}</td>
                  <td className={c.resultTitle ? "" : "text-muted"}>
                    {c.resultTitle ?? (c.status === "expired" ? "Expired unscratched" : c.status === "void" ? "Voided" : "Unscratched")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h6 className="mb-2">Rewards</h6>
          <table className="table">
            <thead><tr><th>Reward</th><th>Code</th><th>Status</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              {customer.rewards.length === 0 && <tr><td colSpan={5} className="text-muted">No rewards yet.</td></tr>}
              {customer.rewards.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.title}</td>
                  <td>{r.redemptionCode}</td>
                  <td>
                    <span className={REWARD_TAG[r.status]}>
                      {r.status === "redeemed" ? `Redeemed · ${fmt(r.redeemedAt)}` : r.status[0].toUpperCase() + r.status.slice(1)}
                    </span>
                  </td>
                  <td className="text-muted">{fmt(r.expiresAt)}</td>
                  <td className="text-right">
                    {r.status === "available" && (
                      <Link href={`/admin/redeem?code=${r.redemptionCode}`} className="btn btn-ghost">Redeem</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
