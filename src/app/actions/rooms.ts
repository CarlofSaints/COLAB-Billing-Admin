"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type RoomState = { error?: string; ok?: boolean };

const HEX = /^#[0-9a-fA-F]{6}$/;

const roomSchema = z.object({
  name: z.string().trim().min(1, "Give the room a name").max(60),
  capacity: z
    .string()
    .trim()
    .transform((v) => Number(v))
    .refine(
      (v) => Number.isInteger(v) && v >= 1 && v <= 500,
      "Max capacity must be a whole number of people",
    ),
  color: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || HEX.test(v), "Pick a colour"),
  notes: z.string().trim().max(300).optional(),
});

function parse(formData: FormData) {
  return roomSchema.safeParse({
    name: formData.get("name"),
    capacity: String(formData.get("capacity") ?? ""),
    color: formData.get("color") || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
}

function revalidateRoomPaths() {
  revalidatePath("/rooms");
  revalidatePath("/bookings");
}

export async function saveRoom(_prev: RoomState, formData: FormData): Promise<RoomState> {
  const actor = await requirePermission("rooms.manage");
  const id = formData.get("id") ? Number(formData.get("id")) : null;
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, capacity, color, notes } = parsed.data;

  try {
    if (id) {
      await db
        .update(rooms)
        .set({ name, capacity, color: color || null, notes: notes ?? null, updatedAt: new Date() })
        .where(eq(rooms.id, id));
    } else {
      await db
        .insert(rooms)
        .values({ name, capacity, color: color || null, notes: notes ?? null });
    }
  } catch {
    return { error: "A room with that name already exists." };
  }

  await logEvent({
    action: id ? "room.update" : "room.create",
    summary: `${id ? "Updated" : "Added"} meeting room "${name}" (seats ${capacity})`,
    actor,
    entityType: "room",
    entityId: id ?? undefined,
  });

  revalidateRoomPaths();
  return { ok: true };
}

/**
 * Rooms are deactivated, not deleted — bookings cascade from the room, and
 * wiping a room would take every past booking with it along with the record of
 * who had what.
 */
export async function setRoomActive(id: number, active: boolean) {
  const actor = await requirePermission("rooms.manage");
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  if (!room) return;

  await db.update(rooms).set({ active, updatedAt: new Date() }).where(eq(rooms.id, id));
  await logEvent({
    action: active ? "room.reactivate" : "room.retire",
    summary: `${active ? "Brought back" : "Retired"} meeting room "${room.name}"`,
    actor,
    entityType: "room",
    entityId: id,
  });
  revalidateRoomPaths();
}
