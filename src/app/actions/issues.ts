"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  describeProviders,
  mailConfigured,
  sendMail,
  issueReportedEmail,
  type MailProvider,
} from "@/lib/mailer";
import { storeIssuePhoto } from "@/lib/issue-photo";
import { notificationRecipients } from "@/lib/notifications";
import { resolveCategory, resolvePlace } from "@/lib/issue-lists";

export type ReportState = { error?: string; ok?: boolean; note?: string };


export async function reportIssue(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const user = await requirePermission("hub.view");
  const categoryId = Number(formData.get("categoryId"));
  const placeId = Number(formData.get("placeId"));
  const detail = String(formData.get("detail") ?? "").trim();

  const chosen = await resolveCategory(categoryId);
  if (!chosen) return { error: "Choose the type of issue." };
  if (!detail) return { error: "Please describe the issue." };
  if (detail.length > 3000) return { error: "That's a bit long — keep it under 3000 characters." };

  const place = await resolvePlace(placeId);

  // Uploaded before the insert so a rejected photo doesn't leave a ticket
  // behind that the reporter thinks failed.
  const photo = await storeIssuePhoto(formData.get("photo"));
  if (!photo.ok) return { error: photo.error };

  const category = chosen.name;
  const [row] = await db
    .insert(issues)
    .values({
      category,
      categoryId: chosen.id,
      detail,
      placeId: place?.id ?? null,
      place: place?.name ?? null,
      photoPath: photo.pathname,
      photoContentType: photo.contentType,
      reportedByUserId: user.id,
      reportedByName: user.name,
    })
    .returning();

  await logEvent({
    action: "issue.report",
    summary: `Reported a ${category} issue`,
    actor: user,
    entityType: "issue",
    entityId: row.id,
  });

  // Notify whoever the Notifications page points "somebody reports an office
  // issue" at — nobody else. This used to also mail every director and admin
  // from a role list hard-coded here, which sent seven people a broken kettle
  // and could only be changed by a deploy.
  let note: string | undefined;
  if (mailConfigured()) {
    const recipients = await notificationRecipients("issue_reported");

    if (recipients.length > 0) {
      const mail = issueReportedEmail({
        category,
        detail,
        reporterName: user.name,
        place: place?.name ?? null,
        hasPhoto: Boolean(photo.pathname),
        issuesUrl: `${await appBaseUrl()}/issues`,
      });
      const results = await Promise.all(
        recipients.map(async (r) => ({
          email: r.email,
          res: await sendMail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text }),
        })),
      );
      const failed = results.filter((x) => !x.res.ok);
      const byProvider: Partial<Record<MailProvider, number>> = {};
      for (const { res } of results) {
        if (res.ok) byProvider[res.provider] = (byProvider[res.provider] ?? 0) + 1;
      }
      const via = describeProviders(byProvider);
      await logEvent({
        action: failed.length ? "issue.notify_partial" : "issue.notified",
        summary: failed.length
          ? `Issue notify: ${results.length - failed.length}/${results.length} sent${via ? ` (${via})` : ""}; failed → ${failed
              .map((f) => `${f.email} (${!f.res.ok ? f.res.error : ""})`)
              .join(", ")}`
          : `Issue notify: all ${results.length} sent (${via}) → ${results.map((x) => x.email).join(", ")}`,
        actor: user,
        entityType: "issue",
        entityId: row.id,
      });
      if (failed.length) note = `Reported — but ${failed.length} notification(s) failed to send.`;
    } else {
      // Logged, not just returned: the reporter's toast is gone in seconds, and
      // "nobody is set to be told about office issues" has to be findable
      // afterwards or it stays broken indefinitely.
      await logEvent({
        action: "issue.notify_nobody",
        summary:
          "Issue notify: nobody was emailed — the Notifications page has no group (or an empty one) set for “somebody reports an office issue”.",
        actor: user,
        entityType: "issue",
        entityId: row.id,
      });
      note = "Reported — but nobody is set up to be notified. Ask an admin to check Notifications.";
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
