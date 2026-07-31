import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, roles, companies, staff } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { UsersManager } from "./users-client";

export const metadata = { title: "Users — COLAB" };

export default async function UsersPage() {
  await requirePermission("users.view");
  const me = await getCurrentUser();
  const canManage = me ? hasPermission(me, "users.manage") : false;

  const roleRows = await db.select().from(roles).orderBy(asc(roles.rank));

  // Needed for the "also add them to the team list" option — a team member
  // belongs to a company, so that has to be chosen at the same time.
  const companyRows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.active, true))
    .orderBy(asc(companies.type), asc(companies.name));

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      active: users.active,
      lastLoginAt: users.lastLoginAt,
      mustChangePassword: users.mustChangePassword,
      roleId: users.roleId,
      roleName: roles.name,
      roleKey: roles.key,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .orderBy(asc(users.name));

  // Who is also on the team list. Matched the same two ways the rest of the
  // app does — the userId FK, else the email address — so this column tells
  // the truth rather than a third version of it.
  const staffRows = await db
    .select({
      id: staff.id,
      email: staff.email,
      userId: staff.userId,
      active: staff.active,
      companyName: companies.name,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id));

  const staffByUserId = new Map(staffRows.filter((s) => s.userId != null).map((s) => [s.userId!, s]));
  const staffByEmail = new Map(
    staffRows.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s]),
  );

  const data = userRows.map((u) => {
    const member = staffByUserId.get(u.id) ?? staffByEmail.get(u.email.toLowerCase()) ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      active: u.active,
      lastLogin: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      mustChangePassword: u.mustChangePassword,
      roleId: u.roleId,
      roleName: u.roleName,
      roleKey: u.roleKey,
      teamCompany: member ? member.companyName : null,
      teamActive: member ? member.active : false,
    };
  });

  return (
    <div>
      <PageHeader
        title="Users"
        description="People who can sign in to the control centre, and the role each one holds."
      />
      <UsersManager
        users={data}
        roles={roleRows.map((r) => ({ id: r.id, name: r.name, key: r.key }))}
        companies={companyRows}
        canManage={canManage}
        currentUserId={me?.id ?? 0}
      />
    </div>
  );
}
