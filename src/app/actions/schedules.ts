"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mailSchedules } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { runSchedule } from "@/lib/mail-runner";

export type ScheduleState = { error?: string; ok?: boolean };

const schema = z.object({
  name: z.string().trim().min(1, "Give the reminder a name"),
  subject: z.string().trim().min(1, "Add a subject"),
  body: z.string().trim().min(1, "Write the message"),
  audience: z.enum(["groups", "company_contacts"]),
  frequency: z.enum(["monthly", "weekly"]),
});

export async function saveSchedule(
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const user = await requirePermission("mail.send");
  const id = formData.get("id") ? Number(formData.get("id")) : null;

  const parsed = schema.safeParse({
    name: formData.get("name"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    audience: formData.get("audience") ?? "company_contacts",
    frequency: formData.get("frequency") ?? "monthly",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, subject, body, audience, frequency } = parsed.data;

  // Day-of-month is capped at 28 so a monthly reminder exists in February too;
  // the runner clamps to the last day for anyone who wants month-end.
  const dayOfMonth =
    frequency === "monthly" ? Math.min(28, Math.max(1, Number(formData.get("dayOfMonth")) || 25)) : null;
  const dayOfWeek =
    frequency === "weekly" ? Math.min(6, Math.max(0, Number(formData.get("dayOfWeek")) || 0)) : null;

  const groupIds =
    audience === "groups"
      ? formData
          .getAll("groupId")
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n) && n > 0)
      : [];

  if (audience === "groups" && groupIds.length === 0) {
    return { error: "Choose at least one email group." };
  }

  const values = {
    name,
    subject,
    body,
    audience,
    frequency,
    dayOfMonth,
    dayOfWeek,
    groupIds: audience === "groups" ? groupIds : null,
  };

  let scheduleId = id;
  if (id) {
    await db
      .update(mailSchedules)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(mailSchedules.id, id));
  } else {
    const [row] = await db.insert(mailSchedules).values(values).returning();
    scheduleId = row.id;
  }

  await logEvent({
    action: id ? "mail.schedule_update" : "mail.schedule_create",
    summary: `${id ? "Updated" : "Created"} reminder “${name}”`,
    actor: user,
    entityType: "mail_schedule",
    entityId: scheduleId ?? undefined,
    metadata: { audience, frequency, dayOfMonth, dayOfWeek },
  });

  revalidatePath("/mail");
  return { ok: true };
}

export async function setScheduleActive(id: number, active: boolean) {
  const user = await requirePermission("mail.send");
  await db
    .update(mailSchedules)
    .set({ active, updatedAt: new Date() })
    .where(eq(mailSchedules.id, id));
  await logEvent({
    action: "mail.schedule_toggle",
    summary: `${active ? "Resumed" : "Paused"} a scheduled reminder`,
    actor: user,
    entityType: "mail_schedule",
    entityId: id,
  });
  revalidatePath("/mail");
}

export async function deleteSchedule(id: number) {
  const user = await requirePermission("mail.send");
  await db.delete(mailSchedules).where(eq(mailSchedules.id, id));
  await logEvent({
    action: "mail.schedule_delete",
    summary: "Deleted a scheduled reminder",
    actor: user,
    entityType: "mail_schedule",
    entityId: id,
  });
  revalidatePath("/mail");
}

/** Fire a schedule immediately, without waiting for its next due date. */
export async function sendScheduleNow(id: number): Promise<{ error?: string; sent?: number }> {
  const user = await requirePermission("mail.send");
  const [schedule] = await db.select().from(mailSchedules).where(eq(mailSchedules.id, id)).limit(1);
  if (!schedule) return { error: "That reminder no longer exists." };

  const res = await runSchedule(schedule, { trigger: "manual", actorLabel: user.name });
  revalidatePath("/mail");
  if (res.error) return { error: res.error };
  return { sent: res.sent };
}
