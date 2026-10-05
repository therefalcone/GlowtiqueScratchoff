import { describe, expect, it } from "vitest";
import {
  PRIZE_WARNING_CENTS,
  formatDollars,
  summarizePool,
  validatePool,
  type PoolRow,
} from "@/lib/pool-math";

const row = (p: Partial<PoolRow> & { title: string }): PoolRow => ({
  retailValueCents: 0,
  weight: null,
  quantityTotal: null,
  ...p,
});

describe("summarizePool", () => {
  it("normalizes weights to odds and distributes the planned card count", () => {
    const s = summarizePool(
      "weighted",
      [
        row({ title: "A", weight: 40, retailValueCents: 2500 }),
        row({ title: "B", weight: 30, retailValueCents: 2800 }),
        row({ title: "C", weight: 30, retailValueCents: 0 }),
      ],
      500
    );
    expect(s.odds.map((o) => +o.toFixed(3))).toEqual([0.4, 0.3, 0.3]);
    expect(s.cards).toEqual([200, 150, 150]);
    expect(s.totalCards).toBe(500);
    expect(s.totalPrizeCents).toBe(200 * 2500 + 150 * 2800);
    expect(s.avgPrizeCents).toBe(Math.round((200 * 2500 + 150 * 2800) / 500));
    expect(s.denominator).toBe(100);
  });

  it("weights are relative, not percentages", () => {
    const s = summarizePool("weighted", [row({ title: "A", weight: 3 }), row({ title: "B", weight: 1 })], 100);
    expect(s.odds).toEqual([0.75, 0.25]);
    expect(s.denominator).toBe(4);
  });

  it("fixed pool: total cards is the sum of quantities", () => {
    const s = summarizePool(
      "fixed_pool",
      [row({ title: "A", quantityTotal: 99, retailValueCents: 100 }), row({ title: "B", quantityTotal: 1, retailValueCents: 10000 })],
      999 // ignored in fixed mode
    );
    expect(s.totalCards).toBe(100);
    expect(s.odds).toEqual([0.99, 0.01]);
    expect(s.cards).toEqual([99, 1]);
    expect(s.totalPrizeCents).toBe(99 * 100 + 10000);
  });

  it("flags total prize value above $5,000", () => {
    const under = summarizePool("fixed_pool", [row({ title: "A", quantityTotal: 50, retailValueCents: 10000 })], 0);
    expect(under.totalPrizeCents).toBe(PRIZE_WARNING_CENTS);
    expect(under.overPrizeWarning).toBe(false);
    const over = summarizePool("fixed_pool", [row({ title: "A", quantityTotal: 51, retailValueCents: 10000 })], 0);
    expect(over.overPrizeWarning).toBe(true);
  });

  it("handles empty and garbage input without NaN", () => {
    const s = summarizePool("weighted", [], 0);
    expect(s).toMatchObject({ totalCards: 0, totalPrizeCents: 0, avgPrizeCents: 0, odds: [], cards: [] });
    const g = summarizePool("weighted", [row({ title: "A", weight: NaN })], NaN);
    expect(g.odds).toEqual([0]);
    expect(g.totalCards).toBe(0);
  });
});

describe("validatePool", () => {
  it("accepts a valid weighted pool and a single guaranteed gift", () => {
    expect(validatePool("weighted", [row({ title: "A", weight: 1 })])).toBeNull();
    expect(validatePool("fixed_pool", [row({ title: "A", quantityTotal: 1 })])).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(validatePool("weighted", [])).toMatch(/at least one reward/);
    expect(validatePool("weighted", [row({ title: " ", weight: 1 })])).toMatch(/needs a name/);
    expect(validatePool("weighted", [row({ title: "A", weight: 0 })])).toMatch(/positive whole-number weight/);
    expect(validatePool("weighted", [row({ title: "A", weight: null })])).toMatch(/weight/);
    expect(validatePool("fixed_pool", [row({ title: "A", quantityTotal: null })])).toMatch(/quantity/);
    expect(validatePool("fixed_pool", [row({ title: "A", quantityTotal: 0 })])).toMatch(/at least one card/);
  });
});

describe("formatDollars", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(250000)).toBe("$2,500");
    expect(formatDollars(1999)).toBe("$19.99");
  });
});
