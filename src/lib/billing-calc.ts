/**
 * Shared floor-space maths. Both the Controls screen and the dashboard bill
 * off these numbers, so the calculation lives here rather than being written
 * twice and drifting apart.
 *
 * Pure functions, no server imports — safe on either side.
 */

export type CommonSpaceInput = {
  sqm: number;
  splitMethod: "occupancy" | "custom";
  splits: { companyId: number; percent: number }[];
};

export type EffectiveAreas = {
  effective: Record<number, number>;
  totalOccupied: number;
  common: number;
  itemised: number;
  unallocatedCommon: number;
};

/**
 * How much floor area each company effectively pays for: its own occupied
 * space, plus its share of every itemised common space, plus its pro-rata
 * share of any common area not itemised into a line.
 */
export function computeEffectiveAreas(
  companies: { id: number }[],
  occupied: Record<number, number>,
  commonSpaces: CommonSpaceInput[],
  totalSqm: number,
): EffectiveAreas {
  const occ = (id: number) => Math.max(0, occupied[id] || 0);
  const totalOccupied = companies.reduce((s, c) => s + occ(c.id), 0);
  const occFraction = (id: number) => (totalOccupied > 0 ? occ(id) / totalOccupied : 0);

  const common = Math.max(0, totalSqm - totalOccupied);
  const itemised = commonSpaces.reduce((s, cs) => s + Math.max(0, cs.sqm), 0);
  const unallocatedCommon = Math.max(0, common - itemised);

  const effective: Record<number, number> = {};
  for (const c of companies) {
    let area = occ(c.id);
    for (const cs of commonSpaces) {
      if (cs.splitMethod === "custom") {
        const pct = cs.splits.find((s) => s.companyId === c.id)?.percent ?? 0;
        area += (pct / 100) * cs.sqm;
      } else {
        area += occFraction(c.id) * cs.sqm;
      }
    }
    area += occFraction(c.id) * unallocatedCommon;
    effective[c.id] = area;
  }

  return { effective, totalOccupied, common, itemised, unallocatedCommon };
}

/* ------------------------------------------------------------------ */
/* Fixed line items                                                    */
/* ------------------------------------------------------------------ */

export type FixedSplitMode = "quantity" | "percent";

/**
 * What one company pays towards a fixed line item. In quantity mode the
 * allocation is a number of units at `unitAmount` each; in percent mode
 * `unitAmount` is the whole cost and the allocation is a percentage of it.
 */
export function fixedAllocationAmount(
  item: { splitMode: FixedSplitMode; unitAmount: number },
  allocation: number,
): number {
  const value =
    item.splitMode === "percent"
      ? item.unitAmount * (allocation / 100)
      : allocation * item.unitAmount;
  return Math.round(value * 100) / 100;
}

/** What the item recovers in total across every company assigned to it. */
export function fixedItemTotal(
  item: { splitMode: FixedSplitMode; unitAmount: number },
  allocations: number[],
): number {
  return Math.round(
    allocations.reduce((s, a) => s + fixedAllocationAmount(item, a), 0) * 100,
  ) / 100;
}

/** How an allocation reads next to the company name, e.g. "×3" or "25%". */
export function fixedAllocationLabel(mode: FixedSplitMode, allocation: number): string {
  return mode === "percent" ? `${allocation}%` : `×${allocation}`;
}

/** A company's slice of the monthly rent, from its effective floor area. */
export function rentShare(effectiveArea: number, totalSqm: number, rentAmount: number): number {
  if (totalSqm <= 0 || rentAmount <= 0) return 0;
  return (effectiveArea / totalSqm) * rentAmount;
}
