import "server-only";
/**
 * The numbers every split is measured against: effective floor area per
 * sub-company, and billable headcount per sub-company.
 *
 * This used to live privately inside `invoice-engine.ts`. Fixed line items can
 * now be split per m² or per head as well, and those shares have to come out
 * identical to the ones the month-end run uses — two copies of this maths
 * would drift and nobody would notice until an invoice disagreed with the
 * preview. So it lives here once and both sides read it.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  commonSpaces,
  commonSpaceSplits,
  companies,
  companyAllocations,
  staff,
} from "@/db/schema";
import { computeEffectiveAreas } from "./billing-calc";
import { RENT_AMOUNT_KEY, TOTAL_SQM_KEY } from "./controls";

export type SplitBasis = {
  /** Effective floor area per company — occupied plus its share of common. */
  area: Record<number, number>;
  totalSqm: number;
  /** Billable head per company: the manual override, else the live count. */
  headcount: Record<number, number>;
  totalHeadcount: number;
  companyIds: number[];
};

export type BasisCompany = {
  id: number;
  name: string;
  xeroContactId: string | null;
  xeroContactName: string | null;
};

/** Everything the split maths needs, loaded once per preview. */
export async function loadSplitBasis(): Promise<{
  basis: SplitBasis;
  companyRows: BasisCompany[];
  totalSqm: number;
  rentAmount: number;
}> {
  const companyRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      xeroContactId: companies.xeroContactId,
      xeroContactName: companies.xeroContactName,
    })
    .from(companies)
    .where(and(eq(companies.type, "sub"), eq(companies.active, true)))
    .orderBy(asc(companies.name));

  const allocs = await db.select().from(companyAllocations);
  const settings = await db.select().from(appSettings);
  const setting = (key: string) => {
    const row = settings.find((s) => s.key === key);
    return row?.value ? Number(row.value) : 0;
  };
  const totalSqm = setting(TOTAL_SQM_KEY);
  const rentAmount = setting(RENT_AMOUNT_KEY);

  const spaceRows = await db.select().from(commonSpaces).where(eq(commonSpaces.active, true));
  const splitRows = await db.select().from(commonSpaceSplits);

  const { effective } = computeEffectiveAreas(
    companyRows,
    Object.fromEntries(
      companyRows.map((c) => [
        c.id,
        Number(allocs.find((a) => a.companyId === c.id)?.squareMetres ?? 0),
      ]),
    ),
    spaceRows.map((s) => ({
      sqm: Number(s.squareMetres),
      splitMethod: s.splitMethod as "occupancy" | "custom",
      splits: splitRows
        .filter((sp) => sp.commonSpaceId === s.id)
        .map((sp) => ({ companyId: sp.companyId, percent: Number(sp.percent) })),
    })),
    totalSqm,
  );

  // Only people flagged "Include in Billing" count towards the split.
  const counts = await db
    .select({ companyId: staff.companyId, count: sql<number>`count(*)::int` })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.includeInBilling, true)))
    .groupBy(staff.companyId);

  const headcount: Record<number, number> = {};
  for (const c of companyRows) {
    const override = allocs.find((a) => a.companyId === c.id)?.headcountOverride;
    headcount[c.id] = override ?? counts.find((x) => x.companyId === c.id)?.count ?? 0;
  }

  return {
    basis: {
      area: effective,
      totalSqm,
      headcount,
      totalHeadcount: Object.values(headcount).reduce((s, n) => s + n, 0),
      companyIds: companyRows.map((c) => c.id),
    },
    companyRows,
    totalSqm,
    rentAmount,
  };
}
