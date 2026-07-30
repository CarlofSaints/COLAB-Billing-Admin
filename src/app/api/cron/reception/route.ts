import { runReceptionReminders } from "@/lib/reception-reminders";
import { logEvent } from "@/lib/log";

/**
 * The reception-rota nudge, on its own schedule.
 *
 * Separate from `/api/cron/mail` because it runs on a completely different
 * cadence: the daily dispatcher fires once at 06:00 SAST, this one fires at
 * each of the minutes a shift can begin ten minutes later (see
 * `REMINDER_CRON_MINUTES` and the `crons` entry in vercel.json).
 *
 * Most ticks find nothing due and return in a few milliseconds — the schedule
 * is deliberately shaped to the rota rather than polling every few minutes.
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

  const result = await runReceptionReminders();

  // Only a real send is logged. At ~26 ticks a day, logging the quiet ones
  // would bury every other event in the activity log.
  if (result.sent > 0) {
    await logEvent({
      action: "reception.reminders_sent",
      summary: result.testTo
        ? `Sent ${result.sent} reception shift reminder(s) — TEST MODE, all diverted to ${result.testTo}`
        : `Sent ${result.sent} reception shift reminder(s)`,
      entityType: "reception_slot",
      actorType: "system",
    });
  }

  return Response.json(result);
}
