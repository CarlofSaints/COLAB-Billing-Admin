"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { receptionSlots, staff, staffTags, tags, appSettings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { buildSlotRanges, RECEPTION_TAG } from "@/lib/reception";

export type RotaState = { error?: string; ok?: boolean; note?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const genSchema = z.object({
  date: z.string().trim().refine((v) => DATE.test(v), "Pick a date"),
  startMin: z.coerce.number().int().min(0).max(1439),
  endMin: z.coerce.number().int().min(1).max(1440),
  slotMin: z.coerce.number().int().min(5).max(480),
});

/** Round-robin the pool across companies so consecutive slots alternate. */
function interleaveByCompany<T extends { companyId: number }>(people: T[]): T[] {
  const groups = new Map<number, T[]>();
  for (const p of people) {
    const list = groups.get(p.companyId) ?? [];
    list.push(p);
    groups.set(p.companyId, list);
  }
  const ordered: T[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of groups.values()) {
      const next = list.shift();
      if (next) {
        ordered.push(next);
        added = true;
      }
    }
  }
  return ordered;
}

async function saveSettings(startMin: number, endMin: number, slotMin: number) {
  const pairs: [string, string][] = [
    ["reception_start_min", String(startMin)],
    ["reception_end_min", String(endMin)],
    ["reception_slot_min", String(slotMin)],
  ];
  for (const [key, value] of pairs) {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
}

export async function generateRota(_prev: RotaState, formData: FormData): Promise<RotaState> {
  const actor = await requirePermission("reception.manage");
  const parsed = genSchema.safeParse({
    date: formData.get("date"),
    startMin: formData.get("startMin"),
    endMin: formData.get("endMin"),
    slotMin: formData.get("slotMin"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { date, startMin, endMin, slotMin } = parsed.data;
  if (endMin <= startMin) return { error: "End time must be after the start time." };

  // Eligible pool = active team members tagged "Reception".
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(sql`lower(${tags.name}) = ${RECEPTION_TAG.toLowerCase()}`)
    .limit(1);

  let pool: { id: number; companyId: number }[] = [];
  if (tag) {
    pool = await db
      .select({ id: staff.id, companyId: staff.companyId })
      .from(staff)
      .innerJoin(staffTags, and(eq(staffTags.staffId, staff.id), eq(staffTags.tagId, tag.id)))
      .where(eq(staff.active, true))
      .orderBy(staff.name);
  }
  const ordered = interleaveByCompany(pool);

  const ranges = buildSlotRanges(startMin, endMin, slotMin);

  await db.delete(receptionSlots).where(eq(receptionSlots.date, date));
  if (ranges.length > 0) {
    await db.insert(receptionSlots).values(
      ranges.map((r, i) => ({
        date,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        staffId: ordered.length ? ordered[i % ordered.length].id : null,
      })),
    );
  }
  await saveSettings(startMin, endMin, slotMin);

  await logEvent({
    action: "reception.generate",
    summary: `Generated reception rota for ${date} (${ranges.length} slots)`,
    actor,
    entityType: "reception",
    metadata: { date, slots: ranges.length, poolSize: ordered.length },
  });

  revalidatePath("/reception");
  return {
    ok: true,
    note: ordered.length
      ? undefined
      : `No active team members are tagged "${RECEPTION_TAG}" yet — slots were created empty. Tag people, then regenerate or assign them below.`,
  };
}

export async function setSlotAssignee(slotId: number, staffId: number | null) {
  await requirePermission("reception.manage");
  await db.update(receptionSlots).set({ staffId }).where(eq(receptionSlots.id, slotId));
  revalidatePath("/reception");
}

export async function setSlotTimes(slotId: number, startMinute: number, endMinute: number) {
  await requirePermission("reception.manage");
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > 1440 ||
    endMinute <= startMinute
  ) {
    return;
  }
  await db.update(receptionSlots).set({ startMinute, endMinute }).where(eq(receptionSlots.id, slotId));
  revalidatePath("/reception");
}

export async function addSlot(date: string, startMinute: number, endMinute: number) {
  await requirePermission("reception.manage");
  if (!DATE.test(date) || endMinute <= startMinute) return;
  await db.insert(receptionSlots).values({ date, startMinute, endMinute });
  revalidatePath("/reception");
}

export async function deleteSlot(slotId: number) {
  await requirePermission("reception.manage");
  await db.delete(receptionSlots).where(eq(receptionSlots.id, slotId));
  revalidatePath("/reception");
}

export async function clearDay(date: string) {
  const actor = await requirePermission("reception.manage");
  if (!DATE.test(date)) return;
  await db.delete(receptionSlots).where(eq(receptionSlots.date, date));
  await logEvent({
    action: "reception.clear",
    summary: `Cleared the reception rota for ${date}`,
    actor,
    entityType: "reception",
  });
  revalidatePath("/reception");
}
