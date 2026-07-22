"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  destroySession,
  verifyPassword,
  hashPassword,
  requireUser,
  getCurrentUser,
} from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Constant-ish failure message to avoid leaking which part was wrong.
  if (!user || !user.active) {
    return { error: "Invalid email or password." };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await logEvent({
      action: "auth.login_failed",
      summary: `Failed login attempt for ${email}`,
      actorType: "system",
      actorLabel: email,
    });
    return { error: "Invalid email or password." };
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await createSession(user.id);

  await logEvent({
    action: "auth.login",
    summary: `${user.name} signed in`,
    actorType: "user",
    actorLabel: user.name,
    entityType: "user",
    entityId: user.id,
  });

  redirect(user.mustChangePassword ? "/account/password?first=1" : "/");
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) {
    await logEvent({
      action: "auth.logout",
      summary: `${user.name} signed out`,
      actor: user,
      entityType: "user",
      entityId: user.id,
    });
  }
  await destroySession();
  redirect("/login");
}

export type ProfileState = { error?: string; ok?: boolean };

/**
 * Updates the signed-in user's own name and email. Changing the email changes
 * what they sign in with, so it's confirmed with their password.
 */
export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name) return { error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const record = rows[0];
  if (!record) return { error: "User not found." };

  const emailChanged = email !== record.email.toLowerCase();
  if (emailChanged) {
    if (!password) return { error: "Enter your password to change your email address." };
    const ok = await verifyPassword(password, record.passwordHash);
    if (!ok) return { error: "That password isn't right." };

    const clash = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (clash[0] && clash[0].id !== user.id) {
      return { error: "Another user already has that email address." };
    }
  }

  await db
    .update(users)
    .set({ name, email, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await logEvent({
    action: "auth.profile_update",
    summary: emailChanged
      ? `${name} changed their sign-in email from ${record.email} to ${email}`
      : `${name} updated their profile`,
    actor: user,
    entityType: "user",
    entityId: user.id,
    metadata: { emailChanged },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export type PasswordState = { error?: string; ok?: boolean };

export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "New passwords do not match." };

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const record = rows[0];
  if (!record) return { error: "User not found." };

  const ok = await verifyPassword(current, record.passwordHash);
  if (!ok) return { error: "Your current password is incorrect." };

  const passwordHash = await hashPassword(next);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await logEvent({
    action: "auth.password_change",
    summary: `${user.name} changed their password`,
    actor: user,
    entityType: "user",
    entityId: user.id,
  });

  return { ok: true };
}
