import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { receptionSlots, staff, staffTags, tags, appSettings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { RECEPTION_DEFAULTS, RECEPTION_TAG } from "@/lib/reception";
import { ReceptionClient } from "./reception-client";

export const metadata = { title: "Reception Rota — COLAB" };
export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requirePermission("reception.manage");
  const { date: requested } = await searchParams;
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayISO();

  const slots = await db
    .select({
      id: receptionSlots.id,
      startMinute: receptionSlots.startMinute,
      endMinute: receptionSlots.endMinute,
      staffId: receptionSlots.staffId,
      assigneeName: staff.name,
    })
    .from(receptionSlots)
    .leftJoin(staff, eq(staff.id, receptionSlots.staffId))
    .where(eq(receptionSlots.date, date))
    .orderBy(asc(receptionSlots.startMinute), asc(receptionSlots.id));

  const allStaff = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.active, true))
    .orderBy(asc(staff.name));

  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.name, RECEPTION_TAG))
    .limit(1);
  const eligibleRows = tag
    ? await db
        .select({ id: staff.id })
        .from(staff)
        .innerJoin(staffTags, and(eq(staffTags.staffId, staff.id), eq(staffTags.tagId, tag.id)))
        .where(eq(staff.active, true))
    : [];
  const eligibleIds = new Set(eligibleRows.map((r) => r.id));

  const settingRows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(
      inArray(appSettings.key, ["reception_start_min", "reception_end_min", "reception_slot_min"]),
    );
  const sv = new Map(settingRows.map((r) => [r.key, Number(r.value)]));
  const settings = {
    startMin: sv.get("reception_start_min") ?? RECEPTION_DEFAULTS.startMin,
    endMin: sv.get("reception_end_min") ?? RECEPTION_DEFAULTS.endMin,
    slotMin: sv.get("reception_slot_min") ?? RECEPTION_DEFAULTS.slotMin,
  };

  const people = allStaff.map((s) => ({ ...s, eligible: eligibleIds.has(s.id) }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Reception Rota"
        description={`Who's on the reception desk. Auto-generated from team members tagged "${RECEPTION_TAG}", then edit anything.`}
      />
      <ReceptionClient date={date} slots={slots} people={people} settings={settings} />
    </div>
  );
}
