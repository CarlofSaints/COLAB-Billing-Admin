"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, activityLog } from "@/db/schema";
import {
  createSession,
  destroySession,
  verifyPassword,
  hashPassword,
  requireUser,
  getCurrentUser,
} from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { passwordProblem } from "@/lib/password-policy";

export type LoginState = { error?: string };

/** Sign-in throttle: this many failures for one address inside the window. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // Throttle before touching the password. Failed attempts are already
  // recorded in the activity log, so the counter is just a read of it — no new
  // table, and the lockout survives a redeploy because it isn't in memory.
  // Keyed on the email typed, so one account being hammered can't lock out
  // anybody else.
  const [{ fails }] = await db
    .select({ fails: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, "auth.login_failed"),
        eq(activityLog.actorLabel, email),
        gt(activityLog.createdAt, new Date(Date.now() - LOCKOUT_WINDOW_MS)),
      ),
    );

  if (fails >= MAX_FAILED_LOGINS) {
    await logEvent({
      action: "auth.login_blocked",
      summary: `Blocked a sign-in attempt for ${email} — ${fails} failures in the last ${LOCKOUT_WINDOW_MS / 60000} minutes`,
      actorType: "system",
      actorLabel: email,
    });
    return {
      error: `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MS / 60000} minutes, or ask an admin to reset your password.`,
    };
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Constant-ish failure message to avoid leaking which part was wrong.
  if (!user || !user.active) {
    // Logged under the same action as a wrong password so that guessing at
    // addresses is throttled too, and can't be used to enumerate accounts.
    await logEvent({
      action: "auth.login_failed",
      summary: `Failed login attempt for ${email}`,
      actorType: "system",
      actorLabel: email,
    });
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

  if (next !== confirm) return { error: "New passwords do not match." };

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const record = rows[0];
  if (!record) return { error: "User not found." };

  // Checked against who they are, so "Carl2026Colab" doesn't sail through a
  // pure length test. Runs server-side because the form's copy of this rule is
  // a convenience, not a control.
  const problem = passwordProblem(next, { name: record.name, email: record.email });
  if (problem) return { error: problem };
  if (next === current) return { error: "That's your current password. Choose a new one." };

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
