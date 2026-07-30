import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups, emailGroupMembers, staff, staffTags, tags, companies } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { resolveGroupMembers } from "@/lib/group-members";
import { parseRule } from "@/lib/group-rules";
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

  // Everything the rule builder needs to preview a filter in the browser —
  // the same fields `matchesRule` looks at, so the preview and the send agree.
  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      gender: staff.gender,
      position: staff.position,
      companyId: staff.companyId,
      companyName: companies.name,
      includeInBilling: staff.includeInBilling,
      active: staff.active,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .where(eq(staff.active, true))
    .orderBy(asc(companies.name), asc(staff.name));

  const tagRows = await db
    .select({ staffId: staffTags.staffId, id: tags.id, name: tags.name, color: tags.color })
    .from(staffTags)
    .innerJoin(tags, eq(tags.id, staffTags.tagId));

  const tagsByStaff = new Map<number, { id: number; name: string }[]>();
  for (const t of tagRows) {
    if (!tagsByStaff.has(t.staffId)) tagsByStaff.set(t.staffId, []);
    tagsByStaff.get(t.staffId)!.push({ id: t.id, name: t.name });
  }

  const allTags = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .orderBy(asc(tags.name));

  const companyRows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .orderBy(asc(companies.name));

  const allStaff = staffRows.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email ?? "",
    gender: s.gender,
    position: s.position,
    companyId: s.companyId,
    companyName: s.companyName,
    includeInBilling: s.includeInBilling,
    active: s.active,
    tags: tagsByStaff.get(s.id) ?? [],
  }));

  // Counts come from the resolver so a live group reports who it would reach
  // now, not how many rows happen to sit in the member table.
  const byGroup = await resolveGroupMembers(groups.map((g) => g.id));

  const groupData = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    memberIds: membersByGroup.get(g.id) ?? [],
    memberCount: (byGroup.get(g.id) ?? []).length,
    rule: parseRule(g.rule),
  }));

  // Genders actually in use — a free-text column, so offering a fixed list
  // would silently exclude whatever else has been typed in.
  const genders = Array.from(
    new Set(staffRows.map((s) => (s.gender ?? "").trim()).filter(Boolean)),
  ).sort();

  return (
    <div>
      <PageHeader
        title="Email Groups"
        description="Group team members so announcements can target the right people — e.g. Admin, Directors, Everyone."
      />
      <GroupsManager
        groups={groupData}
        allStaff={allStaff}
        allTags={allTags}
        companies={companyRows}
        genders={genders}
        canManage={canManage}
      />
    </div>
  );
}
