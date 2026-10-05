"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { voidCardAction } from "./actions";

export interface LinkRow {
  id: string;
  url: string;
  label: string | null;
  status: "created" | "opened" | "revealed" | "expired" | "void";
  createdAt: string;
  /** inline SVG markup from the server */
  qr: string;
}

const STATUS: Record<LinkRow["status"], { label: string; cls: string }> = {
  created: { label: "Unscratched", cls: "tag tag-neutral" },
  opened: { label: "Opened", cls: "tag tag-neutral" },
  revealed: { label: "Scratched", cls: "tag tag-accent" },
  expired: { label: "Expired", cls: "tag tag-neutral" },
  void: { label: "Void", cls: "tag tag-outline" },
};

export function LinksTable({
  batchId,
  batchLabel,
  campaignName,
  rows,
}: {
  batchId: string;
  batchLabel: string | null;
  campaignName: string;
  rows: LinkRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onVoid = (row: LinkRow) => {
    if (!window.confirm("Void this card? The link will stop working. This can't be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await voidCardAction(row.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex justify-between items-center gap-4">
        <div className="font-[family-name:var(--font-heading)] font-extrabold text-[16px]">
          {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "link" : "links"} generated{" "}
          <span className="text-muted font-normal text-[13px]">
            · {campaignName}
            {batchLabel ? ` · ${batchLabel}` : ""}
          </span>
        </div>
        <div className="flex gap-2">
          <CopyButton text={rows.map((r) => r.url).join("\n")} label="Copy all" copiedLabel="Copied all" icon={false} />
          <a href={`/api/admin/batches/${batchId}/csv`} className="btn btn-primary" download>
            Download CSV
          </a>
        </div>
      </div>
      {error && (
        <div role="alert" className="border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-100)] text-[var(--color-accent-800)] px-3 py-2 text-[13px]">
          {error}
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Link</th>
            <th>Label</th>
            <th>QR</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = STATUS[r.status];
            return (
              <tr key={r.id}>
                <td className="text-muted">{i + 1}</td>
                <td className="font-semibold break-all">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-inherit no-underline hover:underline">
                    {r.url.replace(/^https?:\/\//, "")}
                  </a>
                </td>
                <td className="text-muted">{r.label ?? "—"}</td>
                <td>
                  <div className="w-12 h-12 bg-white [&>svg]:w-full [&>svg]:h-full" aria-label="QR code for this link" role="img" dangerouslySetInnerHTML={{ __html: r.qr }} />
                </td>
                <td>
                  <span className={s.cls}>{s.label}</span>
                </td>
                <td className="text-right whitespace-nowrap">
                  <CopyButton text={r.url} className="btn btn-secondary gap-2" ariaLabel={`Copy link ${i + 1}`} />
                  {(r.status === "created" || r.status === "opened") && (
                    <button type="button" className="btn btn-ghost text-[var(--color-text)] ml-1" disabled={pending} onClick={() => onVoid(r)}>
                      Void
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
