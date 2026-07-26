"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Plus,
  Trash2,
  Eraser,
  TriangleAlert,
  Info,
} from "lucide-react";
import {
  generateRota,
  setSlotAssignee,
  setSlotTimes,
  addSlot,
  deleteSlot,
  clearDay,
  type RotaState,
} from "@/app/actions/reception";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { minutesToLabel, labelToMinutes } from "@/lib/reception";

type Person = { id: number; name: string; eligible: boolean };
type Slot = {
  id: number;
  startMinute: number;
  endMinute: number;
  staffId: number | null;
  assigneeName: string | null;
};

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function AssigneeSelect({ slot, people }: { slot: Slot; people: Person[] }) {
  const [, start] = useTransition();
  const eligible = people.filter((p) => p.eligible);
  const others = people.filter((p) => !p.eligible);
  return (
    <select
      defaultValue={slot.staffId ?? ""}
      onChange={(e) =>
        start(() => setSlotAssignee(slot.id, e.target.value ? Number(e.target.value) : null))
      }
      className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
    >
      <option value="">— Unassigned —</option>
      {eligible.length > 0 && (
        <optgroup label="Reception">
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Others">
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function SlotRow({ slot, people }: { slot: Slot; people: Person[] }) {
  const [pending, start] = useTransition();
  const [startT, setStartT] = useState(minutesToLabel(slot.startMinute));
  const [endT, setEndT] = useState(minutesToLabel(slot.endMinute));

  const commit = () => {
    const s = labelToMinutes(startT);
    const e = labelToMinutes(endT);
    if (s == null || e == null || e <= s) {
      setStartT(minutesToLabel(slot.startMinute));
      setEndT(minutesToLabel(slot.endMinute));
      return;
    }
    if (s === slot.startMinute && e === slot.endMinute) return;
    start(() => setSlotTimes(slot.id, s, e));
  };

  const timeInput = "rounded-md border border-line bg-white px-2 py-1 text-sm focus:border-brand-600 focus:outline-none";

  return (
    <div className={pending ? "flex items-center gap-3 px-4 py-2 opacity-60" : "flex items-center gap-3 px-4 py-2"}>
      <div className="flex shrink-0 items-center gap-1">
        <input
          type="time"
          value={startT}
          onChange={(e) => setStartT(e.target.value)}
          onBlur={commit}
          className={timeInput}
        />
        <span className="text-muted">–</span>
        <input
          type="time"
          value={endT}
          onChange={(e) => setEndT(e.target.value)}
          onBlur={commit}
          className={timeInput}
        />
      </div>
      <div className="min-w-0 flex-1">
        <AssigneeSelect slot={slot} people={people} />
      </div>
      <button
        onClick={() => start(() => deleteSlot(slot.id))}
        title="Remove slot"
        className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-500"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ReceptionClient({
  date,
  slots,
  people,
  settings,
}: {
  date: string;
  slots: Slot[];
  people: Person[];
  settings: { startMin: number; endMin: number; slotMin: number };
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<RotaState, FormData>(generateRota, {});
  const [busy, startBusy] = useTransition();

  const [startT, setStartT] = useState(minutesToLabel(settings.startMin));
  const [endT, setEndT] = useState(minutesToLabel(settings.endMin));
  const [slotMin, setSlotMin] = useState(settings.slotMin);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const go = (d: string) => router.push(`/reception?date=${d}`);

  const generate = () => {
    setLocalErr(null);
    const s = labelToMinutes(startT);
    const e = labelToMinutes(endT);
    if (s == null || e == null) return setLocalErr("Enter valid start and end times.");
    if (e <= s) return setLocalErr("End time must be after the start time.");
    if (slots.length > 0 && !confirm(`Replace the current ${slots.length}-slot schedule for this day?`))
      return;
    const fd = new FormData();
    fd.set("date", date);
    fd.set("startMin", String(s));
    fd.set("endMin", String(e));
    fd.set("slotMin", String(slotMin));
    formAction(fd);
  };

  const onAdd = () => {
    const last = slots[slots.length - 1];
    const s = last ? last.endMinute : (labelToMinutes(startT) ?? 540);
    const e = Math.min(s + 30, 1440);
    startBusy(() => addSlot(date, s, e > s ? e : s + 30));
  };

  return (
    <div className="space-y-4">
      {/* Date navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => go(shiftDate(date, -1))} title="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => go(shiftDate(date, 1))} title="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm font-medium text-slate-700">{prettyDate(date)}</p>
      </div>

      {/* Generate controls */}
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">From</span>
          <input
            type="time"
            value={startT}
            onChange={(e) => setStartT(e.target.value)}
            className="rounded-lg border border-line bg-white px-2 py-1.5 focus:border-brand-600 focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">To</span>
          <input
            type="time"
            value={endT}
            onChange={(e) => setEndT(e.target.value)}
            className="rounded-lg border border-line bg-white px-2 py-1.5 focus:border-brand-600 focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Slot (min)</span>
          <input
            type="number"
            min={5}
            step={5}
            value={slotMin}
            onChange={(e) => setSlotMin(Math.max(5, Number(e.target.value) || 30))}
            className="w-20 rounded-lg border border-line bg-white px-2 py-1.5 focus:border-brand-600 focus:outline-none"
          />
        </label>
        <Button onClick={generate} disabled={busy}>
          <RefreshCw className="h-4 w-4" /> {slots.length > 0 ? "Regenerate" : "Generate"}
        </Button>
      </Card>

      {(localErr || state.error) && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {localErr || state.error}
        </p>
      )}
      {state.note && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0" /> {state.note}
        </p>
      )}

      {/* Slot list */}
      {slots.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted">
          No schedule for this day yet. Set your hours above and hit Generate.
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {slots.map((s) => (
            <SlotRow key={s.id} slot={s} people={people} />
          ))}
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onAdd} disabled={busy}>
          <Plus className="h-4 w-4" /> Add slot
        </Button>
        {slots.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (confirm("Clear the whole schedule for this day?")) startBusy(() => clearDay(date));
            }}
            className="text-red-600 hover:bg-red-50"
          >
            <Eraser className="h-4 w-4" /> Clear day
          </Button>
        )}
      </div>
    </div>
  );
}
