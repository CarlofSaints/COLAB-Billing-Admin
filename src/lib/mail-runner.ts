import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { companies, emailGroupMembers, mailSchedules, staff } from "@/db/schema";
import { appBaseUrl, sendBatch, type OutgoingMessage } from "./mailer";
import { applyTokens, monthLabel } from "./schedules";
import { logEvent } from "./log";
import type { MailSchedule } from "@/db/schema";

/** Turn a plain-text body into the same simple HTML the announcements use. */
function bodyHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Linkify bare URLs so {{link}} is clickable.
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#1d4ed8">$1</a>',
  );
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${linked.replace(
    /\n/g,
    "<br>",
  )}</div>`;
}

/**
 * Builds the individual messages a schedule would send right now. Exported so
 * the UI can show a recipient count without sending anything.
 */
export async function buildMessages(
  schedule: Pick<MailSchedule, "subject" | "body" | "audience" | "groupIds">,
): Promise<OutgoingMessage[]> {
  const base = await appBaseUrl();
  const link = `${base}/staff`;
  const month = monthLabel();

  if (schedule.audience === "company_contacts") {
    const rows = await db
      .select({
        name: companies.name,
        contactName: companies.contactName,
        contactEmail: companies.contactEmail,
        contactName2: companies.contactName2,
        contactEmail2: companies.contactEmail2,
        contactName3: companies.contactName3,
        contactEmail3: companies.contactEmail3,
      })
      .from(companies)
      .where(and(eq(companies.type, "sub"), eq(companies.active, true)));

    const messages: OutgoingMessage[] = [];
    for (const r of rows) {
      // Each contact gets their own copy, addressed by their own name.
      const people = [
        { name: r.contactName, email: r.contactEmail },
        { name: r.contactName2, email: r.contactEmail2 },
        { name: r.contactName3, email: r.contactEmail3 },
      ];
      const seen = new Set<string>();
      for (const person of people) {
        const email = (person.email ?? "").trim();
        if (!email.includes("@") || seen.has(email.toLowerCase())) continue;
        seen.add(email.toLowerCase());
        const values = {
          company: r.name,
          contact: person.name?.trim() || r.name,
          month,
          link,
        };
        const body = applyTokens(schedule.body, values);
        messages.push({
          to: email,
          subject: applyTokens(schedule.subject, values),
          html: bodyHtml(body),
          text: body,
        });
      }
    }
    return messages;
  }

  // Group audience: every active group member with an email, de-duplicated.
  const groupIds = schedule.groupIds ?? [];
  if (groupIds.length === 0) return [];

  const rows = await db
    .selectDistinct({ email: staff.email, name: staff.name, companyName: companies.name })
    .from(emailGroupMembers)
    .innerJoin(staff, eq(emailGroupMembers.staffId, staff.id))
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .where(and(inArray(emailGroupMembers.groupId, groupIds), eq(staff.active, true), isNotNull(staff.email)));

  const seen = new Set<string>();
  const messages: OutgoingMessage[] = [];
  for (const r of rows) {
    const email = (r.email ?? "").trim();
    if (!email.includes("@") || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const values = { company: r.companyName, contact: r.name, month, link };
    const body = applyTokens(schedule.body, values);
    messages.push({
      to: email,
      subject: applyTokens(schedule.subject, values),
      html: bodyHtml(body),
      text: body,
    });
  }
  return messages;
}

export type RunResult = { sent: number; failed: number; error?: string };

/**
 * Sends a schedule now and records the outcome on the row. Used by both the
 * daily cron and the "Send now" button, so behaviour can't drift between them.
 */
export async function runSchedule(
  schedule: MailSchedule,
  opts: { trigger: "cron" | "manual"; actorLabel?: string },
): Promise<RunResult> {
  const messages = await buildMessages(schedule);

  if (messages.length === 0) {
    await db
      .update(mailSchedules)
      .set({
        lastRunAt: new Date(),
        lastStatus: "skipped",
        lastDetail: "No recipients — check the audience has contact email addresses.",
        updatedAt: new Date(),
      })
      .where(eq(mailSchedules.id, schedule.id));

    await logEvent({
      action: "mail.schedule_skipped",
      summary: `Reminder “${schedule.name}” had no recipients`,
      entityType: "mail_schedule",
      entityId: schedule.id,
      actorType: opts.trigger === "cron" ? "system" : "user",
      actorLabel: opts.actorLabel,
    });
    return { sent: 0, failed: 0, error: "No recipients." };
  }

  const result = await sendBatch(messages);
  const ok = result.failed === 0 && !result.error;

  await db
    .update(mailSchedules)
    .set({
      lastRunAt: new Date(),
      lastStatus: ok ? "sent" : "failed",
      lastDetail: ok
        ? `Sent to ${result.sent} recipient(s).`
        : (result.error ?? `Failed for ${result.failed} recipient(s).`),
      updatedAt: new Date(),
    })
    .where(eq(mailSchedules.id, schedule.id));

  await logEvent({
    action: ok ? "mail.schedule_sent" : "mail.schedule_failed",
    summary: ok
      ? `Reminder “${schedule.name}” sent to ${result.sent} recipient(s) (${opts.trigger})`
      : `Reminder “${schedule.name}” failed: ${result.error ?? "unknown error"}`,
    entityType: "mail_schedule",
    entityId: schedule.id,
    actorType: opts.trigger === "cron" ? "system" : "user",
    actorLabel: opts.actorLabel,
    metadata: { sent: result.sent, failed: result.failed, trigger: opts.trigger },
  });

  return result;
}
