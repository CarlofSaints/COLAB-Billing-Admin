import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, companies } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { StaffManager } from "./staff-client";

export const metadata = { title: "Staff — COLAB" };

export default async function StaffPage() {
  await requirePermission("staff.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "staff.manage") : false;

  const companyRows = await db
    .select({ id: companies.id, name: companies.name, type: companies.type })
    .from(companies)
    .where(eq(companies.active, true))
    .orderBy(asc(companies.type), asc(companies.name));

  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      cellNumber: staff.cellNumber,
      email: staff.email,
      gender: staff.gender,
      position: staff.position,
      companyId: staff.companyId,
      active: staff.active,
      includeInBilling: staff.includeInBilling,
      companyName: companies.name,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .orderBy(asc(staff.name));

  const data = staffRows.map((s) => ({
    id: s.id,
    name: s.name,
    cellNumber: s.cellNumber ?? "",
    email: s.email ?? "",
    gender: s.gender ?? "",
    position: s.position ?? "",
    companyId: s.companyId,
    companyName: s.companyName,
    active: s.active,
    includeInBilling: s.includeInBilling,
  }));

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Everyone across COLAB and the sub-companies. Add manually or import from Excel."
      />
      <StaffManager staff={data} companies={companyRows} canManage={canManage} />
    </div>
  );
}
