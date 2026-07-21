"use server";

import { redirect } from "next/navigation";
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
