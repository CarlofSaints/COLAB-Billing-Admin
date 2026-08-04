"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Car, KeyRound, Mail, Plus, Search, TriangleAlert, Trash2 } from "lucide-react";
import {
  cancelVehicleBooking,
  cancelVehicleReturn,
  confirmVehicleReturn,
  createVehicleBooking,
  requestVehicleReturnOtp,
  type VehicleBookingState,
} from "@/app/actions/vehicle-bookings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TR, TD, SortableTH } from "@/components/ui/table";
import { useTableSort } from "@/lib/use-table-sort";
import { brandFor } from "@/lib/brands";
import { cn } from "@/lib/utils";
import {
  FUEL_LEVELS,
  OTP_TTL_MINUTES,
  STATUS_LABELS,
  formatMileage,
  fuelLabel,
  mileageDifference,
  type FuelLevel,
  type VehicleBookingStatus,
} from "@/lib/vehicle-bookings";

type FleetVehicle = {
  id: number;
  name: string;
  nickname: string | null;
  regNumber: string;
  companyName: string;
  lastMileage: number | null;
  available: boolean;
};

type BookableUser = { id: number; name: string; email: string };

export type BookingRow = {
  id: number;
  vehicleId: number;
  vehicleName: string;
  vehicleNickname: string | null;
  vehicleReg: string;
  vehicleCompanyName: string;
  bookedByUserId: number | null;
  bookedByName: string;
  bookedForUserId: number | null;
  bookedForName: string | null;
  openingMileage: number;
  closingMileage: number | null;
  openingFuel: FuelLevel;
  closingFuel: FuelLevel | null;
  status: VehicleBookingStatus;
  notes: string | null;
  takenOutAt: string;
  returnedAt: string | null;
  canReturn: boolean;
  canCancel: boolean;
  hasLiveOtp: boolean;
  pendingClosingMileage: number | null;
  pendingClosingFuel: FuelLevel | null;
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
/* Signing a vehicle out                                              */
/* ------------------------------------------------------------------ */

function BookingForm({
  fleet,
  allUsers,
  currentUserId,
  onDone,
}: {
  fleet: FleetVehicle[];
  allUsers: BookableUser[];
  currentUserId: number;
  onDone: () => void;
}) {
  const [state, action] = useActionState<VehicleBookingState, FormData>(
    createVehicleBooking,
    {},
  );
  const available = fleet.filter((v) => v.available);
  const [vehicleId, setVehicleId] = useState(available[0]?.id ?? 0);
  const [openingFuel, setOpeningFuel] = useState<FuelLevel | "">("");
  const [bookedForUserId, setBookedForUserId] = useState(0);
  const [forService, setForService] = useState(false);
  const [search, setSearch] = useState("");
  // Held against the vehicle it was typed for, so switching vehicle falls back
  // to that vehicle's own last reading without an effect resetting the field
  // (which would fight anyone mid-type).
  const [typedMileage, setTypedMileage] = useState<{ vehicleId: number; value: string } | null>(
    null,
  );

  const vehicle = available.find((v) => v.id === vehicleId) ?? null;

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  // Start from the last reading rather than an empty box — most trips begin
  // exactly where the previous one ended, and a prefilled number is one people
  // correct rather than invent.
  const mileage =
    typedMileage?.vehicleId === vehicleId
      ? typedMileage.value
      : vehicle?.lastMileage != null
        ? String(vehicle.lastMileage)
        : "";
  const setMileage = (value: string) => setTypedMileage({ vehicleId, value });

  const entered = Number(mileage);
  // A warning, not a block: odometers get replaced and readings get corrected,
  // and refusing the truth because it disagrees with history is worse.
  const belowLast =
    vehicle?.lastMileage != null && mileage !== "" && Number.isFinite(entered)
      ? entered < vehicle.lastMileage
      : false;

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
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Opening mileage"
        hint={
          vehicle?.lastMileage != null
            ? `Last recorded reading for this vehicle: ${formatMileage(vehicle.lastMileage)} km.`
            : "The odometer reading as you take the vehicle over."
        }
      >
        <Input
          name="openingMileage"
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={mileage}
          onChange={(e) => setMileage(e.target.value)}
          className="max-w-40"
        />
      </Field>
      {belowLast && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {`That's lower than the last recorded reading of ${formatMileage(vehicle!.lastMileage)} km. Worth a second look at the odometer — it'll still save if it's right.`}
        </p>
      )}

      <Field label="Opening fuel level" hint="Roughly — whatever the gauge is showing.">
        <FuelPicker name="openingFuel" value={openingFuel} onChange={setOpeningFuel} />
      </Field>

      <Field
        label="Who is taking the vehicle?"
        hint="Booking it for someone else? They can sign it back in too, with a code sent to their own address."
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

      <Field label="Notes" hint="Optional — where it's going, or anything already wrong with it.">
        <Textarea name="notes" maxLength={500} rows={2} />
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

      {state.error && <ErrorLine message={state.error} />}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          label="Take the vehicle"
          busy="Saving…"
          disabled={!vehicleId || openingFuel === "" || mileage === ""}
        />
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Signing it back in                                                  */
/* ------------------------------------------------------------------ */

/**
 * The return, in two steps: readings, then the code that proves who entered
 * them. The step is driven by what the server says has happened, not by a local
 * flag — so a refresh mid-return comes back to the code, and doesn't quietly
 * send a second one.
 */
function ReturnForm({
  booking,
  onDone,
}: {
  booking: BookingRow;
  onDone: () => void;
}) {
  const [otpState, sendOtp] = useActionState<VehicleBookingState, FormData>(
    requestVehicleReturnOtp,
    {},
  );
  const [confirmState, confirm] = useActionState<VehicleBookingState, FormData>(
    confirmVehicleReturn,
    {},
  );
  const [closingFuel, setClosingFuel] = useState<FuelLevel | "">(
    booking.pendingClosingFuel ?? "",
  );
  const [closingMileage, setClosingMileage] = useState(
    booking.pendingClosingMileage != null ? String(booking.pendingClosingMileage) : "",
  );
  const [pending, start] = useTransition();

  // A code already in flight for this person survives a refresh; otherwise the
  // second step only appears once the send actually succeeded.
  const awaitingCode = booking.hasLiveOtp || otpState.otpSent === true;

  useEffect(() => {
    if (confirmState.ok) onDone();
  }, [confirmState.ok, onDone]);

  const entered = Number(closingMileage);
  const valid = closingMileage !== "" && Number.isFinite(entered);
  const belowOpening = valid && entered < booking.openingMileage;
  const distance = valid && !belowOpening ? entered - booking.openingMileage : null;

  if (awaitingCode) {
    return (
      <form action={confirm} className="space-y-4">
        <input type="hidden" name="bookingId" value={booking.id} />

        <div className="flex items-start gap-3 rounded-lg bg-brand-50 px-3 py-3 text-sm text-slate-700">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div>
            <p className="font-medium text-slate-900">Check your email for the code</p>
            <p className="mt-0.5 text-xs text-muted">
              {otpState.otpSentTo
                ? `Sent to ${otpState.otpSentTo}. `
                : "A code is waiting on this booking. "}
              It expires {OTP_TTL_MINUTES} minutes after it was sent.
            </p>
          </div>
        </div>

        <dl className="rounded-lg border border-line px-3 py-2.5 text-sm">
          <div className="flex justify-between py-0.5">
            <dt className="text-muted">Closing mileage</dt>
            <dd className="font-medium text-slate-900">
              {formatMileage(booking.pendingClosingMileage)} km
            </dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-muted">Distance travelled</dt>
            <dd className="font-medium text-slate-900">
              {formatMileage(
                mileageDifference(booking.openingMileage, booking.pendingClosingMileage),
              )}{" "}
              km
            </dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-muted">Fuel on return</dt>
            <dd className="font-medium text-slate-900">{fuelLabel(booking.pendingClosingFuel)}</dd>
          </div>
        </dl>

        <Field label="Code from your email">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={9}
            placeholder="000000"
            className="max-w-40 text-center text-lg tracking-[0.3em]"
          />
        </Field>

        {confirmState.error && <ErrorLine message={confirmState.error} />}
        {otpState.error && <ErrorLine message={otpState.error} />}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              // Closing the form shouldn't leave a live code sitting on the row.
              start(async () => {
                await cancelVehicleReturn(booking.id);
                onDone();
              })
            }
          >
            Start over
          </Button>
          <SubmitButton label="Sign the vehicle in" busy="Checking…" />
        </div>
      </form>
    );
  }

  return (
    <form action={sendOtp} className="space-y-4">
      <input type="hidden" name="bookingId" value={booking.id} />

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <strong>{booking.vehicleName}</strong>
        {booking.vehicleNickname ? ` “${booking.vehicleNickname}”` : ""} · {booking.vehicleReg}
        <span className="mt-0.5 block text-xs text-muted">
          Taken out at {formatMileage(booking.openingMileage)} km, tank{" "}
          {fuelLabel(booking.openingFuel).toLowerCase()}, by{" "}
          {booking.bookedForName ?? booking.bookedByName}.
        </span>
      </div>

      <Field label="Closing mileage" hint="The odometer reading now the trip is done.">
        <Input
          name="closingMileage"
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={closingMileage}
          onChange={(e) => setClosingMileage(e.target.value)}
          className="max-w-40"
        />
      </Field>
      {belowOpening && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {`That's less than the opening mileage of ${formatMileage(booking.openingMileage)} km — an odometer doesn't run backwards, so check the reading.`}
        </p>
      )}
      {distance != null && (
        <p className="-mt-2 text-xs text-muted">
          Distance travelled: <strong>{formatMileage(distance)} km</strong>
        </p>
      )}

      <Field label="Closing fuel level">
        <FuelPicker name="closingFuel" value={closingFuel} onChange={setClosingFuel} />
      </Field>

      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        When you submit, a one-time code is emailed to you. Enter it to confirm the vehicle is
        back.
      </p>

      {otpState.error && <ErrorLine message={otpState.error} />}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          label="Submit and email me a code"
          busy="Sending…"
          disabled={closingFuel === "" || closingMileage === "" || belowOpening}
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
  scope,
}: {
  bookings: BookingRow[];
  fleet: FleetVehicle[];
  allUsers: BookableUser[];
  currentUserId: number;
  currentUserEmail: string;
  scope: Scope;
}) {
  const [booking, setBooking] = useState(false);
  const [returning, setReturning] = useState<BookingRow | null>(null);
  const [search, setSearch] = useState("");
  const [showFinished, setShowFinished] = useState(true);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const anyAvailable = fleet.some((v) => v.available);

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
      nickname: (b) => b.vehicleNickname,
      driver: (b) => b.bookedForName ?? b.bookedByName,
      opening: (b) => b.openingMileage,
      closing: (b) => b.closingMileage,
      difference: (b) => mileageDifference(b.openingMileage, b.closingMileage),
      openingFuel: (b) => fuelLabel(b.openingFuel),
      closingFuel: (b) => (b.closingFuel ? fuelLabel(b.closingFuel) : null),
      status: (b) => STATUS_LABELS[b.status],
      taken: (b) => b.takenOutAt,
    },
    { key: "taken", dir: "desc" },
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

  return (
    <div className="space-y-4">
      {scopeNote}
      {cancelError && <ErrorLine message={cancelError} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {bookings.length > 0 && (
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
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showFinished}
            onChange={(e) => setShowFinished(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line text-brand-600 focus:ring-brand-100"
          />
          Show trips that are done
        </label>
        <Button
          className="ml-auto"
          disabled={!anyAvailable}
          title={
            anyAvailable
              ? undefined
              : "Every vehicle you can book is already out — one has to be signed back in first."
          }
          onClick={() => setBooking(true)}
        >
          <Plus className="h-4 w-4" /> Book a vehicle
        </Button>
      </div>

      {bookings.length === 0 ? (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title="No vehicle has been booked yet"
          description="Sign a vehicle out and it appears here, with its mileage and fuel, until it's signed back in."
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
                <SortableTH sortKey="nickname" sort={sort} onSort={toggle}>
                  Nickname
                </SortableTH>
                <SortableTH sortKey="driver" sort={sort} onSort={toggle}>
                  Taken by
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
                <SortableTH sortKey="openingFuel" sort={sort} onSort={toggle}>
                  Opening fuel
                </SortableTH>
                <SortableTH sortKey="closingFuel" sort={sort} onSort={toggle}>
                  Closing fuel
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
                    // it isn't a click that leads to a refusal.
                    onClick={b.canReturn ? () => setReturning(b) : undefined}
                    className={cn(b.canReturn && "cursor-pointer")}
                    title={b.canReturn ? "Fill in the return" : undefined}
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
                      <span className="text-xs text-muted">{b.vehicleReg}</span>
                    </TD>
                    <TD>{b.vehicleNickname ? `“${b.vehicleNickname}”` : "—"}</TD>
                    <TD>
                      {b.bookedForName ?? b.bookedByName}
                      {b.bookedForName && (
                        <span className="block text-xs text-muted">
                          booked by {b.bookedByName}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{formatMileage(b.openingMileage)}</TD>
                    <TD className="text-right tabular-nums">{formatMileage(b.closingMileage)}</TD>
                    <TD className="text-right tabular-nums font-medium text-slate-900">
                      {diff == null ? "—" : `${formatMileage(diff)} km`}
                    </TD>
                    <TD>{fuelLabel(b.openingFuel)}</TD>
                    <TD>{fuelLabel(b.closingFuel)}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABELS[b.status]}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {b.canReturn && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReturning(b);
                            }}
                          >
                            {b.hasLiveOtp ? "Enter code" : "Book in"}
                          </Button>
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
                                  `Remove the booking of ${b.vehicleName}? Use this only if it was booked by mistake — it deletes the record rather than signing the vehicle in.`,
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
          />
        </Modal>
      )}
      {returning && (
        <Modal
          title={`Sign in ${returning.vehicleName}`}
          open
          onOpenChange={(o) => !o && setReturning(null)}
        >
          <ReturnForm booking={returning} onDone={() => setReturning(null)} />
        </Modal>
      )}
    </div>
  );
}
