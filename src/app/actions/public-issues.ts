"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { issues, users, roles, staff, companies } from "@/db/schema";
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
import { resolveCategory, resolvePlace } from "@/lib/issue-lists";

/**
 * "See something, say something" from a QR-code sticker — no login.
 *
 * Everything here runs for whoever scanned the sticker, which in practice
 * means anyone who can photograph a wall, so it is written defensively:
 *
 *   - the team list is NEVER shipped to the page. Names come back only in
 *     response to a search of two or more characters, capped, without email
 *     addresses — otherwise a sticker would publish a staff directory.
 *   - a picked name is a CLAIM, not an identity. Nothing here proves who the
 *     reporter is, so the ticket is stored with `source = 'public'` and is
 *     labelled unverified everywhere it is read.
 *   - submissions are rate limited per IP and carry a honeypot, because the
 *     form emails every admin and would otherwise be a free megaphone.
 */

export type PublicReportState = { error?: string; ok?: boolean };

/** Most a single IP may submit in the window below. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MINUTES = 15;

function hashIp(ip: string): string {
  // Salted with AUTH_SECRET so the hashes aren't reversible with a rainbow
  // table of the (small) IPv4 space.
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:${ip}`).digest("hex");
}

async function reporterIp(): Promise<string> {
  const h = await headers();
  // Vercel sets x-forwarded-for; take the first hop, which is the client.
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

/**
 * Team members matching a search, for the "which one of us are you?" picker.
 *
 * Deliberately returns name + company only. A public page has no business
 * knowing anybody's email address, and two characters minimum stops the list
 * being walked one letter at a time.
 */
export async function searchTeamMembers(
  query: string,
): Promise<{ id: number; name: string; companyName: string }[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await db
    .select({ id: staff.id, name: staff.name, companyName: companies.name })
    .from(staff)
    .innerJoin(companies, eq(companies.id, staff.companyId))
    .where(and(eq(staff.active, true), sql`${staff.name} ilike ${"%" + q + "%"}`))
    .orderBy(staff.name)
    .limit(10);

  return rows;
}

export async function reportIssuePublic(
  _prev: PublicReportState,
  formData: FormData,
): Promise<PublicReportState> {
  // Honeypot: a real person never fills a field they cannot see. Answered with
  // success so a bot has nothing to tune against.
  if (String(formData.get("website") ?? "").trim()) return { ok: true };

  const detail = String(formData.get("detail") ?? "").trim();
  const isTeamMember = formData.get("isTeamMember") === "on";
  const staffId = Number(formData.get("staffId"));

  const chosen = await resolveCategory(Number(formData.get("categoryId")));
  if (!chosen) return { error: "Choose the type of issue." };
  if (detail.length < 5) return { error: "Please describe the issue." };
  if (detail.length > 3000) return { error: "That's a bit long — keep it under 3000 characters." };

  const place = await resolvePlace(Number(formData.get("placeId")));
  const category = chosen.name;

  const ipHash = hashIp(await reporterIp());
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(eq(issues.reporterIpHash, ipHash), gte(issues.createdAt, since)));

  if (count >= RATE_LIMIT) {
    return {
      error: "That's a few reports in a short space of time. Give it a few minutes and try again.",
    };
  }

  // A name is only recorded if they said they're a team member AND picked
  // themselves. Anything else stays anonymous — the point of the sticker is
  // that reporting something is easy, not that everyone is identified.
  let reportedByName = "Anonymous (via QR code)";
  let reportedByStaffId: number | null = null;

  if (isTeamMember && Number.isInteger(staffId) && staffId > 0) {
    const [person] = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.active, true)))
      .limit(1);
    if (person) {
      reportedByName = person.name;
      reportedByStaffId = person.id;
    }
  }

  // After the rate-limit check, so a flood can't push files into the store.
  const photo = await storeIssuePhoto(formData.get("photo"));
  if (!photo.ok) return { error: photo.error };

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
      reportedByName,
      reportedByStaffId,
      source: "public",
      reporterIpHash: ipHash,
    })
    .returning();

  await logEvent({
    action: "issue.report_public",
    summary: `Reported a ${category} issue via the QR code page (${
      reportedByStaffId ? `${reportedByName}, self-declared` : "anonymous"
    })`,
    actorType: "system",
    entityType: "issue",
    entityId: row.id,
  });

  // Notify all active directors + admins, same as the signed-in path.
  if (mailConfigured()) {
    const recipients = await db
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.active, true), inArray(roles.key, ["super_admin", "director", "admin"])));

    if (recipients.length > 0) {
      const mail = issueReportedEmail({
        category,
        detail,
        reporterName: reportedByName,
        place: place?.name ?? null,
        hasPhoto: Boolean(photo.pathname),
        issuesUrl: `${await appBaseUrl()}/issues`,
        unverified: true,
      });
      const results = await Promise.all(
        recipients.map(async (r) => ({
          email: r.email,
          res: await sendMail({
            to: r.email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          }),
        })),
      );
      const byProvider: Partial<Record<MailProvider, number>> = {};
      for (const { res } of results) {
        if (res.ok) byProvider[res.provider] = (byProvider[res.provider] ?? 0) + 1;
      }
      const failed = results.filter((x) => !x.res.ok);
      await logEvent({
        action: failed.length ? "issue.notify_partial" : "issue.notified",
        summary: failed.length
          ? `Public issue notify: ${results.length - failed.length}/${results.length} sent`
          : `Public issue notify: all ${results.length} sent (${describeProviders(byProvider)})`,
        actorType: "system",
        entityType: "issue",
        entityId: row.id,
      });
    }
  }

  // Nothing is revalidated for the reporter — they can't see /issues anyway.
  return { ok: true };
}
