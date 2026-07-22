import { asc, sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups, emailGroupMembers, mailSchedules, staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { MailTabs } from "./mail-tabs";
import type { ScheduleRow } from "./schedules-client";

export const metadata = { title: "Mail Sender — COLAB" };

export default async function MailPage() {
  await requirePermission("mail.send");

  const groups = await db.select().from(emailGroups).orderBy(asc(emailGroups.name));

  // Count reachable recipients (active staff with an email) per group.
  const counts = await db
    .select({ groupId: emailGroupMembers.groupId, count: sql<number>`count(*)::int` })
    .from(emailGroupMembers)
    .innerJoin(staff, eq(emailGroupMembers.staffId, staff.id))
    .where(eq(staff.active, true))
    .groupBy(emailGroupMembers.groupId);
  const countMap = new Map(counts.map((c) => [c.groupId, c.count]));

  const groupData = groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    recipientCount: countMap.get(g.id) ?? 0,
  }));

  const configured = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

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
