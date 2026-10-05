/**
 * Pure helpers shared by the pool editor (client) and the server: normalized
 * odds, card counts, and prize totals. Weighted mode distributes a planned
 * card count by weight; fixed mode uses exact quantities.
 */

export type CampaignMode = "weighted" | "fixed_pool";

export interface PoolRow {
  title: string;
  retailValueCents: number;
  weight: number | null;
  quantityTotal: number | null;
}

export interface PoolSummary {
  totalCards: number;
  totalPrizeCents: number;
  avgPrizeCents: number;
  /** 0–1 per row, in row order. */
  odds: number[];
  /** Cards each reward accounts for (expected, in weighted mode). */
  cards: number[];
  /** Sum of weights (weighted) or quantities (fixed). */
  denominator: number;
  overPrizeWarning: boolean;
}

/** Spec: show a visible warning when total prize value exceeds $5,000. */
export const PRIZE_WARNING_CENTS = 500_000;

function toNonNegativeInt(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function summarizePool(
  mode: CampaignMode,
  rows: PoolRow[],
  plannedCards: number
): PoolSummary {
  const amounts = rows.map((r) =>
    toNonNegativeInt(mode === "weighted" ? r.weight : r.quantityTotal)
  );
  const denominator = amounts.reduce((a, n) => a + n, 0);
  const totalCards =
    mode === "weighted" ? toNonNegativeInt(plannedCards) : denominator;

  const odds = amounts.map((n) => (denominator ? n / denominator : 0));
  const cards =
    mode === "weighted"
      ? odds.map((o) => Math.round(o * totalCards))
      : amounts;

  const totalPrizeCents = rows.reduce(
    (sum, r, i) => sum + cards[i] * toNonNegativeInt(r.retailValueCents),
    0
  );
  const avgPrizeCents = totalCards ? Math.round(totalPrizeCents / totalCards) : 0;

  return {
    totalCards,
    totalPrizeCents,
    avgPrizeCents,
    odds,
    cards,
    denominator,
    overPrizeWarning: totalPrizeCents > PRIZE_WARNING_CENTS,
  };
}

export function formatPercent(fraction: number): string {
  return (fraction * 100).toFixed(1) + "%";
}

export function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return (
    "$" +
    (Number.isInteger(dollars)
      ? dollars.toLocaleString("en-US")
      : dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  );
}

/**
 * Validates a pool for activation. Returns an error message or null.
 */
export function validatePool(mode: CampaignMode, rows: PoolRow[]): string | null {
  if (rows.length === 0) return "Add at least one reward.";
  for (const r of rows) {
    if (!r.title.trim()) return "Every reward needs a name.";
    if (!Number.isInteger(r.retailValueCents) || r.retailValueCents < 0) {
      return `"${r.title}" needs a retail value of $0 or more.`;
    }
    if (mode === "weighted") {
      if (!Number.isInteger(r.weight) || (r.weight as number) <= 0) {
        return `"${r.title}" needs a positive whole-number weight.`;
      }
    } else if (!Number.isInteger(r.quantityTotal) || (r.quantityTotal as number) < 0) {
      return `"${r.title}" needs a quantity of 0 or more.`;
    }
  }
  if (mode === "fixed_pool" && rows.every((r) => (r.quantityTotal ?? 0) === 0)) {
    return "A fixed pool needs at least one card.";
  }
  return null;
}
