"use server";

import { inArray, eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { emailGroupMembers, staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { emailShell, plainBodyHtml } from "@/lib/email-layout";
import { mailConfigured, sendBcc } from "@/lib/mailer";

export type MailState = {
  error?: string;
  ok?: boolean;
  count?: number;
  configured?: boolean;
};

export async function sendAnnouncement(_prev: MailState, formData: FormData): Promise<MailState> {
  const user = await requirePermission("mail.send");

  const groupIds = formData
    .getAll("groupId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (groupIds.length === 0) return { error: "Choose at least one group." };
  if (!subject) return { error: "Add a subject." };
  if (!body) return { error: "Write a message." };

  // Distinct recipient emails from the chosen groups.
  const rows = await db
    .selectDistinct({ email: staff.email, name: staff.name })
    .from(emailGroupMembers)
    .innerJoin(staff, eq(emailGroupMembers.staffId, staff.id))
    .where(
      and(
        inArray(emailGroupMembers.groupId, groupIds),
        eq(staff.active, true),
        isNotNull(staff.email),
      ),
    );

  const emails = Array.from(
    new Set(rows.map((r) => (r.email ?? "").trim()).filter((e) => e.includes("@"))),
  );

  if (emails.length === 0) {
    return { error: "The selected group(s) have no team members with email addresses." };
  }

  if (!mailConfigured()) {
    await logEvent({
      action: "mail.send_blocked",
      summary: `Announcement “${subject}” not sent — email not configured (${emails.length} recipients)`,
      actor: user,
      entityType: "mail",
      metadata: { subject, recipients: emails.length, groupIds },
    });
    return {
      error:
        "Email isn't configured yet. Add the GRAPH_* variables (or RESEND_API_KEY and MAIL_FROM) in Vercel, then try again.",
      configured: false,
    };
  }

  const html = emailShell({
    preheader: body.split("\n").find((line) => line.trim())?.slice(0, 120) ?? subject,
    eyebrow: "Announcement",
    heading: subject,
    content: plainBodyHtml(body, { linkify: true }),
  });

  const result = await sendBcc({ bcc: emails, subject, html, text: body });

  if (!result.ok) {
    await logEvent({
      action: "mail.send_failed",
      summary: `Failed to send announcement “${subject}”: ${result.error}`,
      actor: user,
      entityType: "mail",
      metadata: { subject, error: result.error },
    });
    return { error: `Send failed: ${result.error}` };
  }

  await logEvent({
    action: "mail.send",
    summary: `Sent announcement “${subject}” to ${emails.length} recipient(s) via ${result.provider}`,
    actor: user,
    entityType: "mail",
    metadata: { subject, recipients: emails.length, groupIds, provider: result.provider },
  });

  return { ok: true, count: emails.length };
}
