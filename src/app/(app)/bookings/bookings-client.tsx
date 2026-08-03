"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Users,
  TriangleAlert,
  Repeat,
  HandHelping,
  Trash2,
  Briefcase,
  Pencil,
} from "lucide-react";
import {
  cancelBooking,
  createBooking,
  requestSteal,
  updateBooking,
  type BookingState,
} from "@/app/actions/bookings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  DEFAULT_RECURRENCE,
  SLOT_MINUTES,
  addDays,
  describeRecurrence,
  dayShortName,
  expandRecurrence,
  labelToMinute,
  longDateLabel,
  minuteLabel,
  parseDateKey,
  slotStarts,
  weekRangeLabel,
  weekStart,
  type Recurrence,
} from "@/lib/bookings";

type RoomOption = {
  id: number;
  name: string;
  capacity: number;
  color: string | null;
  notes: string;
};

type BookingBlock = {
  id: number;
  title: string;
  date: string;
  startMinute: number;
  endMinute: number;
  bookedByName: string;
  bookedByUserId: number | null;
  /** Set when booked on someone else's behalf — they're a holder too. */
  bookedForName: string | null;
  bookedForUserId: number | null;
  clientName: string | null;
  attendeeCount: number;
  seriesId: string | null;
  recurrenceLabel: string | null;
  attendees: string[];
  attendeeIds: number[];
  pendingRequests: number;
  iAsked: boolean;
  isMine: boolean;
  /** Whether the viewer may edit or cancel it — holder, or an admin. */
  canEdit: boolean;
};

type TeamMember = { id: number; name: string; companyName: string };

const FALLBACK_COLOR = "#0d9488";
const SLOTS = slotStarts();
/** Pixels per minute — sets the height of the grid and of each block. */
const PX_PER_MIN = 0.9;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Recurrence editor — the Outlook shape: frequency, interval, end     */
/* ------------------------------------------------------------------ */

function RecurrenceEditor({
  value,
  onChange,
  startDate,
}: {
  value: Recurrence;
  onChange: (r: Recurrence) => void;
  startDate: string;
}) {
  const set = (patch: Partial<Recurrence>) => onChange({ ...value, ...patch });
  const occurrences = useMemo(
    () => (value.frequency === "none" ? 1 : expandRecurrence(startDate, value).length),
    [startDate, value],
  );

  return (
    <div className="space-y-3 rounded-lg border border-line bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">Repeat</span>
        <Select
          value={value.frequency}
          onChange={(e) => set({ frequency: e.target.value as Recurrence["frequency"] })}
          className="max-w-40"
        >
          <option value="none">Never</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </Select>

        {value.frequency !== "none" && (
          <>
            <span className="text-sm text-slate-700">every</span>
            <Input
              type="number"
              min={1}
              max={12}
              value={value.interval}
              onChange={(e) => set({ interval: Number(e.target.value) || 1 })}
              className="max-w-20"
            />
            <span className="text-sm text-slate-700">
              {value.frequency === "daily" ? "day(s)" : value.frequency === "weekly" ? "week(s)" : "month(s)"}
            </span>
          </>
        )}
      </div>

      {value.frequency === "weekly" && (
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((d, i) => {
            const on = value.weekdays.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  set({
                    weekdays: on
                      ? value.weekdays.filter((w) => w !== i)
                      : [...value.weekdays, i],
                  })
                }
                className={cn(
                  "h-8 w-10 rounded-lg border text-xs font-medium transition-colors",
                  on
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-line bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}

      {value.frequency !== "none" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-700">Ends</span>
          <Select
            value={value.endMode}
            onChange={(e) => set({ endMode: e.target.value as Recurrence["endMode"] })}
            className="max-w-40"
          >
            <option value="count">After</option>
            <option value="date">On date</option>
          </Select>
          {value.endMode === "count" ? (
            <>
              <Input
                type="number"
                min={1}
                max={52}
                value={value.count}
                onChange={(e) => set({ count: Number(e.target.value) || 1 })}
                className="max-w-20"
              />
              <span className="text-sm text-slate-700">occurrences</span>
            </>
          ) : (
            <Input
              type="date"
              value={value.until}
              min={startDate}
              onChange={(e) => set({ until: e.target.value })}
              className="max-w-44"
            />
          )}
        </div>
      )}

      {value.frequency !== "none" && (
        <p className="text-xs text-muted">
          {describeRecurrence(value)} — <strong>{occurrences}</strong> booking
          {occurrences === 1 ? "" : "s"}. Every one has to be free, or nothing is booked.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Book a slot                                                         */
/* ------------------------------------------------------------------ */

function BookingForm({
  room,
  date,
  startMinute,
  teamMembers,
  allUsers,
  currentUserId,
  existing,
  onDone,
}: {
  room: RoomOption;
  date: string;
  startMinute: number;
  teamMembers: TeamMember[];
  allUsers: { id: number; name: string }[];
  currentUserId: number;
  /** Set when editing rather than creating. */
  existing?: BookingBlock;
  onDone: () => void;
}) {
  const editing = !!existing;
  const [state, action] = useActionState<BookingState, FormData>(
    editing ? updateBooking : createBooking,
    {},
  );
  const [start, setStart] = useState(minuteLabel(existing?.startMinute ?? startMinute));
  const [duration, setDuration] = useState(
    existing ? existing.endMinute - existing.startMinute : SLOT_MINUTES,
  );
  const [bookingDate, setBookingDate] = useState(existing?.date ?? date);
  const [recurrence, setRecurrence] = useState<Recurrence>(DEFAULT_RECURRENCE);
  const [attendeeIds, setAttendeeIds] = useState<number[]>(existing?.attendeeIds ?? []);
  const [attendeeCount, setAttendeeCount] = useState(existing?.attendeeCount ?? 1);
  const [bookedForUserId, setBookedForUserId] = useState(existing?.bookedForUserId ?? 0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const startMin = labelToMinute(start) ?? startMinute;
  const endMin = startMin + duration;
  const endsTooLate = endMin > DAY_END_MINUTE;

  const toggleAttendee = (id: number) =>
    setAttendeeIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // The headcount follows the guest list until it's set by hand, which is
      // the number people actually forget to update.
      setAttendeeCount((c) => (c === prev.length + 1 ? next.length + 1 : c));
      return next;
    });

  // 77 people is too many to scan, so the list filters — and anyone already
  // picked stays pinned at the top so they can't be lost behind a search term.
  const picked = teamMembers.filter((m) => attendeeIds.includes(m.id));
  const term = search.trim().toLowerCase();
  const rest = teamMembers.filter(
    (m) =>
      !attendeeIds.includes(m.id) &&
      (term === "" ||
        m.name.toLowerCase().includes(term) ||
        m.companyName.toLowerCase().includes(term)),
  );

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={existing.id} />}
      <input type="hidden" name="roomId" value={room.id} />
      <input type="hidden" name="date" value={bookingDate} />
      <input type="hidden" name="startMinute" value={startMin} />
      <input type="hidden" name="endMinute" value={endMin} />
      <input type="hidden" name="recurrence" value={JSON.stringify(recurrence)} />
      {attendeeIds.map((id) => (
        <input key={id} type="hidden" name="attendeeStaffId" value={id} />
      ))}

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <strong>{room.name}</strong> · seats {room.capacity}
        {room.notes ? ` · ${room.notes}` : ""}
      </div>

      <input type="hidden" name="bookedForUserId" value={bookedForUserId} />

      <Field label="Meeting name">
        <Input
          name="title"
          required
          autoFocus
          maxLength={120}
          defaultValue={existing?.title ?? ""}
          placeholder="e.g. Q3 planning"
        />
      </Field>

      <Field label="Date">
        <Input
          type="date"
          value={bookingDate}
          onChange={(e) => setBookingDate(e.target.value)}
          className="max-w-52"
        />
      </Field>

      <Field
        label="Who is the room for?"
        hint={
          editing
            ? "Change this and the new person is emailed that the meeting is now theirs — and whoever it was for is told it no longer is."
            : "Booking for someone else? They're shown as the holder, and you both get the reminder and any request for the room."
        }
      >
        <Select
          value={bookedForUserId}
          onChange={(e) => setBookedForUserId(Number(e.target.value))}
        >
          {/* Option 0 is "nobody in particular — it belongs to whoever booked
              it". That's the current user on a new booking, but on an edit it's
              the original booker, who may well be someone else. Labelling it
              "Me" there would offer to hand an admin someone else's room. */}
          <option value={0}>
            {editing && existing.bookedByUserId !== currentUserId
              ? `${existing.bookedByName} (booked it)`
              : "Me"}
          </option>
          {allUsers
            .filter((u) => u.id !== (editing ? existing.bookedByUserId : currentUserId))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} step={300} />
        </Field>
        <Field label="For" hint="Book exactly what you need — 20 minutes is fine.">
          <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[10, 15, 20, 30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted">
        {minuteLabel(startMin)} – {minuteLabel(endMin)}
      </p>

      <Field label="Client name" hint="Optional — if this meeting is for a client.">
        <Input name="clientName" maxLength={120} defaultValue={existing?.clientName ?? ""} />
      </Field>

      <Field
        label={`Internal attendees${attendeeIds.length ? ` (${attendeeIds.length})` : ""}`}
        hint="Anyone on the team list, whether or not they have a login. Nobody is emailed — this is who's coming."
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the team…"
          className="mb-2"
        />
        <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line bg-white p-2">
          {picked.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleAttendee(m.id)}
              title={m.companyName}
              className="rounded-full border border-brand-600 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
            >
              {m.name} ×
            </button>
          ))}
          {rest.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleAttendee(m.id)}
              title={m.companyName}
              className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50"
            >
              {m.name}
            </button>
          ))}
          {picked.length === 0 && rest.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted">Nobody matches “{search}”.</p>
          )}
        </div>
      </Field>

      <Field
        label="Number of attendees"
        hint={`Including anyone external. ${room.name} seats ${room.capacity}.`}
      >
        <Input
          name="attendeeCount"
          type="number"
          min={1}
          max={room.capacity}
          value={attendeeCount}
          onChange={(e) => setAttendeeCount(Number(e.target.value) || 1)}
          className="max-w-28"
        />
      </Field>

      {/* Editing changes this one occurrence only — repeating an existing
          booking into new dates would silently create bookings the person
          didn't ask for, and can't be undone from here. */}
      {editing ? (
        existing.recurrenceLabel && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
            Part of a repeating booking ({existing.recurrenceLabel}). Changes here apply to this
            occurrence only.
          </p>
        )
      ) : (
        <RecurrenceEditor value={recurrence} onChange={setRecurrence} startDate={bookingDate} />
      )}

      {endsTooLate && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="h-4 w-4" /> That runs past{" "}
          {minuteLabel(DAY_END_MINUTE)} — shorten it or start earlier.
        </p>
      )}
      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          label={editing ? "Save changes" : "Book the room"}
          busy={editing ? "Saving…" : "Booking…"}
        />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Booking detail + steal                                              */
/* ------------------------------------------------------------------ */

function BookingDetail({
  booking,
  room,
  canManageAny,
  onEdit,
  onDone,
}: {
  booking: BookingBlock;
  room: RoomOption;
  canManageAny: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [state, action] = useActionState<BookingState, FormData>(requestSteal, {});
  const [pending, start] = useTransition();
  const canCancel = booking.isMine || canManageAny;

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  if (asking) {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="bookingId" value={booking.id} />
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          You're asking{" "}
          <strong>
            {booking.bookedForName
              ? `${booking.bookedForName} and ${booking.bookedByName}`
              : booking.bookedByName}
          </strong>{" "}
          for {room.name} on{" "}
          {longDateLabel(booking.date)} at {minuteLabel(booking.startMinute)}. They get an email and
          can approve or decline — the room stays theirs until they say yes.
        </p>
        <Field label="What do you need the room for?">
          <Input name="title" required autoFocus maxLength={120} placeholder="e.g. Client pitch" />
        </Field>
        <Field label="Why is it more important?" hint="They'll see exactly what you write here.">
          <Textarea name="message" required rows={3} maxLength={1000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client name">
            <Input name="clientName" maxLength={120} />
          </Field>
          <Field label="Number of attendees">
            <Input
              name="attendeeCount"
              type="number"
              min={1}
              max={room.capacity}
              defaultValue={1}
            />
          </Field>
        </div>
        {state.error && (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
            Back
          </Button>
          <SubmitButton label="Steal This Room" busy="Sending…" />
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-lg border border-line">
        {[
          ["Room", room.name],
          ["When", `${longDateLabel(booking.date)}, ${minuteLabel(booking.startMinute)} – ${minuteLabel(booking.endMinute)}`],
          ...(booking.bookedForName
            ? ([
                ["Room is for", booking.bookedForName],
                ["Booked by", booking.bookedByName],
              ] as [string, string][])
            : ([["Booked by", booking.bookedByName]] as [string, string][])),
          ["Attendees", String(booking.attendeeCount)],
          ...(booking.clientName ? [["Client", booking.clientName]] : []),
          ...(booking.attendees.length ? [["Internal", booking.attendees.join(", ")]] : []),
          ...(booking.recurrenceLabel ? [["Repeats", booking.recurrenceLabel]] : []),
        ].map(([label, value]) => (
          <div key={label} className="flex gap-3 px-3 py-2 text-sm">
            <dt className="w-28 shrink-0 text-muted">{label}</dt>
            <dd className="text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>

      {booking.pendingRequests > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {booking.pendingRequests} outstanding request
          {booking.pendingRequests === 1 ? "" : "s"} for this slot.
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {canCancel && (
          <>
            <Button variant="outline" onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            {booking.seriesId && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (confirm("Cancel every remaining booking in this series?"))
                    start(() => cancelBooking(booking.id, "series").then(onDone));
                }}
              >
                <Trash2 className="h-4 w-4" /> Cancel series
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (confirm("Cancel this booking?"))
                  start(() => cancelBooking(booking.id, "one").then(onDone));
              }}
            >
              <Trash2 className="h-4 w-4 text-red-500" /> Cancel booking
            </Button>
          </>
        )}
        {!booking.isMine &&
          (booking.iAsked ? (
            <Badge tone="slate">You&apos;ve asked to steal this room</Badge>
          ) : (
            <Button onClick={() => setAsking(true)}>
              <HandHelping className="h-4 w-4" /> Steal This Room
            </Button>
          ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The week grid                                                       */
/* ------------------------------------------------------------------ */

export function BookingsClient({
  rooms,
  selectedRoomId,
  monday,
  days,
  today,
  bookings,
  teamMembers,
  allUsers,
  currentUserId,
  canManageAny,
}: {
  rooms: RoomOption[];
  selectedRoomId: number;
  monday: string;
  days: string[];
  today: string;
  bookings: BookingBlock[];
  teamMembers: TeamMember[];
  allUsers: { id: number; name: string }[];
  currentUserId: number;
  canManageAny: boolean;
}) {
  const router = useRouter();
  const room = rooms.find((r) => r.id === selectedRoomId) ?? rooms[0];
  const color = room.color || FALLBACK_COLOR;

  const [booking, setBooking] = useState<{ date: string; startMinute: number } | null>(null);
  const [viewing, setViewing] = useState<BookingBlock | null>(null);
  const [editing, setEditing] = useState<BookingBlock | null>(null);

  const go = (roomId: number, week: string) =>
    router.push(`/bookings?room=${roomId}&week=${week}`);

  const gridHeight = (DAY_END_MINUTE - DAY_START_MINUTE) * PX_PER_MIN;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select
            value={selectedRoomId}
            onChange={(e) => go(Number(e.target.value), monday)}
            className="max-w-56"
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (seats {r.capacity})
              </option>
            ))}
          </Select>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Users className="h-3 w-3" /> seats {room.capacity}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => go(selectedRoomId, addDays(monday, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-44 text-center text-sm font-medium text-slate-800">
            {weekRangeLabel(monday)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => go(selectedRoomId, addDays(monday, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {/* On the current week this is a label, not an offer; once you've
              navigated away it becomes the way back. A static "This week" that
              stayed put while the dates moved just read as a wrong caption. */}
          {monday === weekStart(today) ? (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              This week
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => go(selectedRoomId, today)}>
              Back to this week
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <div className="min-w-[820px]">
          {/* Day headers */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-line bg-slate-50">
            <div />
            {days.map((d) => {
              const parts = parseDateKey(d);
              return (
                <div
                  key={d}
                  className={cn(
                    "px-2 py-2 text-center text-xs",
                    d === today ? "font-semibold text-brand-700" : "text-slate-600",
                  )}
                >
                  <div>{dayShortName(d)}</div>
                  <div className="text-sm">{parts?.d}</div>
                </div>
              );
            })}
          </div>

          {/* Slots */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)]">
            {/* Time gutter */}
            <div className="relative border-r border-line" style={{ height: gridHeight }}>
              {SLOTS.map((m) => (
                <div
                  key={m}
                  className="absolute left-0 w-full pr-1 text-right text-[10px] text-muted"
                  style={{ top: (m - DAY_START_MINUTE) * PX_PER_MIN - 5 }}
                >
                  {minuteLabel(m)}
                </div>
              ))}
            </div>

            {days.map((day) => {
              const dayBookings = bookings.filter((b) => b.date === day);
              return (
                <div
                  key={day}
                  className="relative border-r border-line last:border-r-0"
                  style={{ height: gridHeight }}
                >
                  {/* Clickable empty slots underneath */}
                  {SLOTS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBooking({ date: day, startMinute: m })}
                      title={`Book ${minuteLabel(m)} on ${longDateLabel(day)}`}
                      className="absolute w-full border-b border-line/70 hover:bg-brand-50"
                      style={{
                        top: (m - DAY_START_MINUTE) * PX_PER_MIN,
                        height: SLOT_MINUTES * PX_PER_MIN,
                      }}
                    />
                  ))}

                  {/* Bookings on top */}
                  {dayBookings.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setViewing(b)}
                      // Double-click jumps straight to editing, which is what
                      // people reach for; single click still shows the detail.
                      onDoubleClick={() => {
                        if (b.canEdit) {
                          setViewing(null);
                          setEditing(b);
                        }
                      }}
                      title={b.canEdit ? "Click for detail, double-click to edit" : undefined}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left transition-shadow hover:shadow-md"
                      style={{
                        top: (b.startMinute - DAY_START_MINUTE) * PX_PER_MIN,
                        height: Math.max(18, (b.endMinute - b.startMinute) * PX_PER_MIN - 2),
                        backgroundColor: `${color}22`,
                        borderColor: `${color}77`,
                      }}
                    >
                      <span className="block truncate text-[11px] font-semibold leading-tight text-slate-900">
                        {b.title}
                      </span>
                      <span className="block truncate text-[10px] leading-tight text-slate-600">
                        {/* Whose meeting it is comes first; who did the booking
                            is the smaller detail. */}
                        {b.bookedForName ?? b.bookedByName} · {b.attendeeCount}
                        {b.attendeeCount === 1 ? " person" : " people"}
                      </span>
                      {b.bookedForName && (
                        <span className="block truncate text-[10px] leading-tight text-slate-500">
                          booked by {b.bookedByName}
                        </span>
                      )}
                      {b.clientName && (
                        <span className="flex items-center gap-1 truncate text-[10px] font-medium leading-tight text-slate-700">
                          <Briefcase className="h-2.5 w-2.5 shrink-0" />
                          {b.clientName}
                        </span>
                      )}
                      <span className="mt-0.5 flex items-center gap-1">
                        {b.recurrenceLabel && <Repeat className="h-2.5 w-2.5 text-slate-500" />}
                        {b.pendingRequests > 0 && (
                          <HandHelping className="h-2.5 w-2.5 text-amber-600" />
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <p className="text-xs text-muted">
        Click any empty slot to book it. Click a booking to see the detail, or to ask whoever has it
        if you can take the room.
      </p>

      {booking && (
        <Modal
          title={`Book ${room.name}`}
          open
          onOpenChange={(o) => !o && setBooking(null)}
          wide
        >
          <BookingForm
            room={room}
            date={booking.date}
            startMinute={booking.startMinute}
            teamMembers={teamMembers}
            allUsers={allUsers}
            currentUserId={currentUserId}
            onDone={() => {
              setBooking(null);
              router.refresh();
            }}
          />
        </Modal>
      )}

      {viewing && (
        <Modal title={viewing.title} open onOpenChange={(o) => !o && setViewing(null)}>
          <BookingDetail
            booking={viewing}
            room={room}
            canManageAny={canManageAny}
            onEdit={() => {
              const b = viewing;
              setViewing(null);
              setEditing(b);
            }}
            onDone={() => {
              setViewing(null);
              router.refresh();
            }}
          />
        </Modal>
      )}

      {editing && (
        <Modal
          title={`Edit ${editing.title}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          wide
        >
          <BookingForm
            room={room}
            date={editing.date}
            startMinute={editing.startMinute}
            teamMembers={teamMembers}
            allUsers={allUsers}
            currentUserId={currentUserId}
            existing={editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
