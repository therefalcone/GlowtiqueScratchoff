"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/links", label: "Generate links" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/redeem", label: "Redeem" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Admin">
      {ITEMS.map((item) => {
        const current = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={
              "no-underline text-[14px] px-[10px] py-2 text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] " +
              (current ? "bg-[var(--color-surface)] font-semibold" : "")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
