/**
 * Shared vocabulary for vehicle bookings — fuel levels, statuses, the mileage
 * sum and the one-time-code rules.
 *
 * Deliberately free of `server-only` and of any request-scoped API: the client
 * grid renders the same labels the server writes into the activity log and the
 * emails, and two lists of fuel levels that could drift is exactly how a form
 * ends up showing "Half" for something stored as "quarter".
 */

import { SAST_OFFSET_MINUTES } from "@/lib/schedules";

export type FuelLevel = "full" | "three_quarters" | "half" | "quarter" | "under_quarter";

/** Ordered fullest-first, which is the order a gauge reads. */
export const FUEL_LEVELS: { value: FuelLevel; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "three_quarters", label: "3 quarters" },
  { value: "half", label: "Half" },
  { value: "quarter", label: "Quarter" },
  { value: "under_quarter", label: "Less than a quarter" },
];

const FUEL_LABELS = new Map(FUEL_LEVELS.map((f) => [f.value, f.label]));

export function fuelLabel(value: FuelLevel | null | undefined): string {
  return value ? (FUEL_LABELS.get(value) ?? value) : "—";
}

export function isFuelLevel(value: unknown): value is FuelLevel {
  return typeof value === "string" && FUEL_LABELS.has(value as FuelLevel);
}

export type VehicleBookingStatus = "out" | "home" | "servicing" | "declined";

/**
 * The words Carl asked for, verbatim. "At Home" is the one people read fastest
 * on a grid — it answers "can I take it?" without any further thought.
 */
export const STATUS_LABELS: Record<VehicleBookingStatus, string> = {
  out: "Vehicle is out",
  home: "At Home",
  servicing: "Vehicle being serviced",
  declined: "Declined",
};

/** Anything that isn't home is unavailable — the two are not the same thing. */
export function isVehicleAvailable(status: VehicleBookingStatus): boolean {
  return status === "home";
}

/** A trip that isn't happening and never will. */
export function isDeclined(status: VehicleBookingStatus): boolean {
  return status === "declined";
}

/**
 * Kilometres travelled. Null until both readings exist, rather than 0 — an
 * unreturned vehicle has not travelled zero kilometres, and showing 0 in the
 * Difference column would say it had.
 */
export function mileageDifference(
  opening: number | null | undefined,
  closing: number | null | undefined,
): number | null {
  if (opening == null || closing == null) return null;
  return closing - opening;
}

/** A vehicle's odometer, formatted the way South Africans read one. */
export function formatMileage(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-ZA").format(value);
}

/** Upper bound on an odometer reading, to catch a hand slipping on the keypad. */
export const MAX_MILEAGE = 9_999_999;

/* ------------------------------------------------------------------ */
/* Refuelling during the trip                                          */
/* ------------------------------------------------------------------ */

export type RefuelPayer = "own_money" | "company_card";

/** Own money first — it's the answer that leads to someone being paid back. */
export const REFUEL_PAYERS: { value: RefuelPayer; label: string }[] = [
  { value: "own_money", label: "My own money" },
  { value: "company_card", label: "Company card" },
];

const PAYER_LABELS = new Map(REFUEL_PAYERS.map((p) => [p.value, p.label]));

export function refuelPayerLabel(value: RefuelPayer | null | undefined): string {
  return value ? (PAYER_LABELS.get(value) ?? value) : "—";
}

/** A sane ceiling on a single fill-up, to catch cents typed as rands. */
export const MAX_REFUEL_AMOUNT = 100_000;

/**
 * Rands, as they're written here. Amounts come back from Postgres `numeric` as
 * strings — deliberately, since that's the only way to not lose the cents — so
 * this takes either.
 */
export function formatRand(amount: string | number | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return `R ${new Intl.NumberFormat("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

/* ------------------------------------------------------------------ */
/* Dates and times, in South African time                              */
/* ------------------------------------------------------------------ */

/**
 * A booking's times are wall-clock times in Johannesburg, and they have to mean
 * the same thing in three places that do NOT share a timezone: the browser
 * (whatever the laptop is set to), the server action (UTC on Vercel), and the
 * cron that decides a vehicle is overdue.
 *
 * So nothing here ever goes through `new Date("2026-08-05T14:30")`, which
 * silently reads the *runtime's* zone. The wall-clock parts are handled
 * explicitly and SAST's fixed +02:00 is applied by hand — there is no DST to
 * account for.
 */

const MINUTE = 60_000;

/** The same instant, shifted so the getUTC* accessors read SAST wall-clock. */
function toSast(date: Date): Date {
  return new Date(date.getTime() + SAST_OFFSET_MINUTES * MINUTE);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** An instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` input expects. */
export function toDateTimeInput(date: Date): string {
  const d = toSast(date);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * The reverse: `YYYY-MM-DDTHH:mm` typed by someone in Johannesburg, as a real
 * instant. Returns null on anything that isn't a complete date and time, so a
 * half-filled field is refused rather than becoming an Invalid Date that
 * compares false against everything.
 */
export function fromDateTimeInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi) - SAST_OFFSET_MINUTES * MINUTE;
  const parsed = new Date(utc);
  // Catches the 31st of a 30-day month, which Date.UTC rolls over rather than
  // rejecting.
  if (toSast(parsed).getUTCDate() !== d) return null;
  return parsed;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-ZA", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Johannesburg",
});

/** How a booking's time is written on screen, in emails and in the log. */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_TIME_FORMAT.format(d);
}

/**
 * "2 hours late", "3 days late" — how overdue something is, in the words the
 * reminder email uses. Deliberately coarse: to the minute would be noise.
 */
export function overdueLabel(due: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - due.getTime()) / MINUTE));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* ------------------------------------------------------------------ */
/* The week timeline                                                   */
/* ------------------------------------------------------------------ */

/**
 * The calendar deliberately does NOT copy the meeting-room one.
 *
 * A room booking is a slice of one working day, so rooms get a 07:00–18:00
 * vertical grid with a day per column. A vehicle goes out on Tuesday afternoon
 * and comes back on Thursday — that shape cannot be drawn on a day grid at all.
 * So vehicles get the other axis: a row per vehicle, the week running left to
 * right, and a bar spanning whatever it spans. It also answers the question
 * that's actually being asked — "which vehicle is free?" — which a
 * one-room-at-a-time view can't.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The instants a week of the calendar covers: SAST midnight on the Monday to
 * SAST midnight on the following Monday.
 *
 * Via `fromDateTimeInput`, so the boundary is a Johannesburg midnight and not
 * whatever midnight the server happens to be in. SAST has no DST, so a week is
 * always exactly seven 24-hour days.
 */
export function weekBounds(mondayKey: string): { startMs: number; endMs: number } {
  const start = fromDateTimeInput(`${mondayKey}T00:00`);
  if (!start) throw new Error(`Not a date key: ${mondayKey}`);
  return { startMs: start.getTime(), endMs: start.getTime() + WEEK_MS };
}

export type TimelineTrip = {
  id: number;
  vehicleId: number;
  /** ISO instants. */
  startAt: string;
  /**
   * Where the bar ends: the actual return for a finished trip, the expected
   * return for an open one — and for an overdue one, now, so it doesn't look
   * as though the vehicle came back on time. Computed on the server, because a
   * clock read during a client render disagrees with the server pass.
   */
  endAt: string;
};

export type TimelineBar<T> = {
  trip: T;
  /** Percentages across the week, for a `left`/`width` style. */
  left: number;
  width: number;
  /** The trip runs on beyond this week's edge, so the bar is cut off. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Which stacked row inside the vehicle's lane this sits on. */
  lane: number;
};

/**
 * Places one vehicle's trips across the week.
 *
 * Lanes exist because two trips can legitimately share a week — one finished on
 * Monday, the next starting Tuesday — and, if data ever lets two overlap, two
 * bars drawn on top of each other would hide one of them completely rather than
 * looking wrong.
 */
export function layOutWeek<T extends TimelineTrip>(
  trips: T[],
  startMs: number,
  endMs: number,
): TimelineBar<T>[] {
  const span = endMs - startMs;
  const withinWeek = trips
    .map((trip) => ({ trip, from: Date.parse(trip.startAt), to: Date.parse(trip.endAt) }))
    .filter((t) => Number.isFinite(t.from) && Number.isFinite(t.to) && t.to > startMs && t.from < endMs)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  // The last end time in each lane, so a trip drops into the first lane it
  // doesn't collide with.
  const laneEnds: number[] = [];

  return withinWeek.map(({ trip, from, to }) => {
    let lane = laneEnds.findIndex((end) => end <= from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(to);
    } else {
      laneEnds[lane] = to;
    }

    const clippedFrom = Math.max(from, startMs);
    const clippedTo = Math.min(to, endMs);
    return {
      trip,
      left: ((clippedFrom - startMs) / span) * 100,
      // A floor, so a fifteen-minute trip is still something you can see and
      // click rather than a hairline.
      width: Math.max(((clippedTo - clippedFrom) / span) * 100, 1.2),
      clippedStart: from < startMs,
      clippedEnd: to > endMs,
      lane,
    };
  });
}

/** Past its expected return and still not back. */
export function isOverdue(
  booking: { status: VehicleBookingStatus; expectedReturnAt: Date | string },
  now: Date = new Date(),
): boolean {
  // A declined trip isn't happening, so nobody is late for it.
  if (booking.status === "home" || booking.status === "declined") return false;
  const due =
    typeof booking.expectedReturnAt === "string"
      ? new Date(booking.expectedReturnAt)
      : booking.expectedReturnAt;
  return due.getTime() < now.getTime();
}
