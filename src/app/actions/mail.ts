"use server";

import { inArray, eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { emailGroupMembers, staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

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
    .selectDistinct({ email: staff.email, name: staff.firstName })
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
    return { error: "The selected group(s) have no staff with email addresses." };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    await logEvent({
      action: "mail.send_blocked",
      summary: `Announcement “${subject}” not sent — email not configured (${emails.length} recipients)`,
      actor: user,
      entityType: "mail",
      metadata: { subject, recipients: emails.length, groupIds },
    });
    return {
      error:
        "Email isn't configured yet. Add RESEND_API_KEY and MAIL_FROM in Vercel, then try again.",
      configured: false,
    };
  }

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\n/g, "<br>")}</div>`;

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [from], // visible recipient is COLAB itself
      bcc: emails, // everyone else is bcc'd for privacy
      subject,
      html,
      text: body,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logEvent({
      action: "mail.send_failed",
      summary: `Failed to send announcement “${subject}”: ${message}`,
      actor: user,
      entityType: "mail",
      metadata: { subject, error: message },
    });
    return { error: `Send failed: ${message}` };
  }

  await logEvent({
    action: "mail.send",
    summary: `Sent announcement “${subject}” to ${emails.length} recipient(s)`,
    actor: user,
    entityType: "mail",
    metadata: { subject, recipients: emails.length, groupIds },
  });

  return { ok: true, count: emails.length };
}
