import { asc, sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups, mailSchedules } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { resolveGroupMembers } from "@/lib/group-members";
import { parseRule } from "@/lib/group-rules";
import { mailConfigured } from "@/lib/mailer";
import { PageHeader } from "@/components/ui/page";
import { MailTabs } from "./mail-tabs";
import type { ScheduleRow } from "./schedules-client";

export const metadata = { title: "Mail Sender — COLAB" };

export default async function MailPage() {
  await requirePermission("mail.send");

  const groups = await db.select().from(emailGroups).orderBy(asc(emailGroups.name));

  // Reachable recipients per group, through the shared resolver so a rule
  // group's count is what it would actually send to right now.
  const byGroup = await resolveGroupMembers(groups.map((g) => g.id));

  const groupData = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    recipientCount: (byGroup.get(g.id) ?? []).filter((m) => (m.email ?? "").includes("@")).length,
    rule: parseRule(g.rule),
  }));

  const configured = mailConfigured();

  const scheduleRows = await db
    .select()
    .from(mailSchedules)
    .orderBy(asc(mailSchedules.name));
  const schedules: ScheduleRow[] = scheduleRows.map((s) => ({
    id: s.id,
    name: s.name,
    subject: s.subject,
    body: s.body,
    audience: s.audience,
    groupIds: s.groupIds ?? [],
    frequency: s.frequency,
    dayOfMonth: s.dayOfMonth,
    dayOfWeek: s.dayOfWeek,
    active: s.active,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastStatus: s.lastStatus,
    lastDetail: s.lastDetail,
  }));

  return (
    <div>
      <PageHeader
        title="Mail Sender"
        description="Send an announcement now, or schedule a recurring reminder."
      />
      <MailTabs groups={groupData} schedules={schedules} configured={configured} />
    </div>
  );
}
