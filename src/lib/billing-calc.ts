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

export type FixedSplitMode =
  | "quantity"
  | "percent"
  | "per_sqm"
  | "headcount"
  | "equal"
  | "direct";

/**
 * The split types offered when adding a fixed line item, in dropdown order.
 *
 * Everything below "quantity" divides ONE total: `unitAmount` is the whole
 * cost and each company's allocation is a percentage of it. Only "percent" is
 * typed in by hand — the rest are worked out from Controls every time they are
 * read, so a company that grows, shrinks or moves desks re-splits itself with
 * nobody editing the item.
 */
export const FIXED_SPLIT_MODES: {
  key: FixedSplitMode;
  label: string;
  hint: string;
  /** True when the shares are recomputed rather than typed in. */
  derived: boolean;
}[] = [
  {
    key: "quantity",
    label: "Quantity per line",
    hint: "A price each — e.g. 13 parking bays at R400.",
    derived: false,
  },
  {
    key: "percent",
    label: "Percentage split (fixed %)",
    hint: "One total, divided by a percentage you type per company.",
    derived: false,
  },
  {
    key: "per_sqm",
    label: "Per square metre",
    hint: "One total, divided by effective floor space. Recalculates itself.",
    derived: true,
  },
  {
    key: "headcount",
    label: "Per head",
    hint: "One total, divided by billable headcount. Recalculates itself.",
    derived: true,
  },
  {
    key: "equal",
    label: "Split equally",
    hint: "One total, divided evenly between the companies you tick.",
    derived: true,
  },
  {
    key: "direct",
    label: "Direct to one sub-company",
    hint: "One total, carried entirely by a single company.",
    derived: true,
  },
];

/** Every mode except "quantity" treats `unitAmount` as the whole cost. */
export function isPercentShaped(mode: FixedSplitMode): boolean {
  return mode !== "quantity";
}

/** True when the per-company shares are worked out, not typed in. */
export function isDerivedMode(mode: FixedSplitMode): boolean {
  return FIXED_SPLIT_MODES.find((m) => m.key === mode)?.derived ?? false;
}

/** The dropdown label for a mode, for screens that only show the answer. */
export function fixedSplitModeLabel(mode: FixedSplitMode): string {
  return FIXED_SPLIT_MODES.find((m) => m.key === mode)?.label ?? mode;
}

/** What each company is measured on, for the modes that measure something. */
export type FixedSplitBasis = {
  area: Record<number, number>;
  headcount: Record<number, number>;
};

/**
 * The percentage each company takes of a derived-mode item.
 *
 * Only the companies passed in take part, so "per head across Marketing and
 * iRam only" is expressible — the shares are of that subset, not of the whole
 * building. Returns nothing when the basis is all zeros (no floor space set,
 * no billable staff), which callers treat as "bills nothing" rather than
 * dividing by zero.
 */
export function deriveFixedShares(
  mode: FixedSplitMode,
  companyIds: number[],
  basis: FixedSplitBasis,
): Record<number, number> {
  const out: Record<number, number> = {};
  if (companyIds.length === 0) return out;

  switch (mode) {
    case "per_sqm":
    case "headcount": {
      const measure = (id: number) =>
        Math.max(0, (mode === "per_sqm" ? basis.area[id] : basis.headcount[id]) ?? 0);
      const total = companyIds.reduce((s, id) => s + measure(id), 0);
      if (total <= 0) return out;
      for (const id of companyIds) out[id] = (measure(id) / total) * 100;
      return out;
    }
    case "equal": {
      const share = 100 / companyIds.length;
      for (const id of companyIds) out[id] = share;
      return out;
    }
    case "direct": {
      // One company carries the lot. More than one ticked shouldn't happen —
      // the form enforces it — so take the first rather than quietly sharing.
      out[companyIds[0]] = 100;
      return out;
    }
    default:
      return out;
  }
}

/**
 * What one company pays towards a fixed line item. In quantity mode the
 * allocation is a number of units at `unitAmount` each; in every other mode
 * `unitAmount` is the whole cost and the allocation is a percentage of it.
 */
export function fixedAllocationAmount(
  item: { splitMode: FixedSplitMode; unitAmount: number },
  allocation: number,
): number {
  const value = isPercentShaped(item.splitMode)
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
  if (!isPercentShaped(mode)) return `×${allocation}`;
  // Derived shares land on long decimals; one place is enough to read.
  return `${Math.round(allocation * 10) / 10}%`;
}

/** A company's slice of the monthly rent, from its effective floor area. */
export function rentShare(effectiveArea: number, totalSqm: number, rentAmount: number): number {
  if (totalSqm <= 0 || rentAmount <= 0) return 0;
  return (effectiveArea / totalSqm) * rentAmount;
}
