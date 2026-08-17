"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, activityLog, passwordResetTokens } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { passwordProblem } from "@/lib/password-policy";
import { appBaseUrl, mailConfigured, passwordResetEmail, sendMail } from "@/lib/mailer";
import {
  GENERIC_SENT,
  MAX_RESET_REQUESTS,
  RESET_WINDOW_MS,
  TOKEN_TTL_MINUTES,
  hashResetToken,
} from "@/lib/password-reset";

/**
 * The public "I forgot my password" flow: ask for a link, then spend it. Both
 * halves are reachable signed-out — these are the only form actions in the app
 * with no guard in front of them, so read them as such.
 *
 * 🔴 THE ASKING HALF MUST NEVER REVEAL WHETHER AN ADDRESS HAS AN ACCOUNT.
 * Unknown address, disabled account, real account and even a failed send all
 * return the same sentence. The difference is recorded in the activity log,
 * where it is useful and not public.
 *
 * ⚠️ Only these two exports may live in this file — every export of a
 * `"use server"` module is a public POST endpoint. The read helpers are in
 * lib/password-reset.ts for that reason.
 */

export type ForgotState = { error?: string; sent?: string };

export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }

  // Without a transport there is nothing to send and no point pretending —
  // and saying so leaks nothing about whether the account exists.
  if (!mailConfigured()) {
    return {
      error:
        "Password reset emails aren't set up on this site yet. Ask the COLAB office to reset it for you.",
    };
  }

  // Throttled off the activity log, exactly like the sign-in lockout: no new
  // table, survives a redeploy, and unknown addresses are counted identically
  // so the counter can't be used to tell accounts apart.
  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, "auth.reset_requested"),
        eq(activityLog.actorLabel, email),
        gt(activityLog.createdAt, new Date(Date.now() - RESET_WINDOW_MS)),
      ),
    );

  if (recent >= MAX_RESET_REQUESTS) {
    return {
      error:
        `You've asked for a reset link ${MAX_RESET_REQUESTS} times in the last ` +
        `${RESET_WINDOW_MS / 60000} minutes. Check your inbox and spam folder, or try again shortly.`,
    };
  }

  // Logged before we know whether the address exists, so the throttle above
  // counts a fishing expedition the same as a genuine request.
  await logEvent({
    action: "auth.reset_requested",
    summary: `Password reset link requested for ${email}`,
    actorType: "system",
    actorLabel: email,
  });

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // A disabled account is treated as no account: a working password for
  // something that bounces at the login screen only generates a support call.
  if (!user || !user.active) {
    await logEvent({
      action: "auth.reset_unknown",
      summary: user
        ? `Reset link not sent to ${email} — the account is disabled`
        : `Reset link not sent — no account for ${email}`,
      actorType: "system",
      actorLabel: email,
    });
    return { sent: GENERIC_SENT };
  }

  // Only the newest link works. Asking twice and then clicking the older email
  // is a normal thing for a person to do, but it must not be a second live key.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
  });

  const base = await appBaseUrl();
  const mail = passwordResetEmail({
    name: user.name,
    email: user.email,
    resetUrl: `${base}/reset-password/${token}`,
    minutesValid: TOKEN_TTL_MINUTES,
  });
  const res = await sendMail({
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  await logEvent({
    action: res.ok ? "auth.reset_sent" : "auth.reset_send_failed",
    // Naming the transport for the same reason the credentials path does: a
    // send that failed over to Resend looks healthy from here and identical to
    // the recipient, right up until you go hunting for why nothing arrived.
    summary: res.ok
      ? `Sent ${user.name} (${email}) a password reset link (via ${res.provider})`
      : `Failed to send ${user.name} (${email}) a password reset link: ${res.error}`,
    actorType: "system",
    actorLabel: email,
    entityType: "user",
    entityId: user.id,
  });

  // Same sentence whether it sent or not — see the note at the top of the file.
  // A failure is in the log above, named, where an admin can act on it.
  return { sent: GENERIC_SENT };
}

export type ResetState = { error?: string };

export async function resetPasswordWithToken(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const deadLink =
    "That reset link has expired or has already been used. Ask for a new one and try again.";

  const [row] = await db
    .select({
      id: passwordResetTokens.id,
      usedAt: passwordResetTokens.usedAt,
      expiresAt: passwordResetTokens.expiresAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      active: users.active,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(token)))
    .limit(1);

  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return { error: deadLink };
  if (!row.active) {
    return { error: "That account is disabled. Ask the COLAB office to enable it first." };
  }

  // ⚠️ THE PASSWORD IS CHECKED BEFORE THE LINK IS SPENT. Burning someone's only
  // link on a typo — a mismatched confirmation, eleven characters instead of
  // twelve — would send them back to the login screen to start all over again.
  if (next !== confirm) return { error: "Those two passwords don't match." };
  const problem = passwordProblem(next, { name: row.name, email: row.email });
  if (problem) return { error: problem };

  // Spend it conditionally: the `used_at is null` clause is what makes two
  // submissions in the same second resolve to one winner rather than both
  // sailing through.
  const spent = await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  if (spent.length === 0) return { error: deadLink };

  const passwordHash = await hashPassword(next);
  await db
    .update(users)
    // They chose it themselves, so there is nothing to force a change to.
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, row.userId));

  await logEvent({
    action: "auth.password_reset",
    summary: `${row.name} (${row.email}) set a new password from a forgotten-password link`,
    actorType: "user",
    // ⚠️ Keyed on the ADDRESS rather than the name so the sign-in throttle can
    // find it — see the lockout in actions/auth.ts. Don't "tidy" this to the
    // person's name.
    actorLabel: row.email.toLowerCase(),
    entityType: "user",
    entityId: row.userId,
  });

  // Signed straight in. They've just proved they hold the mailbox and chosen
  // the password; bouncing them to a login screen to type it again is friction
  // for its own sake.
  await createSession(row.userId);
  redirect("/");
}
