import { asc } from "drizzle-orm";
import { db } from "@/db";
import { roles, permissions, rolePermissions } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { permissionsByCategory } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page";
import { RolesGrid } from "./roles-client";

export const metadata = { title: "Roles & Permissions — COLAB" };

export default async function RolesPage() {
  await requirePermission("roles.manage");

  const roleRows = await db.select().from(roles).orderBy(asc(roles.rank));
  const permRows = await db.select().from(permissions);
  const rp = await db.select().from(rolePermissions);

  // Map "roleId:permissionId" for quick lookup on the client.
  const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]));
  const grantSet = new Set(rp.map((r) => `${r.roleId}:${r.permissionId}`));

  const categories = permissionsByCategory().map((cat) => ({
    category: cat.category,
    perms: cat.perms.map((p) => ({
      key: p.key,
      label: p.label,
      id: permIdByKey.get(p.key) ?? 0,
    })),
  }));

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        description="Switch each permission on or off per role. Super Admin always has full access."
      />
      <RolesGrid
        roles={roleRows.map((r) => ({
          id: r.id,
          name: r.name,
          key: r.key,
          description: r.description ?? "",
        }))}
        categories={categories}
        initialGrants={Array.from(grantSet)}
      />
    </div>
  );
}
