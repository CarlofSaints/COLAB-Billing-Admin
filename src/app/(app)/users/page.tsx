import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, roles, companies } from "@/db/schema";
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

  const data = userRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active,
    lastLogin: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    mustChangePassword: u.mustChangePassword,
    roleId: u.roleId,
    roleName: u.roleName,
    roleKey: u.roleKey,
  }));

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
