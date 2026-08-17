import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, activityLog, passwordResetTokens } from "@/db/schema";

/**
 * The shared parts of the public "I forgot my password" flow.
 *
 * ⚠️ These live here rather than beside the form actions ON PURPOSE. Every
 * export of a `"use server"` file is a POST endpoint anybody can call, and
 * `lastPasswordResetAt("someone@x.co.za")` would then be a public oracle for
 * "does this address have an account" — the exact thing the flow is written to
 * avoid. Only the two form actions belong in actions/password-reset.ts.
 */

/** How long a link stays good. Long enough to fetch a phone, short enough to matter. */
export const TOKEN_TTL_MINUTES = 60;

/** Requests for one address inside the window before we stop sending. */
export const MAX_RESET_REQUESTS = 3;
export const RESET_WINDOW_MS = 15 * 60 * 1000;

/**
 * Said back for every outcome of a request — unknown address, disabled account,
 * sent, or failed to send. Names a way out that doesn't depend on the email
 * arriving, because the one thing worse than a slow reset is a dead end with
 * nothing to do next.
 */
export const GENERIC_SENT =
  "If that email address has a COLAB account, a reset link is on its way — it's good for " +
  `${TOKEN_TTL_MINUTES} minutes. Check your spam folder too. If nothing arrives in a few minutes, ` +
  "ask the COLAB office to reset it for you.";

/**
 * Only the hash is ever stored. Unlike the reception-swap and steal-request
 * tokens, this one authenticates, so a leaked database row must not be
 * replayable as a link.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type TokenCheck =
  | { ok: true; name: string; email: string }
  | { ok: false; reason: "unknown" | "used" | "expired" | "disabled" };

/**
 * Whether a link is still worth showing a form for. Read-only — the page uses
 * it to decide what to render; `resetPasswordWithToken` re-checks all of it
 * before it writes, because a page render is not a control.
 */
export async function checkResetToken(token: string): Promise<TokenCheck> {
  const [row] = await db
    .select({
      usedAt: passwordResetTokens.usedAt,
      expiresAt: passwordResetTokens.expiresAt,
      name: users.name,
      email: users.email,
      active: users.active,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(token)))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (!row.active) return { ok: false, reason: "disabled" };
  return { ok: true, name: row.name, email: row.email };
}

/**
 * When this address last completed a reset, or null. Read off the activity log
 * rather than a column, so it stays true even if the token row is cleared out.
 */
export async function lastPasswordResetAt(email: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.action, "auth.password_reset"), eq(activityLog.actorLabel, email)))
    .orderBy(desc(activityLog.createdAt))
    .limit(1);
  return row?.at ?? null;
}
