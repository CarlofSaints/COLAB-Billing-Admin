import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, staff } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { CompaniesManager } from "./companies-client";

export const metadata = { title: "Sub-Companies — COLAB" };

export default async function CompaniesPage() {
  await requirePermission("companies.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "companies.manage") : false;

  const rows = await db
    .select()
    .from(companies)
    .where(eq(companies.type, "sub"))
    .orderBy(asc(companies.name));

  const counts = await db
    .select({ companyId: staff.companyId, count: sql<number>`count(*)::int` })
    .from(staff)
    .where(eq(staff.active, true))
    .groupBy(staff.companyId);

  const countMap = new Map(counts.map((c) => [c.companyId, c.count]));

  const data = rows.map((c) => ({
    id: c.id,
    name: c.name,
    regNumber: c.regNumber ?? "",
    vatNumber: c.vatNumber ?? "",
    registeredAddress: c.registeredAddress ?? "",
    contactName: c.contactName ?? "",
    contactEmail: c.contactEmail ?? "",
    contactPhone: c.contactPhone ?? "",
    notes: c.notes ?? "",
    active: c.active,
    staffCount: countMap.get(c.id) ?? 0,
  }));

  return (
    <div>
      <PageHeader
        title="Sub-Companies"
        description="The businesses billed by COLAB. These surface in the billing controls."
      />
      <CompaniesManager companies={data} canManage={canManage} />
    </div>
  );
}
