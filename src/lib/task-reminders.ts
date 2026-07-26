import "server-only";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { adminTasks, staff } from "@/db/schema";
import { appBaseUrl, mailConfigured, sendMail, taskAssignedEmail } from "@/lib/mailer";
import { priorityLabel, recurrenceLabel, formatTaskDate } from "@/lib/tasks";

const HOUR = 3_600_000;
// How much time must pass before the next reminder for each cadence. Slightly
// under the nominal period so a once-a-day cron never skips a due reminder.
const THRESHOLD_MS: Record<string, number> = {
  daily: 20 * HOUR,
  weekly: 6.5 * 24 * HOUR,
  monthly: 27 * 24 * HOUR,
};

/**
 * Emails the assignee of each open, recurring task whose reminder cadence is
 * due. Called by the daily mail cron. Best-effort and idempotent within a day
 * (lastReminderAt gates re-sends).
 */
export async function runTaskReminders(): Promise<{ checked: number; sent: number }> {
  if (!mailConfigured()) return { checked: 0, sent: 0 };

  const rows = await db
    .select({
      id: adminTasks.id,
      name: adminTasks.name,
      description: adminTasks.description,
      dueDate: adminTasks.dueDate,
      priority: adminTasks.priority,
      recurrence: adminTasks.recurrence,
      lastReminderAt: adminTasks.lastReminderAt,
      createdByName: adminTasks.createdByName,
      assigneeName: staff.name,
      assigneeEmail: staff.email,
    })
    .from(adminTasks)
    .innerJoin(staff, eq(adminTasks.assigneeStaffId, staff.id))
    .where(
      and(
        eq(adminTasks.status, "open"),
        eq(adminTasks.reminders, true),
        ne(adminTasks.recurrence, "once"),
        isNotNull(staff.email),
      ),
    );

  const now = Date.now();
  const base = await appBaseUrl();
  const tasksUrl = `${base}/admin-tasks`;
  let sent = 0;

  for (const t of rows) {
    if (!t.assigneeEmail) continue;
    const threshold = THRESHOLD_MS[t.recurrence] ?? Infinity;
    const last = t.lastReminderAt ? new Date(t.lastReminderAt).getTime() : 0;
    if (last && now - last < threshold) continue;

    const mail = taskAssignedEmail({
      assigneeName: t.assigneeName,
      taskName: t.name,
      description: t.description,
      dueDate: formatTaskDate(t.dueDate),
      priorityLabel: priorityLabel(t.priority),
      recurrenceLabel: recurrenceLabel(t.recurrence),
      assignedByName: t.createdByName ?? "",
      tasksUrl,
      isReminder: true,
    });
    const res = await sendMail({
      to: t.assigneeEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (res.ok) {
      await db
        .update(adminTasks)
        .set({ lastReminderAt: new Date() })
        .where(eq(adminTasks.id, t.id));
      sent++;
    }
  }

  return { checked: rows.length, sent };
}
