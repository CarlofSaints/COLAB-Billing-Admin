"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  CalendarDays,
  Car,
  Clock,
  HandHelping,
  Plus,
  Receipt,
  Rows3,
  Search,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import {
  cancelVehicleBooking,
  createVehicleBooking,
  extendVehicleBooking,
  requestVehicleSteal,
  returnVehicleBooking,
  type VehicleBookingState,
  type VehicleConflict,
} from "@/app/actions/vehicle-bookings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TR, TD, SortableTH } from "@/components/ui/table";
import { useTableSort } from "@/lib/use-table-sort";
import { VehicleCalendar } from "./vehicle-calendar";
import { brandFor } from "@/lib/brands";
import { cn } from "@/lib/utils";
import {
  FUEL_LEVELS,
  REFUEL_PAYERS,
  STATUS_LABELS,
  formatDateTime,
  formatMileage,
  formatRand,
  fuelLabel,
  mileageDifference,
  refuelPayerLabel,
  toDateTimeInput,
  type FuelLevel,
  type RefuelPayer,
  type VehicleBookingStatus,
} from "@/lib/vehicle-bookings";

type FleetVehicle = {
  id: number;
  name: string;
  nickname: string | null;
  regNumber: string;
  companyName: string;
  /** Whether this vehicle's returns have to carry odometer readings. */
  mileageRequired: boolean;
  lastMileage: number | null;
  /** Physically away right now. A label on the option, never a gate — a
   *  vehicle that is out today can still be booked for next week. */
  outNow: boolean;
};

type BookableUser = { id: number; name: string; email: string };

export type BookingRow = {
  id: number;
  vehicleId: number;
  vehicleName: string;
  vehicleNickname: string | null;
  vehicleReg: string;
  vehicleCompanyName: string;
  vehicleMileageRequired: boolean;
  bookedByUserId: number | null;
  bookedByName: string;
  bookedForUserId: number | null;
  bookedForName: string | null;
  openingMileage: number | null;
  closingMileage: number | null;
  openingFuel: FuelLevel | null;
  closingFuel: FuelLevel | null;
  status: VehicleBookingStatus;
  notes: string | null;
  takenOutAt: string;
  expectedReturnAt: string;
  returnedAt: string | null;
  refuelled: boolean;
  refuelPaidBy: RefuelPayer | null;
  refuelAmount: string | null;
  hasReceipt: boolean;
  /** Worked out on the server against its own clock — see the page query. */
  overdue: boolean;
  overdueFor: string | null;
  barEndAt: string;
  canReturn: boolean;
  canCancel: boolean;
  canSeeReceipt: boolean;
};

type Scope = {
  companyName: string | null;
  /** Companies beyond their own that a Director has granted them. */
  extraCompanyNames: string[];
  reason: "own_company" | "granted" | "super_admin" | "no_team_record";
};

const STATUS_TONE: Record<VehicleBookingStatus, "amber" | "green" | "violet"> = {
  out: "amber",
  home: "green",
  servicing: "violet",
};

/** Rounded up to the next quarter hour — nobody books a vehicle for 14:07. */
function nextQuarterHour(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

function hoursFrom(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function SubmitButton({
  label,
  busy,
  disabled,
}: {
  label: string;
  busy: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? busy : label}
    </Button>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {message}
    </p>
  );
}

/** Fuel as pills rather than a dropdown — five coarse steps read faster open. */
function FuelPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: FuelLevel | "";
  onChange: (v: FuelLevel) => void;
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-1.5">
        {FUEL_LEVELS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value === f.value
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-line text-slate-500 hover:bg-slate-50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Signing a vehicle out — times only                                 */
/* ------------------------------------------------------------------ */

function BookingForm({
  fleet,
  allUsers,
  currentUserId,
  onDone,
  onAskFor,
}: {
  fleet: FleetVehicle[];
  allUsers: BookableUser[];
  currentUserId: number;
  onDone: () => void;
  /** The vehicle was taken — carry the attempt into a request for it. */
  onAskFor: (intent: StealIntent) => void;
}) {
  const [state, action] = useActionState<VehicleBookingState, FormData>(
    createVehicleBooking,
    {},
  );
  // Every vehicle they may book is offered. Whether it is free for the times
  // they picked is decided on submit, against the register.
  const available = fleet;
  const [vehicleId, setVehicleId] = useState(available[0]?.id ?? 0);
  const [bookedForUserId, setBookedForUserId] = useState(0);
  const [forService, setForService] = useState(false);
  const [search, setSearch] = useState("");

  // Computed once on mount, not per render: a value derived from `new Date()`
  // inside the render body would differ between the server pass and the client
  // pass and trip a hydration mismatch.
  const [takenOn, setTakenOn] = useState(() => toDateTimeInput(nextQuarterHour()));
  const [dueBack, setDueBack] = useState(() =>
    toDateTimeInput(hoursFrom(nextQuarterHour(), 2)),
  );

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  // Compared as strings, which is safe precisely because the format is
  // zero-padded `YYYY-MM-DDTHH:mm` — lexical order is chronological order, and
  // no Date is constructed in the browser's timezone to get there.
  const returnBeforeStart = takenOn !== "" && dueBack !== "" && dueBack <= takenOn;

  const term = search.trim().toLowerCase();
  const matches = term
    ? allUsers.filter(
        (u) =>
          u.id !== currentUserId &&
          (u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)),
      )
    : allUsers.filter((u) => u.id !== currentUserId);
  const chosen = allUsers.find((u) => u.id === bookedForUserId) ?? null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="bookedForUserId" value={bookedForUserId} />
      <input type="hidden" name="forService" value={forService ? "yes" : "no"} />

      <Field label="Vehicle" hint="Only the vehicles you're allowed to book are listed.">
        <Select
          value={vehicleId}
          onChange={(e) => setVehicleId(Number(e.target.value))}
          required
        >
          {available.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.nickname ? ` “${v.nickname}”` : ""} · {v.regNumber} · {v.companyName}
              {v.outNow ? " · out now" : ""}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Taking the vehicle on" hint="Date and time.">
          <Input
            name="takenOutAt"
            type="datetime-local"
            required
            value={takenOn}
            onChange={(e) => setTakenOn(e.target.value)}
          />
        </Field>
        <Field label="Expecting to return the vehicle on" hint="Date and time.">
          <Input
            name="expectedReturnAt"
            type="datetime-local"
            required
            value={dueBack}
            onChange={(e) => setDueBack(e.target.value)}
          />
        </Field>
      </div>
      {returnBeforeStart && (
        <p className="-mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {`The expected return has to be after the time you're taking the vehicle.`}
        </p>
      )}

      <Field
        label="Who is taking the vehicle?"
        hint="Booking it for someone else? They'll be emailed about it, and they can sign it back in too."
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Driver:</span>
          <span className="rounded-full border border-brand-600 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
            {chosen ? chosen.name : "Me"}
          </span>
          {chosen && (
            <button
              type="button"
              onClick={() => setBookedForUserId(0)}
              className="text-xs font-medium text-muted underline underline-offset-2 hover:text-slate-700"
            >
              back to me
            </button>
          )}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
        />
        <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line bg-white p-2">
          <button
            type="button"
            onClick={() => setBookedForUserId(0)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              bookedForUserId === 0
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-line text-slate-500 hover:bg-slate-50",
            )}
          >
            Me
          </button>
          {matches.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setBookedForUserId(u.id)}
              title={u.email}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                bookedForUserId === u.id
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line text-slate-500 hover:bg-slate-50",
              )}
            >
              {u.name}
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted">Nobody matches “{search}”.</p>
          )}
        </div>
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50">
        <input
          type="checkbox"
          checked={forService}
          onChange={(e) => setForService(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-600 focus:ring-brand-100"
        />
        <span>
          Taking it in for a service
          <span className="mt-0.5 block text-xs text-muted">
            Shows as “{STATUS_LABELS.servicing}” in the grid instead of “{STATUS_LABELS.out}”.
          </span>
        </span>
      </label>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
        {`That's everything. The mileage, the fuel and anything you spend are filled in when you
        bring the vehicle back.`}
      </p>

      {state.error && <ErrorLine message={state.error} />}

      {/* Blocked, not refused. The conflict names who has it and turns into an
          offer to ask them for it — which is the only useful next move, since
          the alternative is guessing at another window. */}
      {state.conflict && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{state.conflict.holderName}</strong>
              {state.conflict.overdue
                ? ` still has ${state.conflict.vehicleName} — it was due back ${state.conflict.toLabel}.`
                : ` has ${state.conflict.vehicleName} booked from ${state.conflict.fromLabel} to ${state.conflict.toLabel}.`}
            </span>
          </p>
          {state.conflict.isMine ? (
            <p className="text-xs">
              {`That's your own booking. Extend it from the list instead of booking it twice.`}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  onAskFor({
                    conflict: state.conflict!,
                    vehicleId,
                    takenOutAt: takenOn,
                    expectedReturnAt: dueBack,
                    bookedForUserId,
                    forService,
                  })
                }
              >
                <HandHelping className="h-4 w-4" /> Ask {state.conflict.holderName} for it
              </Button>
              <span className="text-xs">Or change the times, or pick another vehicle.</span>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          label="Take the vehicle"
          busy="Saving…"
          disabled={!vehicleId || takenOn === "" || dueBack === "" || returnBeforeStart}
        />
      </div>
    </form>
  );
}

/** Everything `requestVehicleSteal` needs, carried out of the booking form. */
export type StealIntent = {
  conflict: VehicleConflict;
  vehicleId: number;
  takenOutAt: string;
  expectedReturnAt: string;
  bookedForUserId: number;
  forService: boolean;
};

/**
 * "Can I have it?" — the message the holder will be deciding on.
 *
 * Deliberately a second step rather than a field on the booking form: the
 * common case is that the vehicle is free and nobody has to write anything.
 */
function AskForVehicleForm({
  intent,
  onDone,
}: {
  intent: StealIntent;
  onDone: () => void;
}) {
  const [state, action] = useActionState<VehicleBookingState, FormData>(
    requestVehicleSteal,
    {},
  );

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bookingId" value={intent.conflict.bookingId} />
      <input type="hidden" name="vehicleId" value={intent.vehicleId} />
      <input type="hidden" name="takenOutAt" value={intent.takenOutAt} />
      <input type="hidden" name="expectedReturnAt" value={intent.expectedReturnAt} />
      <input type="hidden" name="bookedForUserId" value={intent.bookedForUserId} />
      <input type="hidden" name="forService" value={intent.forService ? "yes" : "no"} />

      <dl className="rounded-lg border border-line px-3 py-2.5 text-sm">
        {[
          ["Vehicle", intent.conflict.vehicleName],
          ["Who has it", intent.conflict.holderName],
          ["They have it", `${intent.conflict.fromLabel} – ${intent.conflict.toLabel}`],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-0.5">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      <Field
        label="Why do you need it?"
        hint={`${intent.conflict.holderName} sees this word for word, and decides on it.`}
      >
        <Textarea name="message" required rows={3} maxLength={500} autoFocus />
      </Field>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
        {`Nothing changes unless they agree. If they do, the vehicle is booked for you
        automatically and their booking is shortened or given up — you'll be emailed either way.`}
      </p>

      {state.error && <ErrorLine message={state.error} />}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton label="Send the request" busy="Sending…" />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Pushing the deadline out                                            */
/* ------------------------------------------------------------------ */

function ExtendForm({ booking, onDone }: { booking: BookingRow; onDone: () => void }) {
  const [state, action] = useActionState<VehicleBookingState, FormData>(
    extendVehicleBooking,
    {},
  );
  const [dueBack, setDueBack] = useState(() =>
    toDateTimeInput(hoursFrom(new Date(booking.expectedReturnAt), 2)),
  );
  const takenOn = toDateTimeInput(new Date(booking.takenOutAt));

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const beforeStart = dueBack !== "" && dueBack <= takenOn;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bookingId" value={booking.id} />

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <strong>{booking.vehicleName}</strong>
        {booking.vehicleNickname ? ` “${booking.vehicleNickname}”` : ""} · {booking.vehicleReg}
        <span className="mt-0.5 block text-xs text-muted">
          Taken on {formatDateTime(booking.takenOutAt)}, due back{" "}
          {formatDateTime(booking.expectedReturnAt)}.
        </span>
      </div>

      <Field label="New expected return" hint="Date and time.">
        <Input
          name="expectedReturnAt"
          type="datetime-local"
          required
          autoFocus
          value={dueBack}
          onChange={(e) => setDueBack(e.target.value)}
        />
      </Field>
      {beforeStart && (
        <p className="-mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {`That's before the vehicle was taken.`}
        </p>
      )}

      {state.error && <ErrorLine message={state.error} />}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          label="Extend the booking"
          busy="Saving…"
          disabled={dueBack === "" || beforeStart}
        />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Signing it back in — everything is recorded here                    */
/* ------------------------------------------------------------------ */

function ReturnForm({
  booking,
  lastMileage,
  onDone,
}: {
  booking: BookingRow;
  /** The last closing reading for this vehicle, as a sanity check. */
  lastMileage: number | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState<VehicleBookingState, FormData>(
    returnVehicleBooking,
    {},
  );
  const mileageRequired = booking.vehicleMileageRequired;

  const [openingMileage, setOpeningMileage] = useState(
    lastMileage != null ? String(lastMileage) : "",
  );
  const [closingMileage, setClosingMileage] = useState("");
  const [openingFuel, setOpeningFuel] = useState<FuelLevel | "">("");
  const [closingFuel, setClosingFuel] = useState<FuelLevel | "">("");
  const [refuelled, setRefuelled] = useState<boolean | null>(null);
  const [paidBy, setPaidBy] = useState<RefuelPayer | "">("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const open = Number(openingMileage);
  const close = Number(closingMileage);
  const bothMileages =
    openingMileage !== "" &&
    closingMileage !== "" &&
    Number.isFinite(open) &&
    Number.isFinite(close);
  const closingBelowOpening = bothMileages && close < open;
  const distance = bothMileages && !closingBelowOpening ? close - open : null;

  // Every question that has to be answered before this can be saved, in one
  // place so the button and the server agree about what "complete" means.
  const incomplete =
    openingFuel === "" ||
    closingFuel === "" ||
    refuelled === null ||
    (mileageRequired && (openingMileage === "" || closingMileage === "")) ||
    (refuelled === true && (paidBy === "" || amount.trim() === ""));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bookingId" value={booking.id} />
      <input type="hidden" name="refuelled" value={refuelled ? "yes" : "no"} />

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <strong>{booking.vehicleName}</strong>
        {booking.vehicleNickname ? ` “${booking.vehicleNickname}”` : ""} · {booking.vehicleReg}
        <span className="mt-0.5 block text-xs text-muted">
          Taken on {formatDateTime(booking.takenOutAt)} by{" "}
          {booking.bookedForName ?? booking.bookedByName}, due back{" "}
          {formatDateTime(booking.expectedReturnAt)}.
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={mileageRequired ? "Opening mileage" : "Opening mileage (optional)"}
          hint={
            lastMileage != null
              ? `Last recorded reading: ${formatMileage(lastMileage)} km.`
              : "What the odometer read when you took the vehicle."
          }
        >
          <Input
            name="openingMileage"
            type="number"
            inputMode="numeric"
            min={0}
            required={mileageRequired}
            value={openingMileage}
            onChange={(e) => setOpeningMileage(e.target.value)}
          />
        </Field>
        <Field
          label={mileageRequired ? "Closing mileage" : "Closing mileage (optional)"}
          hint="What it reads now."
        >
          <Input
            name="closingMileage"
            type="number"
            inputMode="numeric"
            min={0}
            required={mileageRequired}
            value={closingMileage}
            onChange={(e) => setClosingMileage(e.target.value)}
          />
        </Field>
      </div>
      {closingBelowOpening && (
        <p className="-mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {`The closing reading is less than the opening one — an odometer doesn't run backwards, so check the numbers.`}
        </p>
      )}
      {distance != null && (
        <p className="-mt-2 text-xs text-muted">
          Distance travelled: <strong>{formatMileage(distance)} km</strong>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fuel when you took it">
          <FuelPicker name="openingFuel" value={openingFuel} onChange={setOpeningFuel} />
        </Field>
        <Field label="Fuel now">
          <FuelPicker name="closingFuel" value={closingFuel} onChange={setClosingFuel} />
        </Field>
      </div>

      <Field
        label="Notes"
        hint="Optional — anything worth knowing, like a scratch or a warning light."
      >
        <Textarea name="notes" maxLength={1000} rows={2} />
      </Field>

      {/* The follow-up questions only exist once the answer is yes. Nothing
          under here is rendered — and nothing under here is accepted by the
          server — while the answer is no. */}
      <Field label="Did you have to put fuel in the vehicle?">
        <div className="flex gap-2">
          {[
            { on: true, label: "Yes" },
            { on: false, label: "No" },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => {
                setRefuelled(opt.on);
                if (!opt.on) {
                  // Cleared, not just hidden: answering yes, filling it in and
                  // then switching to no must not leave an amount behind.
                  setPaidBy("");
                  setAmount("");
                }
              }}
              className={cn(
                "rounded-full border px-4 py-1 text-sm font-medium transition-colors",
                refuelled === opt.on
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line text-slate-500 hover:bg-slate-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      {refuelled === true && (
        <div className="space-y-4 rounded-lg border border-line bg-slate-50/60 px-3 py-3">
          <Field label="Did you use your own money or a company card?">
            <input type="hidden" name="refuelPaidBy" value={paidBy} />
            <div className="flex flex-wrap gap-2">
              {REFUEL_PAYERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaidBy(opt.value)}
                  className={cn(
                    "rounded-full border px-4 py-1 text-sm font-medium transition-colors",
                    paidBy === opt.value
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-line bg-white text-slate-500 hover:bg-slate-50",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="What did the fuel cost?" hint="Rands, as it appears on the slip.">
            <Input
              name="refuelAmount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-40"
            />
          </Field>

          <Field
            label="Add a photo of the receipt"
            hint={
              paidBy === "own_money"
                ? "Optional, but this is what gets you paid back — attach it if you have it."
                : "Optional. JPG, PNG or HEIC, up to 6 MB."
            }
          >
            <Input
              name="refuelReceipt"
              type="file"
              accept="image/*"
              // Opens the camera straight away on a phone, which is where the
              // slip is most likely to be photographed.
              capture="environment"
              className="file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
            />
          </Field>
        </div>
      )}

      {state.error && <ErrorLine message={state.error} />}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          label="Book the vehicle in"
          busy="Saving…"
          disabled={incomplete || closingBelowOpening}
        />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The grid                                                            */
/* ------------------------------------------------------------------ */

export function VehicleBookingsClient({
  bookings,
  fleet,
  allUsers,
  currentUserId,
  currentUserEmail,
  todayKey,
  scope,
}: {
  bookings: BookingRow[];
  fleet: FleetVehicle[];
  allUsers: BookableUser[];
  currentUserId: number;
  currentUserEmail: string;
  todayKey: string;
  scope: Scope;
}) {
  // The calendar leads, because "can I take a vehicle?" is what people open
  // this page to find out. The list is the record, and it's one click away.
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [booking, setBooking] = useState(false);
  const [asking, setAsking] = useState<StealIntent | null>(null);
  const [returning, setReturning] = useState<BookingRow | null>(null);
  const [extending, setExtending] = useState<BookingRow | null>(null);
  const [viewing, setViewing] = useState<BookingRow | null>(null);
  const [search, setSearch] = useState("");
  const [showFinished, setShowFinished] = useState(true);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Booking is never gated on the fleet being idle any more — a vehicle that is
  // out today can be booked for next week. The only thing that stops the button
  // is having no vehicles at all.
  const anyAvailable = fleet.length > 0;
  const lastMileageFor = useMemo(
    () => new Map(fleet.map((v) => [v.id, v.lastMileage])),
    [fleet],
  );

  // The calendar takes every trip, not the filtered list — the week it's
  // showing is the filter, and hiding finished trips there would leave gaps
  // that read as "the vehicle was free" when it wasn't.
  const calendarTrips = useMemo(
    () => bookings.map((b) => ({ ...b, startAt: b.takenOutAt, endAt: b.barEndAt })),
    [bookings],
  );

  /**
   * Clicking a bar does what clicking a row does: opens the return for the
   * people who can fill it in, and the read-only detail for everyone else.
   */
  const openTrip = (id: number) => {
    const found = bookings.find((b) => b.id === id);
    if (!found) return;
    if (found.canReturn) setReturning(found);
    else setViewing(found);
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (!showFinished && b.status === "home") return false;
      if (!term) return true;
      return [
        b.vehicleName,
        b.vehicleNickname,
        b.vehicleReg,
        b.vehicleCompanyName,
        b.bookedForName ?? b.bookedByName,
      ]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(term));
    });
  }, [bookings, search, showFinished]);

  const { sorted, sort, toggle } = useTableSort(
    filtered,
    {
      vehicle: (b) => b.vehicleName,
      driver: (b) => b.bookedForName ?? b.bookedByName,
      taken: (b) => b.takenOutAt,
      due: (b) => b.expectedReturnAt,
      opening: (b) => b.openingMileage,
      closing: (b) => b.closingMileage,
      difference: (b) => mileageDifference(b.openingMileage, b.closingMileage),
      fuel: (b) => (b.closingFuel ? fuelLabel(b.closingFuel) : null),
      spent: (b) => (b.refuelAmount == null ? null : Number(b.refuelAmount)),
      status: (b) => STATUS_LABELS[b.status],
    },
    { key: "due", dir: "asc" },
  );

  // Named in the order they'd be said out loud: own company first, then the
  // ones a Director added.
  const allowedNames = [scope.companyName, ...scope.extraCompanyNames].filter(
    Boolean,
  ) as string[];

  // Why the vehicle list is what it is. Worth saying out loud: an empty
  // dropdown with no explanation reads as a broken page, and the two ways it
  // happens here are both fixable by a person, not by a developer.
  const scopeNote =
    scope.reason === "no_team_record" ? (
      <Card className="mb-4 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>{`Your login isn't linked to a team member record`}</strong>
        {`, so there's no way to tell which company's vehicles you may book. Ask an admin to add you to the Team Members list using this address (${currentUserEmail}).`}
      </Card>
    ) : fleet.length === 0 ? (
      <Card className="mb-4 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>There are no vehicles you can book.</strong>{" "}
        {`You can book ${allowedNames.join(" and ")} vehicles, and none are registered. A Director can add another company on your team member record.`}
      </Card>
    ) : (
      <p className="mb-4 text-xs text-muted">
        {`You're booking ${allowedNames.join(" and ")} vehicles. A Director can add another company on your team member record.`}
      </p>
    );

  const overdueCount = bookings.filter((b) => b.overdue).length;

  return (
    <div className="space-y-4">
      {scopeNote}
      {overdueCount > 0 && (
        <Card className="border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>
            {overdueCount} {overdueCount === 1 ? "vehicle is" : "vehicles are"} past the expected
            return time.
          </strong>{" "}
          {`Sign it back in if it's back, or extend the booking.`}
        </Card>
      )}
      {cancelError && <ErrorLine message={cancelError} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {[
            { key: "calendar" as const, label: "Calendar", icon: CalendarDays },
            { key: "list" as const, label: "List", icon: Rows3 },
          ].map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === v.key
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-500 hover:bg-slate-50",
              )}
            >
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          ))}
        </div>

        {/* Searching and hiding finished trips belong to the list. On the
            calendar the week is the filter, and a search box that quietly did
            nothing would be worse than no search box. */}
        {view === "list" && bookings.length > 0 && (
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vehicle or driver…"
              className="pl-9"
            />
          </div>
        )}
        {view === "list" && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showFinished}
              onChange={(e) => setShowFinished(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-line text-brand-600 focus:ring-brand-100"
            />
            Show trips that are done
          </label>
        )}
        <Button
          className="ml-auto"
          disabled={!anyAvailable}
          title={
            anyAvailable
              ? undefined
              : "There are no vehicles you can book."
          }
          onClick={() => setBooking(true)}
        >
          <Plus className="h-4 w-4" /> Book a vehicle
        </Button>
      </div>

      {view === "calendar" ? (
        fleet.length === 0 ? (
          <EmptyState
            icon={<Car className="h-8 w-8" />}
            title="No vehicles to show"
            description="There are no vehicles you can book, so there's nothing to put on a calendar."
          />
        ) : (
          <VehicleCalendar
            vehicles={fleet}
            trips={calendarTrips}
            todayKey={todayKey}
            onOpen={openTrip}
          />
        )
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title="No vehicle has been booked yet"
          description="Sign a vehicle out and it appears here until it's brought back and booked in."
          action={
            anyAvailable ? <Button onClick={() => setBooking(true)}>Book a vehicle</Button> : undefined
          }
        />
      ) : sorted.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted">
          Nothing matches “{search}”.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <SortableTH sortKey="vehicle" sort={sort} onSort={toggle}>
                  Vehicle
                </SortableTH>
                <SortableTH sortKey="driver" sort={sort} onSort={toggle}>
                  Taken by
                </SortableTH>
                <SortableTH sortKey="taken" sort={sort} onSort={toggle}>
                  Taken on
                </SortableTH>
                <SortableTH sortKey="due" sort={sort} onSort={toggle}>
                  Due back
                </SortableTH>
                <SortableTH sortKey="opening" sort={sort} onSort={toggle} className="text-right">
                  Opening km
                </SortableTH>
                <SortableTH sortKey="closing" sort={sort} onSort={toggle} className="text-right">
                  Closing km
                </SortableTH>
                <SortableTH sortKey="difference" sort={sort} onSort={toggle} className="text-right">
                  Difference
                </SortableTH>
                <SortableTH sortKey="fuel" sort={sort} onSort={toggle}>
                  Fuel
                </SortableTH>
                <SortableTH sortKey="spent" sort={sort} onSort={toggle} className="text-right">
                  Fuel bought
                </SortableTH>
                <SortableTH sortKey="status" sort={sort} onSort={toggle}>
                  Status
                </SortableTH>
                <th className="border-b border-line" />
              </TR>
            </THead>
            <tbody>
              {sorted.map((b) => {
                const diff = mileageDifference(b.openingMileage, b.closingMileage);
                const brand = brandFor(b.vehicleCompanyName);
                return (
                  <TR
                    key={b.id}
                    // The whole row opens the return, which is what Carl asked
                    // for — but only for the people entitled to fill it in, so
                    // it isn't a click that leads to a refusal. A finished trip
                    // opens its detail instead, which is where the notes and
                    // the receipt live.
                    onClick={b.canReturn ? () => setReturning(b) : () => setViewing(b)}
                    className="cursor-pointer"
                    title={b.canReturn ? "Book the vehicle in" : "See the trip"}
                  >
                    <TD>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: brand.color }}
                          title={b.vehicleCompanyName}
                        />
                        <span className="font-medium text-slate-900">{b.vehicleName}</span>
                      </div>
                      <span className="text-xs text-muted">
                        {b.vehicleNickname ? `“${b.vehicleNickname}” · ` : ""}
                        {b.vehicleReg}
                      </span>
                    </TD>
                    <TD>
                      {b.bookedForName ?? b.bookedByName}
                      {b.bookedForName && (
                        <span className="block text-xs text-muted">
                          booked by {b.bookedByName}
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDateTime(b.takenOutAt)}</TD>
                    <TD className="whitespace-nowrap">
                      {formatDateTime(b.expectedReturnAt)}
                      {b.overdueFor && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                          <Clock className="h-3 w-3" />
                          {b.overdueFor}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{formatMileage(b.openingMileage)}</TD>
                    <TD className="text-right tabular-nums">{formatMileage(b.closingMileage)}</TD>
                    <TD className="text-right tabular-nums font-medium text-slate-900">
                      {diff == null ? "—" : `${formatMileage(diff)} km`}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {b.openingFuel || b.closingFuel
                        ? `${fuelLabel(b.openingFuel)} → ${fuelLabel(b.closingFuel)}`
                        : "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {b.refuelled ? (
                        <span className="inline-flex items-center gap-1">
                          {formatRand(b.refuelAmount)}
                          {b.hasReceipt && (
                            <Receipt className="h-3 w-3 text-muted" aria-label="receipt attached" />
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <Badge tone={b.overdue ? "red" : STATUS_TONE[b.status]}>
                        {b.overdue ? "Overdue" : STATUS_LABELS[b.status]}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {b.canReturn && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReturning(b);
                              }}
                            >
                              Book in
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Keeping it longer — push the expected return out"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExtending(b);
                              }}
                            >
                              Extend
                            </Button>
                          </>
                        )}
                        {b.canCancel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            title="Booked by mistake — remove it"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                !confirm(
                                  `Remove the booking of ${b.vehicleName}? Use this only if it was booked by mistake — it deletes the record rather than booking the vehicle in.`,
                                )
                              )
                                return;
                              setCancelError(null);
                              start(async () => {
                                const res = await cancelVehicleBooking(b.id);
                                if (res?.error) setCancelError(res.error);
                              });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-slate-500" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {booking && (
        <Modal title="Book a vehicle" open onOpenChange={setBooking}>
          <BookingForm
            fleet={fleet}
            allUsers={allUsers}
            currentUserId={currentUserId}
            onDone={() => setBooking(false)}
            onAskFor={(intent) => {
              setBooking(false);
              setAsking(intent);
            }}
          />
        </Modal>
      )}
      {asking && (
        <Modal
          title={`Ask ${asking.conflict.holderName} for ${asking.conflict.vehicleName}`}
          open
          onOpenChange={(o) => !o && setAsking(null)}
        >
          <AskForVehicleForm intent={asking} onDone={() => setAsking(null)} />
        </Modal>
      )}
      {returning && (
        <Modal
          title={`Book in ${returning.vehicleName}`}
          open
          onOpenChange={(o) => !o && setReturning(null)}
        >
          <ReturnForm
            booking={returning}
            lastMileage={lastMileageFor.get(returning.vehicleId) ?? null}
            onDone={() => setReturning(null)}
          />
        </Modal>
      )}
      {extending && (
        <Modal
          title={`Extend ${extending.vehicleName}`}
          open
          onOpenChange={(o) => !o && setExtending(null)}
        >
          <ExtendForm booking={extending} onDone={() => setExtending(null)} />
        </Modal>
      )}
      {viewing && (
        <Modal
          title={`${viewing.vehicleName} · ${viewing.vehicleReg}`}
          open
          onOpenChange={(o) => !o && setViewing(null)}
        >
          <TripDetail booking={viewing} onDone={() => setViewing(null)} />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A finished trip, read-only. The grid can't show notes or a receipt without
 * becoming unreadable, so they live here — reachable by clicking any row that
 * isn't yours to fill in.
 */
function TripDetail({ booking, onDone }: { booking: BookingRow; onDone: () => void }) {
  const diff = mileageDifference(booking.openingMileage, booking.closingMileage);
  const rows: [string, string][] = [
    ["Driver", booking.bookedForName ?? booking.bookedByName],
    ...(booking.bookedForName
      ? ([["Booked by", booking.bookedByName]] as [string, string][])
      : []),
    ["Taken on", formatDateTime(booking.takenOutAt)],
    ["Due back", formatDateTime(booking.expectedReturnAt)],
    ...(booking.returnedAt
      ? ([["Returned", formatDateTime(booking.returnedAt)]] as [string, string][])
      : []),
    ...(booking.openingMileage != null
      ? ([["Opening mileage", `${formatMileage(booking.openingMileage)} km`]] as [string, string][])
      : []),
    ...(booking.closingMileage != null
      ? ([["Closing mileage", `${formatMileage(booking.closingMileage)} km`]] as [string, string][])
      : []),
    ...(diff != null
      ? ([["Distance travelled", `${formatMileage(diff)} km`]] as [string, string][])
      : []),
    ...(booking.openingFuel || booking.closingFuel
      ? ([
          ["Fuel out / back", `${fuelLabel(booking.openingFuel)} → ${fuelLabel(booking.closingFuel)}`],
        ] as [string, string][])
      : []),
    ...(booking.refuelled
      ? ([
          [
            "Fuel bought",
            `${formatRand(booking.refuelAmount)}, ${refuelPayerLabel(booking.refuelPaidBy).toLowerCase()}`,
          ],
        ] as [string, string][])
      : []),
  ];

  return (
    <div className="space-y-4">
      <dl className="rounded-lg border border-line px-3 py-2.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-0.5">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {booking.notes && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
          <p className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {booking.notes}
          </p>
        </div>
      )}

      {booking.hasReceipt &&
        (booking.canSeeReceipt ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              Fuel receipt
            </p>
            {/* Served from the private Blob store through an authenticated
                route, which re-checks entitlement — this flag only decides
                whether it's worth showing the image at all. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/vehicle-receipt/${booking.id}`}
              alt="Fuel receipt"
              className="max-h-96 w-full rounded-lg border border-line object-contain"
            />
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
            A photo of the fuel receipt is attached. Only the driver and whoever looks after the
            fleet can open it.
          </p>
        ))}

      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  );
}
