import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  receptionSlots,
  receptionSwapRequests,
  staff,
  staffTags,
  tags,
} from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import {
  RECEPTION_DEFAULTS,
  RECEPTION_TAG,
  addDays,
  weekStart,
} from "@/lib/reception";
import { ReceptionClient } from "./reception-client";

export const metadata = { title: "Reception Rota — COLAB" };
export const dynamic = "force-dynamic";

function todayISO() {
  // The office is in SAST; the server may not be. Same trick as the schedules.
  return new Date(Date.now() + 120 * 60_000).toISOString().slice(0, 10);
}

export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; date?: string }>;
}) {
  // Everyone can look up who is on the desk; editing it is a separate right.
  await requirePermission("reception.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "reception.manage") : false;

  const params = await searchParams;
  const today = todayISO();
  // `date` is still accepted so old links (and bookmarks) land on the right week.
  const anchor =
    (params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week) && params.week) ||
    (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date) ||
    today;
  const monday = weekStart(anchor);
  const sunday = addDays(monday, 6);

  const slots = await db
    .select({
      id: receptionSlots.id,
      date: receptionSlots.date,
      startMinute: receptionSlots.startMinute,
      endMinute: receptionSlots.endMinute,
      staffId: receptionSlots.staffId,
      assigneeName: staff.name,
    })
    .from(receptionSlots)
    .leftJoin(staff, eq(staff.id, receptionSlots.staffId))
    .where(and(gte(receptionSlots.date, monday), lte(receptionSlots.date, sunday)))
    .orderBy(asc(receptionSlots.date), asc(receptionSlots.startMinute), asc(receptionSlots.id));

  // Only Reception-tagged people may be put on the desk, so that's the whole
  // assignee list — the tag is the single place "who does reception" is set.
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.name, RECEPTION_TAG))
    .limit(1);

  const eligible = tag
    ? await db
        .select({ id: staff.id, name: staff.name, userId: staff.userId })
        .from(staff)
        .innerJoin(staffTags, and(eq(staffTags.staffId, staff.id), eq(staffTags.tagId, tag.id)))
        .where(eq(staff.active, true))
        .orderBy(asc(staff.name))
    : [];

  // Anyone already on a slot stays selectable even if their tag has since been
  // removed, so opening the rota can't silently reassign them.
  const assignedIds = [...new Set(slots.map((s) => s.staffId).filter((v): v is number => !!v))];
  const stragglerIds = assignedIds.filter((id) => !eligible.some((e) => e.id === id));
  const stragglers = stragglerIds.length
    ? await db
        .select({ id: staff.id, name: staff.name, userId: staff.userId })
        .from(staff)
        .where(inArray(staff.id, stragglerIds))
    : [];

  const people = [
    ...eligible.map((p) => ({ ...p, tagged: true })),
    ...stragglers.map((p) => ({ ...p, tagged: false })),
  ];

  // The viewer's own team-member record, if they're on the desk roster — this
  // is what turns the rota from a read-only list into "swap my shift".
  const me = user ? (eligible.find((e) => e.userId === user.id) ?? null) : null;

  const slotIds = slots.map((s) => s.id);
  const swaps = slotIds.length
    ? await db
        .select()
        .from(receptionSwapRequests)
        .where(
          and(
            eq(receptionSwapRequests.status, "pending"),
            inArray(receptionSwapRequests.fromSlotId, slotIds),
          ),
        )
    : [];

  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const pendingSwaps = swaps.map((s) => ({
    id: s.id,
    fromSlotId: s.fromSlotId,
    toSlotId: s.toSlotId,
    requesterName: nameById.get(s.requesterStaffId) ?? "Someone",
    targetName: nameById.get(s.targetStaffId) ?? "someone",
    mine: me != null && s.requesterStaffId === me.id,
    forMe: me != null && s.targetStaffId === me.id,
    message: s.message,
  }));

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

  return (
    <div>
      <PageHeader
        title="Reception Rota"
        description={
          canManage
            ? `Who is on the desk, a week at a time. Generated from team members tagged "${RECEPTION_TAG}", then adjust anything.`
            : `Who is on the desk this week. If one of the shifts is yours, you can ask someone to swap.`
        }
      />
      <ReceptionClient
        monday={monday}
        today={today}
        slots={slots}
        people={people}
        settings={settings}
        canManage={canManage}
        myStaffId={me?.id ?? null}
        pendingSwaps={pendingSwaps}
      />
    </div>
  );
}
