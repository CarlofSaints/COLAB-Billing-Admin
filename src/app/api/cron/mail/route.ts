import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mailSchedules } from "@/db/schema";
import { runSchedule } from "@/lib/mail-runner";
import { runTaskReminders } from "@/lib/task-reminders";
import { runBookingReminders } from "@/lib/booking-reminders";
import { runWeeklyProfileNudges } from "@/lib/profile-nudges";
import { isDue } from "@/lib/schedules";
import { logEvent } from "@/lib/log";

/**
 * Daily dispatcher for scheduled reminders. Vercel Cron hits this once a day
 * (06:00 SAST); it works out which schedules are due today and sends them.
 * Running it twice in a day is harmless — `isDue` refuses to send a schedule
 * that already went out on the same SAST date.
 */
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  // Without a secret configured, only accept Vercel's own cron invocations.
  return req.headers.get("x-vercel-cron") != null;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const rows = await db.select().from(mailSchedules).where(eq(mailSchedules.active, true));
  const due = rows.filter((s) =>
    isDue({ frequency: s.frequency, dayOfMonth: s.dayOfMonth, dayOfWeek: s.dayOfWeek }, s.lastRunAt),
  );

  const results: { id: number; name: string; sent: number; failed: number; error?: string }[] = [];
  for (const schedule of due) {
    const res = await runSchedule(schedule, { trigger: "cron" });
    results.push({ id: schedule.id, name: schedule.name, ...res });
  }

  // Recurring admin-task reminders share this daily tick.
  const tasks = await runTaskReminders();
  if (tasks.sent > 0) {
    await logEvent({
      action: "task.reminders_sent",
      summary: `Sent ${tasks.sent} recurring task reminder(s)`,
      entityType: "admin_task",
      actorType: "system",
    });
  }

  // As do "your room is booked tomorrow" nudges.
  const bookings = await runBookingReminders();
  if (bookings.sent > 0) {
    await logEvent({
      action: "booking.reminders_sent",
      summary: `Sent ${bookings.sent} room-booking reminder(s) for tomorrow`,
      entityType: "room_booking",
      actorType: "system",
    });
  }

  // And the Monday nudge for people who've never signed in or haven't finished
  // their profile. It no-ops unless somebody has switched it on.
  const nudges = await runWeeklyProfileNudges();
  if (nudges.ran) {
    await logEvent({
      action: "nudge.weekly_run",
      summary:
        `Weekly profile nudges: ${nudges.signInSent} sign-in, ${nudges.profileSent} profile` +
        (nudges.failed ? `, ${nudges.failed} failed` : ""),
      entityType: "user",
      actorType: "system",
    });
  }

  if (due.length === 0 && tasks.sent === 0 && bookings.sent === 0 && !nudges.ran) {
    // Recorded so there's evidence the cron is alive even on quiet days. The
    // nudge reason rides along on purpose: a run that sends nothing has to say
    // WHY, or a switched-off feature and a broken one read identically here.
    await logEvent({
      action: "mail.cron_tick",
      summary:
        `Reminder cron ran — nothing due (${rows.length} active schedule(s))` +
        (nudges.reason ? `. Profile nudges: ${nudges.reason}` : ""),
      entityType: "mail_schedule",
      actorType: "system",
    });
  }

  return Response.json({
    checked: rows.length,
    ran: results.length,
    results,
    taskReminders: tasks,
    bookingReminders: bookings,
    profileNudges: nudges,
  });
}
