"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { hubEvents } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type EventState = { error?: string; ok?: boolean };

const eventSchema = z.object({
  title: z.string().trim().min(1, "Give the event a name"),
  description: z.string().trim().max(1000).optional(),
  eventDate: z
    .string()
    .trim()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date"),
  location: z.string().trim().max(200).optional(),
});

function parse(formData: FormData) {
  return eventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    eventDate: formData.get("eventDate"),
    location: formData.get("location") || undefined,
  });
}

export async function createEvent(_prev: EventState, formData: FormData): Promise<EventState> {
  const user = await requirePermission("events.manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .insert(hubEvents)
    .values({
      title: parsed.data.title,
      description: parsed.data.description || null,
      eventDate: parsed.data.eventDate,
      location: parsed.data.location || null,
    })
    .returning();

  await logEvent({
    action: "event.create",
    summary: `Added team event "${row.title}"`,
    actor: user,
    entityType: "hub_event",
    entityId: row.id,
  });

  revalidatePath("/hub");
  return { ok: true };
}

export async function updateEvent(_prev: EventState, formData: FormData): Promise<EventState> {
  const user = await requirePermission("events.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing event id" };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db
    .update(hubEvents)
    .set({
      title: parsed.data.title,
      description: parsed.data.description || null,
      eventDate: parsed.data.eventDate,
      location: parsed.data.location || null,
      updatedAt: new Date(),
    })
    .where(eq(hubEvents.id, id));

  await logEvent({
    action: "event.update",
    summary: `Updated team event "${parsed.data.title}"`,
    actor: user,
    entityType: "hub_event",
    entityId: id,
  });

  revalidatePath("/hub");
  return { ok: true };
}

export async function deleteEvent(id: number) {
  const user = await requirePermission("events.manage");
  await db.delete(hubEvents).where(eq(hubEvents.id, id));
  await logEvent({
    action: "event.delete",
    summary: `Removed a team event`,
    actor: user,
    entityType: "hub_event",
    entityId: id,
  });
  revalidatePath("/hub");
}
