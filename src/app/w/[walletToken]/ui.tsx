import type { ReactNode } from "react";

export const BUSINESS = "Glowtique Salon & MedSpa";

export function fmtDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function WalletFrame({ right, children }: { right: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-cream text-card-ink">
      <div className="mx-auto max-w-[430px] min-h-dvh flex flex-col">
        <header className="pt-7 px-6 flex justify-between items-center">
          <span className="font-heading font-extrabold text-[16px] tracking-[.14em]">GLOWTIQUE</span>
          <span className="text-[11px] tracking-[.08em] uppercase text-card-soft">{right}</span>
        </header>
        <div className="h-[2px] bg-card-ink mx-6 mt-4" />
        {children}
      </div>
    </main>
  );
}

const CHIP: Record<string, string> = {
  available: "bg-card-ink text-cream",
  redeemed: "bg-gold-line text-card-muted",
  expired: "text-[#a89a80]",
  void: "text-[#a89a80]",
};
const CHIP_LABEL: Record<string, string> = { available: "Available", redeemed: "Redeemed", expired: "Expired", void: "Cancelled" };

export function StatusChip({ status }: { status: string }) {
  return <span className={`text-[11px] tracking-[.04em] px-2 py-[3px] flex-none ${CHIP[status] ?? ""}`}>{CHIP_LABEL[status] ?? status}</span>;
}

export function Swatch({ status }: { status: string }) {
  const bg =
    status === "available"
      ? "linear-gradient(135deg,#a97a25,#fbeab8 45%,#c7992f)"
      : status === "redeemed"
        ? "#1f1a14"
        : "repeating-linear-gradient(135deg,#d8ccb0 0 2px,transparent 2px 6px)";
  return <div className="w-11 h-11 flex-none" style={{ background: bg }} aria-hidden="true" />;
}

export function WalletNotFound() {
  return (
    <WalletFrame right="Naples, FL">
      <div className="px-6 pt-6">
        <div className="text-[11px] tracking-[.12em] uppercase text-gold font-semibold">Hmm</div>
        <h1 className="font-heading font-extrabold text-[30px] leading-[1.05] mt-2 tracking-[-.02em]">We can't find that wallet</h1>
        <p className="mt-3 text-[14px] text-card-muted">
          The link may be incomplete, or it was replaced. Ask the front desk to send you a fresh rewards link.
        </p>
      </div>
      <footer className="mt-auto px-6 pb-7 pt-6 text-[12px] text-card-soft">{BUSINESS}</footer>
    </WalletFrame>
  );
}
