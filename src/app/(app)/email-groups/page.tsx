import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups, emailGroupMembers, staff, companies } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { GroupsManager } from "./groups-client";

export const metadata = { title: "Email Groups — COLAB" };

export default async function EmailGroupsPage() {
  await requirePermission("groups.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "groups.manage") : false;

  const groups = await db.select().from(emailGroups).orderBy(asc(emailGroups.name));

  const memberRows = await db
    .select({ groupId: emailGroupMembers.groupId, staffId: emailGroupMembers.staffId })
    .from(emailGroupMembers);

  const membersByGroup = new Map<number, number[]>();
  for (const m of memberRows) {
    if (!membersByGroup.has(m.groupId)) membersByGroup.set(m.groupId, []);
    membersByGroup.get(m.groupId)!.push(m.staffId);
  }

  const staffRows = await db
    .select({
      id: staff.id,
      firstName: staff.firstName,
      lastName: staff.lastName,
      email: staff.email,
      companyName: companies.name,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .where(eq(staff.active, true))
    .orderBy(asc(companies.name), asc(staff.lastName));

  const groupData = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    memberIds: membersByGroup.get(g.id) ?? [],
  }));

  const allStaff = staffRows.map((s) => ({
    id: s.id,
    name: `${s.firstName} ${s.lastName}`,
    email: s.email ?? "",
    companyName: s.companyName,
  }));

  const counts = await db
    .select({ groupId: emailGroupMembers.groupId, count: sql<number>`count(*)::int` })
    .from(emailGroupMembers)
    .groupBy(emailGroupMembers.groupId);
  const countMap = new Map(counts.map((c) => [c.groupId, c.count]));

  return (
    <div>
      <PageHeader
        title="Email Groups"
        description="Group staff so announcements can target the right people — e.g. Admin, Directors, All Staff."
      />
      <GroupsManager
        groups={groupData.map((g) => ({ ...g, memberCount: countMap.get(g.id) ?? 0 }))}
        allStaff={allStaff}
        canManage={canManage}
      />
    </div>
  );
}
