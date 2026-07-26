"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { issues, users, roles } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { appBaseUrl, mailConfigured, sendMail, issueReportedEmail } from "@/lib/mailer";
import { isIssueCategory } from "@/lib/issues";

export type ReportState = { error?: string; ok?: boolean; note?: string };

export async function reportIssue(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const user = await requirePermission("hub.view");
  const category = String(formData.get("category") ?? "").trim();
  const detail = String(formData.get("detail") ?? "").trim();

  if (!isIssueCategory(category)) return { error: "Choose the type of issue." };
  if (!detail) return { error: "Please describe the issue." };
  if (detail.length > 3000) return { error: "That's a bit long — keep it under 3000 characters." };

  const [row] = await db
    .insert(issues)
    .values({ category, detail, reportedByUserId: user.id, reportedByName: user.name })
    .returning();

  await logEvent({
    action: "issue.report",
    summary: `Reported a ${category} issue`,
    actor: user,
    entityType: "issue",
    entityId: row.id,
  });

  // Notify all active directors + admins (super admins included).
  let note: string | undefined;
  if (mailConfigured()) {
    const recipients = await db
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(
        and(
          eq(users.active, true),
          inArray(roles.key, ["super_admin", "director", "admin"]),
        ),
      );
    if (recipients.length > 0) {
      const mail = issueReportedEmail({
        category,
        detail,
        reporterName: user.name,
        issuesUrl: `${await appBaseUrl()}/issues`,
      });
      const results = await Promise.all(
        recipients.map(async (r) => ({
          email: r.email,
          res: await sendMail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text }),
        })),
      );
      const failed = results.filter((x) => !x.res.ok);
      await logEvent({
        action: failed.length ? "issue.notify_partial" : "issue.notified",
        summary: failed.length
          ? `Issue notify: ${results.length - failed.length}/${results.length} accepted by Resend; failed → ${failed
              .map((f) => `${f.email} (${!f.res.ok ? f.res.error : ""})`)
              .join(", ")}`
          : `Issue notify: Resend accepted all ${results.length} → ${results.map((x) => x.email).join(", ")}`,
        actor: user,
        entityType: "issue",
        entityId: row.id,
      });
      if (failed.length) note = `Reported — but ${failed.length} notification(s) failed to send.`;
    } else {
      note = "Reported — but there are no directors or admins to notify.";
    }
  } else {
    note = "Reported — email isn't configured, so no one was notified.";
  }

  revalidatePath("/issues");
  return { ok: true, note };
}

export async function setIssueStatus(id: number, status: "open" | "in_progress" | "resolved") {
  const actor = await requirePermission("issues.manage");
  await db
    .update(issues)
    .set({
      status,
      resolvedByName: status === "resolved" ? actor.name : null,
      resolvedAt: status === "resolved" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(issues.id, id));
  await logEvent({
    action: "issue.status",
    summary: `Marked an issue ${status.replace("_", " ")}`,
    actor,
    entityType: "issue",
    entityId: id,
  });
  revalidatePath("/issues");
}

export async function deleteIssue(id: number) {
  const actor = await requirePermission("issues.manage");
  await db.delete(issues).where(eq(issues.id, id));
  await logEvent({
    action: "issue.delete",
    summary: "Deleted an issue",
    actor,
    entityType: "issue",
    entityId: id,
  });
  revalidatePath("/issues");
}
