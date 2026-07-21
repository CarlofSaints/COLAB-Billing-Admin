"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { roles, permissions, rolePermissions } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { LOCKED_ROLE_KEY, DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

/** Turn a single permission on or off for a role. */
export async function setRolePermission(
  roleId: number,
  permissionId: number,
  enabled: boolean,
): Promise<{ error?: string; ok?: boolean }> {
  const actor = await requirePermission("roles.manage");

  const role = (await db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
  if (!role) return { error: "Role not found" };
  if (role.key === LOCKED_ROLE_KEY) {
    return { error: "The Super Admin role always has every permission." };
  }

  if (enabled) {
    await db
      .insert(rolePermissions)
      .values({ roleId, permissionId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)),
      );
  }

  const perm = (
    await db.select().from(permissions).where(eq(permissions.id, permissionId)).limit(1)
  )[0];

  await logEvent({
    action: "role.permission_change",
    summary: `${enabled ? "Granted" : "Revoked"} “${perm?.key ?? permissionId}” for role ${role.name}`,
    actor,
    entityType: "role",
    entityId: roleId,
    metadata: { permission: perm?.key, enabled },
  });

  revalidatePath("/roles");
  return { ok: true };
}

/** Restore a role's permissions to the seeded defaults. */
export async function resetRoleDefaults(roleId: number) {
  const actor = await requirePermission("roles.manage");
  const role = (await db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
  if (!role || role.key === LOCKED_ROLE_KEY) return;

  const keys = DEFAULT_ROLE_PERMISSIONS[role.key] ?? [];
  const allPerms = await db.select().from(permissions);
  const idByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  const rows = keys
    .map((k) => idByKey.get(k))
    .filter((id): id is number => Boolean(id))
    .map((permissionId) => ({ roleId, permissionId }));
  if (rows.length > 0) await db.insert(rolePermissions).values(rows).onConflictDoNothing();

  await logEvent({
    action: "role.reset_defaults",
    summary: `Reset role ${role.name} to default permissions`,
    actor,
    entityType: "role",
    entityId: roleId,
  });

  revalidatePath("/roles");
}
