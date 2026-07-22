"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, roles } from "@/db/schema";
import { requirePermission, hashPassword } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { appBaseUrl, credentialsEmail, mailConfigured, sendMail } from "@/lib/mailer";

export type UserActionState = {
  error?: string;
  ok?: boolean;
  tempPassword?: string;
  /** Set when the credentials email was requested: did it actually go out? */
  emailed?: boolean;
  emailError?: string;
  emailTo?: string;
};

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

  // Both default on: the admin ticks them off deliberately.
  const sendCredentials = formData.get("sendCredentials") != null;
  const mustChangePassword = formData.get("mustChangePassword") != null;

  const pw = tempPassword();
  const passwordHash = await hashPassword(pw);
  const [row] = await db
    .insert(users)
    .values({
      name: parsed.data.name,
      email,
      roleId: parsed.data.roleId,
      passwordHash,
      mustChangePassword,
    })
    .returning();

  await logEvent({
    action: "user.create",
    summary: `Created user ${row.name} (${row.email})`,
    actor,
    entityType: "user",
    entityId: row.id,
    metadata: { sendCredentials, mustChangePassword },
  });

  const mail = sendCredentials
    ? await mailCredentials({
        name: row.name,
        email: row.email,
        password: pw,
        mustChangePassword,
        isReset: false,
        actorId: row.id,
      })
    : null;

  revalidatePath("/users");
  return {
    ok: true,
    tempPassword: pw,
    ...(mail ?? {}),
  };
}

/**
 * Emails a user their sign-in details and records the outcome. Never throws —
 * a failed send must not undo the account it belongs to.
 */
async function mailCredentials(input: {
  name: string;
  email: string;
  password: string;
  mustChangePassword: boolean;
  isReset: boolean;
  actorId: number;
}): Promise<{ emailed: boolean; emailError?: string; emailTo: string }> {
  if (!mailConfigured()) {
    const error = "Email isn't configured yet — add RESEND_API_KEY and MAIL_FROM in Vercel.";
    await logEvent({
      action: "user.credentials_email_blocked",
      summary: `Could not email sign-in details to ${input.email} — email not configured`,
      entityType: "user",
      entityId: input.actorId,
    });
    return { emailed: false, emailError: error, emailTo: input.email };
  }

  const loginUrl = `${await appBaseUrl()}/login`;
  const { subject, html, text } = credentialsEmail({ ...input, loginUrl });
  const res = await sendMail({ to: input.email, subject, html, text });

  await logEvent({
    action: res.ok ? "user.credentials_emailed" : "user.credentials_email_failed",
    summary: res.ok
      ? `Emailed sign-in details to ${input.email}`
      : `Failed to email sign-in details to ${input.email}: ${res.error}`,
    entityType: "user",
    entityId: input.actorId,
  });

  return res.ok
    ? { emailed: true, emailTo: input.email }
    : { emailed: false, emailError: res.error, emailTo: input.email };
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

/**
 * Permanently removes a user. Their activity-log entries survive — the log
 * stores actorId without a foreign key precisely so history isn't rewritten.
 */
export async function deleteUser(userId: number): Promise<{ error?: string; ok?: boolean }> {
  const actor = await requirePermission("users.manage");
  if (actor.id === userId) return { error: "You can't delete your own account." };

  const [target] = await db
    .select({ id: users.id, name: users.name, email: users.email, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { error: "That user no longer exists." };

  // Never let the last super admin be deleted — that would lock everyone out
  // of users, roles and integrations for good.
  if (target.roleKey === "super_admin") {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(roles.key, "super_admin"), eq(users.active, true)));
    if (admins.length <= 1) {
      return { error: "This is the only Super Admin — create another one before deleting this." };
    }
  }

  await db.delete(users).where(eq(users.id, userId));

  await logEvent({
    action: "user.delete",
    summary: `Deleted user ${target.name} (${target.email})`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { role: target.roleKey },
  });

  revalidatePath("/users");
  return { ok: true };
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
