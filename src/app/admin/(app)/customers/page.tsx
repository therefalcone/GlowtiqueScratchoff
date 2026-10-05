import Link from "next/link";
import { formatPhone } from "@/lib/phone";
import { searchCustomers } from "@/lib/server/customers";
import { getPool } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const customers = await searchCustomers(getPool(), q);

  return (
    <>
      <div className="flex items-end justify-between border-b-2 border-[var(--color-divider)] pb-4">
        <div>
          <h1 className="text-[32px]">Customers</h1>
          <div className="text-muted text-[13px]">Search by name, mobile, or email.</div>
        </div>
        <form className="flex gap-2 items-center" role="search">
          <input name="q" defaultValue={q} className="input w-[320px]" placeholder="Lena, (239) 555-0142, lena@…" aria-label="Search customers" />
          <button type="submit" className="btn btn-secondary">Search</button>
        </form>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Mobile</th>
            <th>Email</th>
            <th>Consent</th>
            <th className="text-right">Cards</th>
            <th className="text-right">Available</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {customers.length === 0 && (
            <tr>
              <td colSpan={7} className="text-muted">{q ? `No customers match “${q}”.` : "No customers yet. They appear here after claiming a card."}</td>
            </tr>
          )}
          {customers.map((c) => (
            <tr key={c.id}>
              <td className="font-semibold">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td>
              <td>{formatPhone(c.phone) || "—"}</td>
              <td className="text-muted">{c.email ?? "—"}</td>
              <td className="whitespace-nowrap">
                <span className={c.smsOptIn ? "tag tag-accent" : "tag tag-neutral"}>SMS {c.smsOptIn ? "✓" : "–"}</span>{" "}
                <span className={c.emailOptIn ? "tag tag-accent" : "tag tag-neutral"}>Email {c.emailOptIn ? "✓" : "–"}</span>
              </td>
              <td className="text-right">{c.cards}</td>
              <td className="text-right">{c.availableRewards}</td>
              <td className="text-right">
                <Link href={`/admin/customers/${c.id}`} className="btn btn-ghost">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
