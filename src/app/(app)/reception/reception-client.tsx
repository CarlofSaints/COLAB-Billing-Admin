"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Repeat2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  generateWeek,
  clearDay,
  setSlotAssignee,
  type RotaState,
} from "@/app/actions/reception";
import { requestSwap, withdrawSwap, type SwapState } from "@/app/actions/reception-swaps";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  DAY_NAMES,
  DEFAULT_WEEKDAYS,
  REMINDER_CRON_MINUTES,
  REMINDER_LEAD_MINUTES,
  addDays,
  dayLabel,
  minutesToLabel,
  labelToMinutes,
  unreachableReminderStarts,
  weekLabel,
  weekStart,
} from "@/lib/reception";

type Slot = {
  id: number;
  date: string;
  startMinute: number;
  endMinute: number;
  staffId: number | null;
  assigneeName: string | null;
};
type Person = { id: number; name: string; userId: number | null; tagged: boolean };
type PendingSwap = {
  id: number;
  fromSlotId: number;
  toSlotId: number;
  requesterName: string;
  targetName: string;
  mine: boolean;
  forMe: boolean;
  message: string | null;
};

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Generate a week                                                     */
/* ------------------------------------------------------------------ */

function GenerateWeekForm({
  monday,
  settings,
  onDone,
}: {
  monday: string;
  settings: { startMin: number; endMin: number; slotMin: number };
  onDone: () => void;
}) {
  const [state, action] = useActionState<RotaState, FormData>(generateWeek, {});
  const [start, setStart] = useState(minutesToLabel(settings.startMin));
  const [end, setEnd] = useState(minutesToLabel(settings.endMin));
  const [slotMin, setSlotMin] = useState(settings.slotMin);
  const [days, setDays] = useState<number[]>(DEFAULT_WEEKDAYS);
  const [keepExisting, setKeepExisting] = useState(true);

  const startMin = labelToMinutes(start);
  const endMin = labelToMinutes(end);
  const slotCount =
    startMin != null && endMin != null && endMin > startMin
      ? Math.ceil((endMin - startMin) / slotMin)
      : 0;

  // The reminder cron is a fixed schedule in vercel.json but these times are
  // free-form, so a grid can be built that no tick lines up with. Better to say
  // so here than to let the nudges quietly stop arriving.
  const unreachable =
    startMin != null && endMin != null ? unreachableReminderStarts(startMin, endMin, slotMin) : [];

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="weekStart" value={monday} />
      <input type="hidden" name="startMin" value={startMin ?? ""} />
      <input type="hidden" name="endMin" value={endMin ?? ""} />
      <input type="hidden" name="slotMin" value={slotMin} />
      {days.map((d) => (
        <input key={d} type="hidden" name="weekday" value={d} />
      ))}

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Week of <strong>{weekLabel(monday)}</strong>
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="From">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Slot length">
          <Input
            type="number"
            min={5}
            max={480}
            step={5}
            value={slotMin}
            onChange={(e) => setSlotMin(Number(e.target.value) || 30)}
          />
        </Field>
      </div>

      {unreachable.length > 0 && (
        <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>No reminder for {unreachable.length} of these slots.</strong> The
            &ldquo;you&rsquo;re on the desk in {REMINDER_LEAD_MINUTES} minutes&rdquo; email is
            scheduled for {REMINDER_CRON_MINUTES.map((m) => `:${m}`).join(" and ")} past the hour,
            which only lines up with shifts starting on the hour or half hour. These would go
            unannounced: {unreachable.map(minutesToLabel).join(", ")}.
          </span>
        </p>
      )}

      <Field label="Days">
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((d, i) => {
            const on = days.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  setDays((prev) => (on ? prev.filter((x) => x !== i) : [...prev, i]))
                }
                className={cn(
                  "h-8 w-12 rounded-lg border text-xs font-medium transition-colors",
                  on
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-line bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {d.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-slate-50">
        <input
          type="checkbox"
          name="keepExisting"
          checked={keepExisting}
          onChange={(e) => setKeepExisting(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">
            Leave days that already have a rota alone
          </span>
          <span className="block text-xs text-muted">
            Untick to rebuild the whole week — that discards any swaps and hand edits already made.
          </span>
        </span>
      </label>

      {slotCount > 0 && days.length > 0 && (
        <p className="text-xs text-muted">
          {days.length} day{days.length === 1 ? "" : "s"} × {slotCount} slot
          {slotCount === 1 ? "" : "s"} = <strong>{days.length * slotCount}</strong> shifts. The
          rotation runs straight through the week, so the same person doesn&apos;t open the desk
          every morning.
        </p>
      )}

      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}
      {state.ok && state.note && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{state.note}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          {state.ok ? "Close" : "Cancel"}
        </Button>
        <SubmitButton label="Generate the week" busy="Generating…" />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Ask someone to swap                                                 */
/* ------------------------------------------------------------------ */

function SwapForm({
  mySlot,
  theirSlot,
  theirName,
  onDone,
}: {
  mySlot: Slot;
  theirSlot: Slot;
  theirName: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState<SwapState, FormData>(requestSwap, {});
  const router = useRouter();

  if (state.ok) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.note ?? "Asked."}
        </p>
        <div className="flex justify-end">
          <Button
            onClick={() => {
              onDone();
              router.refresh();
            }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="fromSlotId" value={mySlot.id} />
      <input type="hidden" name="toSlotId" value={theirSlot.id} />

      <div className="rounded-lg border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-sm">
          <span className="text-muted">You give up</span>
          <span className="font-medium text-slate-800">
            {dayLabel(mySlot.date)}, {minutesToLabel(mySlot.startMinute)}–
            {minutesToLabel(mySlot.endMinute)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="text-muted">You take</span>
          <span className="font-medium text-slate-800">
            {dayLabel(theirSlot.date)}, {minutesToLabel(theirSlot.startMinute)}–
            {minutesToLabel(theirSlot.endMinute)}
          </span>
        </div>
      </div>

      <p className="text-sm text-slate-700">
        <strong>{theirName}</strong> gets an email and can agree or decline. The rota only changes
        if they agree.
      </p>

      <Field label="Anything to add?" hint="Optional — they'll see exactly what you write.">
        <Textarea name="message" rows={3} maxLength={1000} placeholder="e.g. dentist at 10" />
      </Field>

      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton label={`Ask ${theirName.split(" ")[0]}`} busy="Asking…" />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The week grid                                                       */
/* ------------------------------------------------------------------ */

export function ReceptionClient({
  monday,
  today,
  slots,
  people,
  settings,
  canManage,
  myStaffId,
  pendingSwaps,
}: {
  monday: string;
  today: string;
  slots: Slot[];
  people: Person[];
  settings: { startMin: number; endMin: number; slotMin: number };
  canManage: boolean;
  /** The viewer's own team-member id, if they're on the desk roster. */
  myStaffId: number | null;
  pendingSwaps: PendingSwap[];
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [swapping, setSwapping] = useState<{ mine: Slot; theirs: Slot; name: string } | null>(null);
  const [pending, start] = useTransition();

  const go = (week: string) => router.push(`/reception?week=${week}`);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  // Only show days that actually have shifts, so a Mon–Fri rota doesn't render
  // two dead weekend columns.
  const activeDays = days.filter((d) => slots.some((s) => s.date === d));

  // Rows are the distinct time bands across the week. Built from the data
  // rather than from the settings, so a day someone has hand-edited still
  // lines up instead of vanishing.
  const bands = useMemo(() => {
    const seen = new Map<string, { startMinute: number; endMinute: number }>();
    for (const s of slots) {
      const key = `${s.startMinute}-${s.endMinute}`;
      if (!seen.has(key)) seen.set(key, { startMinute: s.startMinute, endMinute: s.endMinute });
    }
    return [...seen.values()].sort((a, b) => a.startMinute - b.startMinute);
  }, [slots]);

  const slotAt = (date: string, startMinute: number, endMinute: number) =>
    slots.find(
      (s) => s.date === date && s.startMinute === startMinute && s.endMinute === endMinute,
    ) ?? null;

  const mySlots = myStaffId ? slots.filter((s) => s.staffId === myStaffId) : [];
  const swapForSlot = (slotId: number) =>
    pendingSwaps.find((p) => p.fromSlotId === slotId || p.toSlotId === slotId) ?? null;

  /** The shift of mine nearest to theirs — the one to offer in exchange. */
  const bestOffer = (theirs: Slot): Slot | null => {
    if (mySlots.length === 0) return null;
    const key = (s: Slot) => `${s.date}T${String(s.startMinute).padStart(4, "0")}`;
    const sorted = [...mySlots].sort((a, b) => (key(a) < key(b) ? -1 : 1));
    return sorted.find((s) => key(s) >= key(theirs)) ?? sorted[0];
  };

  const incoming = pendingSwaps.filter((p) => p.forMe);
  const outgoing = pendingSwaps.filter((p) => p.mine);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => go(addDays(monday, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium text-slate-800">
            {weekLabel(monday)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => go(addDays(monday, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {monday === weekStart(today) ? (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              This week
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => go(weekStart(today))}>
              Back to this week
            </Button>
          )}
        </div>

        {canManage && (
          <Button onClick={() => setGenerating(true)}>
            <CalendarRange className="h-4 w-4" /> Generate the week
          </Button>
        )}
      </div>

      {incoming.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Repeat2 className="h-4 w-4 text-brand-700" /> Swap requests for you
              </CardTitle>
              <CardDescription>
                Check your email to agree or decline — the links take you straight there.
              </CardDescription>
            </div>
            <Badge tone="brand">{incoming.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-700">
            {incoming.map((s) => (
              <p key={s.id}>
                <strong>{s.requesterName}</strong> would like to swap with you.
                {s.message ? ` “${s.message}”` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {outgoing.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Repeat2 className="h-4 w-4 text-slate-500" /> Swaps you have asked for
              </CardTitle>
              <CardDescription>Nothing changes until they agree.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {outgoing.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700">
                  Waiting on <strong>{s.targetName}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => start(() => withdrawSwap(s.id).then(() => router.refresh()))}
                >
                  <X className="h-3.5 w-3.5" /> Withdraw
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeDays.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted">
              No rota for this week yet.
              {canManage
                ? " Generate it and then adjust anything that needs adjusting."
                : " An admin hasn't set it up yet."}
            </p>
            {canManage && (
              <Button className="mt-4" onClick={() => setGenerating(true)}>
                <CalendarRange className="h-4 w-4" /> Generate the week
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-slate-50">
                <th className="w-24 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  Time
                </th>
                {activeDays.map((d) => (
                  <th key={d} className="px-2 py-2 text-center">
                    <div
                      className={cn(
                        "text-xs font-semibold",
                        d === today ? "text-brand-700" : "text-slate-700",
                      )}
                    >
                      {dayLabel(d)}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Clear the whole of ${dayLabel(d)}?`))
                            start(() => clearDay(d).then(() => router.refresh()));
                        }}
                        className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-2.5 w-2.5" /> clear
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((band) => (
                <tr key={`${band.startMinute}-${band.endMinute}`} className="border-b border-line">
                  <td className="px-3 py-1.5 text-xs text-muted">
                    {minutesToLabel(band.startMinute)}–{minutesToLabel(band.endMinute)}
                  </td>
                  {activeDays.map((d) => {
                    const slot = slotAt(d, band.startMinute, band.endMinute);
                    if (!slot) return <td key={d} className="px-2 py-1.5" />;

                    const isMine = myStaffId != null && slot.staffId === myStaffId;
                    const swap = swapForSlot(slot.id);
                    const offer = !isMine && slot.staffId ? bestOffer(slot) : null;

                    return (
                      <td
                        key={d}
                        className={cn(
                          "px-2 py-1.5 align-middle",
                          isMine && "bg-brand-50/60",
                        )}
                      >
                        {canManage ? (
                          <select
                            defaultValue={slot.staffId ?? ""}
                            disabled={pending}
                            onChange={(e) =>
                              start(() =>
                                setSlotAssignee(
                                  slot.id,
                                  e.target.value ? Number(e.target.value) : null,
                                ).then(() => router.refresh()),
                              )
                            }
                            className="w-full rounded-md border border-line bg-white px-1.5 py-1 text-xs focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                          >
                            <option value="">— Unassigned —</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.tagged ? "" : " (untagged)"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={cn(
                              "block truncate text-xs",
                              slot.assigneeName ? "text-slate-800" : "text-slate-400",
                            )}
                          >
                            {slot.assigneeName ?? "—"}
                          </span>
                        )}

                        <div className="mt-0.5 flex items-center gap-1">
                          {isMine && (
                            <span className="text-[10px] font-medium text-brand-700">You</span>
                          )}
                          {swap && (
                            <span className="text-[10px] text-amber-600">swap pending</span>
                          )}
                          {/* Swapping is offered to anyone on the roster, and
                              only where they have a shift of their own to give
                              in exchange. */}
                          {!isMine && !swap && offer && slot.staffId && (
                            <button
                              type="button"
                              onClick={() =>
                                setSwapping({
                                  mine: offer,
                                  theirs: slot,
                                  name: slot.assigneeName ?? "them",
                                })
                              }
                              className="text-[10px] font-medium text-brand-700 hover:underline"
                            >
                              swap
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {myStaffId == null && (
        <p className="text-xs text-muted">
          Only people tagged “Reception” — with a login linked to their team-member record — can
          ask to swap a shift.
        </p>
      )}

      {generating && (
        <Modal title="Generate the reception rota" open onOpenChange={setGenerating} wide>
          <GenerateWeekForm
            monday={monday}
            settings={settings}
            onDone={() => {
              setGenerating(false);
              router.refresh();
            }}
          />
        </Modal>
      )}

      {swapping && (
        <Modal
          title={`Swap with ${swapping.name}`}
          open
          onOpenChange={(o) => !o && setSwapping(null)}
        >
          <SwapForm
            mySlot={swapping.mine}
            theirSlot={swapping.theirs}
            theirName={swapping.name}
            onDone={() => setSwapping(null)}
          />
        </Modal>
      )}
    </div>
  );
}
