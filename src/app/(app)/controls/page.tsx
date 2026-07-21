import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  companies,
  companyAllocations,
  fixedLineItems,
  fixedLineAllocations,
  staff,
  appSettings,
  commonSpaces,
  commonSpaceSplits,
} from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { TOTAL_SQM_KEY } from "@/lib/controls";
import { PageHeader } from "@/components/ui/page";
import { ControlsManager } from "./controls-client";

export const metadata = { title: "Controls — COLAB" };

export default async function ControlsPage() {
  await requirePermission("controls.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "controls.manage") : false;

  const subs = await db
    .select()
    .from(companies)
    .where(eq(companies.type, "sub"))
    .orderBy(asc(companies.name));

  const allocs = await db.select().from(companyAllocations);
  const allocMap = new Map(allocs.map((a) => [a.companyId, a]));

  const counts = await db
    .select({ companyId: staff.companyId, count: sql<number>`count(*)::int` })
    .from(staff)
    .where(eq(staff.active, true))
    .groupBy(staff.companyId);
  const countMap = new Map(counts.map((c) => [c.companyId, c.count]));

  const items = await db
    .select()
    .from(fixedLineItems)
    .where(eq(fixedLineItems.active, true))
    .orderBy(asc(fixedLineItems.name));
  const fixedAllocs = await db
    .select({
      itemId: fixedLineAllocations.fixedLineItemId,
      companyId: fixedLineAllocations.companyId,
      quantity: fixedLineAllocations.quantity,
      companyName: companies.name,
    })
    .from(fixedLineAllocations)
    .innerJoin(companies, eq(fixedLineAllocations.companyId, companies.id));

  const fixedData = items.map((it) => ({
    id: it.id,
    name: it.name,
    unitAmount: Number(it.unitAmount),
    notes: it.notes ?? "",
    allocations: fixedAllocs
      .filter((a) => a.itemId === it.id)
      .map((a) => ({
        companyId: a.companyId,
        companyName: a.companyName,
        quantity: Number(a.quantity),
      })),
  }));

  const totalSetting = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, TOTAL_SQM_KEY))
    .limit(1);
  const totalSqm = totalSetting[0]?.value ? Number(totalSetting[0].value) : 0;

  const spaceRows = await db
    .select()
    .from(commonSpaces)
    .where(eq(commonSpaces.active, true))
    .orderBy(asc(commonSpaces.name));
  const splitRows = await db.select().from(commonSpaceSplits);
  const spacesData = spaceRows.map((s) => ({
    id: s.id,
    name: s.name,
    sqm: Number(s.squareMetres),
    splitMethod: s.splitMethod as "occupancy" | "custom",
    splits: splitRows
      .filter((sp) => sp.commonSpaceId === s.id)
      .map((sp) => ({ companyId: sp.companyId, percent: Number(sp.percent) })),
  }));

  const data = subs.map((c) => {
    const alloc = allocMap.get(c.id);
    const live = countMap.get(c.id) ?? 0;
    const override = alloc?.headcountOverride ?? null;
    return {
      id: c.id,
      name: c.name,
      sqm: alloc ? Number(alloc.squareMetres) : 0,
      headcountOverride: override,
      liveHeadcount: live,
      effectiveHeadcount: override ?? live,
    };
  });

  return (
    <div>
      <PageHeader
        title="Billing Controls"
        description="Configure how each month's shared expenses are split across the sub-companies."
      />
      <ControlsManager
        companies={data}
        canManage={canManage}
        totalSqm={totalSqm}
        commonSpaces={spacesData}
        fixedItems={fixedData}
      />
    </div>
  );
}
