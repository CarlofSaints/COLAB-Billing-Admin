import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, companies, tags, staffTags } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { StaffManager } from "./staff-client";

export const metadata = { title: "Team Members — COLAB" };

export default async function StaffPage() {
  await requirePermission("staff.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "staff.manage") : false;
  const canInvite = user ? hasPermission(user, "team.invite") : false;
  const canManageGroups = user ? hasPermission(user, "groups.manage") : false;

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
      userId: staff.userId,
      dateOfBirth: staff.dateOfBirth,
      dateOfBirthAdmin: staff.dateOfBirthAdmin,
      companyName: companies.name,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .orderBy(asc(staff.name));

  const allTagRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color, cost: tags.costPerPerson })
    .from(tags)
    .orderBy(asc(tags.name));
  // Applying a costed tag bills the person's sub-company, so the form has to
  // say what it costs before it's clicked.
  const allTags = allTagRows.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    costPerPerson: t.cost === null ? null : Number(t.cost),
  }));

  const tagLinks = await db
    .select({ staffId: staffTags.staffId, id: tags.id, name: tags.name, color: tags.color })
    .from(staffTags)
    .innerJoin(tags, eq(tags.id, staffTags.tagId));
  const tagsByStaff = new Map<number, { id: number; name: string; color: string | null }[]>();
  for (const l of tagLinks) {
    const list = tagsByStaff.get(l.staffId) ?? [];
    list.push({ id: l.id, name: l.name, color: l.color });
    tagsByStaff.set(l.staffId, list);
  }

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
    hasAccount: s.userId != null,
    dateOfBirthSelf: s.dateOfBirth,
    dateOfBirthAdmin: s.dateOfBirthAdmin,
    tags: tagsByStaff.get(s.id) ?? [],
  }));

  return (
    <div>
      <PageHeader
        title="Team Members"
        description="Everyone across COLAB and the sub-companies. Add manually or import from Excel."
      />
      <StaffManager
        staff={data}
        companies={companyRows}
        allTags={allTags}
        canManage={canManage}
        canInvite={canInvite}
        canManageGroups={canManageGroups}
      />
    </div>
  );
}
