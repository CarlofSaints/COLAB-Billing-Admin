"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, roles } from "@/db/schema";
import { requirePermission, hashPassword } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type UserActionState = { error?: string; ok?: boolean; tempPassword?: string };

function tempPassword(): string {
  // Readable-ish temporary password.
  return "COLAB-" + randomBytes(4).toString("hex");
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  roleId: z.coerce.number().int().positive("Choose a role"),
});

export async function createUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = parsed.data.email.toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return { error: "A user with that email already exists." };

  const pw = tempPassword();
  const passwordHash = await hashPassword(pw);
  const [row] = await db
    .insert(users)
    .values({
      name: parsed.data.name,
      email,
      roleId: parsed.data.roleId,
      passwordHash,
      mustChangePassword: true,
    })
    .returning();

  await logEvent({
    action: "user.create",
    summary: `Created user ${row.name} (${row.email})`,
    actor,
    entityType: "user",
    entityId: row.id,
  });

  revalidatePath("/users");
  return { ok: true, tempPassword: pw };
}

export async function updateUserRole(userId: number, roleId: number) {
  const actor = await requirePermission("users.manage");
  await db.update(users).set({ roleId, updatedAt: new Date() }).where(eq(users.id, userId));
  await logEvent({
    action: "user.role_change",
    summary: `Changed a user's role`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { roleId },
  });
  revalidatePath("/users");
}

export async function setUserActive(userId: number, active: boolean) {
  const actor = await requirePermission("users.manage");
  // Never let someone deactivate themselves and lock the door behind them.
  if (actor.id === userId && !active) return;
  await db.update(users).set({ active, updatedAt: new Date() }).where(eq(users.id, userId));
  await logEvent({
    action: "user.set_active",
    summary: `${active ? "Activated" : "Deactivated"} a user`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { active },
  });
  revalidatePath("/users");
}

export async function resetUserPassword(userId: number): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const pw = tempPassword();
  const passwordHash = await hashPassword(pw);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logEvent({
    action: "user.password_reset",
    summary: `Reset a user's password`,
    actor,
    entityType: "user",
    entityId: userId,
  });
  revalidatePath("/users");
  return { ok: true, tempPassword: pw };
}

export async function listRoles() {
  await requirePermission("users.view");
  return db.select().from(roles).orderBy(roles.rank);
}
