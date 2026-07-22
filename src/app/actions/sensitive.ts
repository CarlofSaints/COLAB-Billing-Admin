"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser, hasPermission, verifyPassword } from "@/lib/auth";
import { grantReveal, revokeReveal } from "@/lib/sensitive";
import { logEvent } from "@/lib/log";

export type RevealResult = { error?: string; ok?: boolean };

/**
 * Unlocks restricted amounts for 15 minutes after the user re-enters their
 * own password. Every attempt is logged — who looked, and when.
 */
export async function revealValues(
  _prev: RevealResult,
  formData: FormData,
): Promise<RevealResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired — sign in again." };
  if (!hasPermission(user, "values.restricted")) {
    return { error: "You don't have permission to view restricted values." };
  }

  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter your password." };

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row) return { error: "Your account could not be found." };

  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) {
    await logEvent({
      action: "values.reveal_failed",
      summary: `Failed password check when trying to view restricted values`,
      actor: user,
      entityType: "user",
      entityId: user.id,
    });
    return { error: "That password isn't right." };
  }

  await grantReveal(user.id);
  await logEvent({
    action: "values.revealed",
    summary: `Unlocked restricted values for 15 minutes`,
    actor: user,
    entityType: "user",
    entityId: user.id,
  });

  // Amounts are masked server-side, so the pages have to be re-rendered.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Re-hides restricted amounts immediately. */
export async function hideValues() {
  const user = await getCurrentUser();
  await revokeReveal();
  if (user) {
    await logEvent({
      action: "values.hidden",
      summary: "Re-hid restricted values",
      actor: user,
      entityType: "user",
      entityId: user.id,
    });
  }
  revalidatePath("/", "layout");
}
