import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mailSchedules } from "@/db/schema";
import { runSchedule } from "@/lib/mail-runner";
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

  if (due.length === 0) {
    // Recorded so there's evidence the cron is alive even on quiet days.
    await logEvent({
      action: "mail.cron_tick",
      summary: `Reminder cron ran — nothing due (${rows.length} active schedule(s))`,
      entityType: "mail_schedule",
      actorType: "system",
    });
  }

  return Response.json({ checked: rows.length, ran: results.length, results });
}
