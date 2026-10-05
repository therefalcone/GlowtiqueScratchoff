"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/CopyButton";
import { regenerateWalletLink } from "../actions";

export function WalletLinkActions({ customerId, walletUrl }: { customerId: string; walletUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const regenerate = () => {
    if (!window.confirm("Replace this customer's wallet link? The old link stops working immediately and you'll need to share the new one.")) return;
    setError(null);
    startTransition(async () => {
      const res = await regenerateWalletLink(customerId);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CopyButton text={walletUrl} label="Copy wallet link" copiedLabel="Copied" />
      <button type="button" className="btn btn-ghost text-[var(--color-text)]" onClick={regenerate} disabled={pending}>
        {pending ? "Regenerating…" : "Regenerate link"}
      </button>
      {error && <span role="alert" className="text-[12px] text-[var(--color-accent-700)]">{error}</span>}
    </div>
  );
}
