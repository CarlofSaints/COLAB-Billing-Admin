"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addDays, dayShortName, parseDateKey, weekDays, weekRangeLabel, weekStart } from "@/lib/bookings";
import { brandFor } from "@/lib/brands";
import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  formatDateTime,
  layOutWeek,
  weekBounds,
  type VehicleBookingStatus,
} from "@/lib/vehicle-bookings";

/** What the timeline needs off a booking — a subset of the grid's row type. */
export type CalendarTrip = {
  id: number;
  vehicleId: number;
  vehicleName: string;
  vehicleReg: string;
  bookedByName: string;
  bookedForName: string | null;
  status: VehicleBookingStatus;
  overdue: boolean;
  takenOutAt: string;
  expectedReturnAt: string;
  returnedAt: string | null;
  /** Where the bar ends — see TimelineTrip; computed on the server. */
  barEndAt: string;
  startAt: string;
  endAt: string;
};

export type CalendarVehicle = {
  id: number;
  name: string;
  nickname: string | null;
  regNumber: string;
  companyName: string;
};

/**
 * Bar colour says what the row means at a glance, so the legend below it is a
 * reminder rather than the only way to read the chart.
 */
const BAR_STYLE: Record<"overdue" | VehicleBookingStatus, string> = {
  overdue: "bg-red-500/90 text-white",
  out: "bg-amber-400/90 text-amber-950",
  servicing: "bg-violet-400/90 text-violet-950",
  home: "bg-slate-300/90 text-slate-700",
};

const ROW_HEIGHT = 34;
const LANE_HEIGHT = 26;

export function VehicleCalendar({
  vehicles,
  trips,
  todayKey,
  onOpen,
}: {
  vehicles: CalendarVehicle[];
  trips: CalendarTrip[];
  /** Today in SAST, decided on the server so the first render can't disagree. */
  todayKey: string;
  onOpen: (tripId: number) => void;
}) {
  const [monday, setMonday] = useState(() => weekStart(todayKey));
  const days = useMemo(() => weekDays(monday), [monday]);
  const { startMs, endMs } = useMemo(() => weekBounds(monday), [monday]);

  // One lane layout per vehicle, so each row knows how tall it has to be.
  const rows = useMemo(
    () =>
      vehicles.map((vehicle) => {
        const bars = layOutWeek(
          trips.filter((t) => t.vehicleId === vehicle.id),
          startMs,
          endMs,
        );
        const lanes = bars.reduce((max, b) => Math.max(max, b.lane + 1), 0);
        return { vehicle, bars, lanes };
      }),
    [vehicles, trips, startMs, endMs],
  );

  const thisWeek = weekStart(todayKey);
  const busyCount = rows.filter((r) => r.bars.length > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {busyCount === 0
            ? `Nothing booked this week — every vehicle is free.`
            : `${busyCount} of ${rows.length} ${rows.length === 1 ? "vehicle has" : "vehicles have"} a trip this week.`}
        </p>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setMonday(addDays(monday, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-44 text-center text-sm font-medium text-slate-800">
            {weekRangeLabel(monday)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setMonday(addDays(monday, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {/* On the current week this is a label, not an offer — the same rule
              the room calendar follows. */}
          {monday === thisWeek ? (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              This week
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setMonday(thisWeek)}>
              Back to this week
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <div className="min-w-[760px]">
          {/* Day headers */}
          <div className="grid grid-cols-[180px_1fr] border-b border-line bg-slate-50">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Vehicle
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const parts = parseDateKey(d);
                return (
                  <div
                    key={d}
                    className={cn(
                      "border-l border-line px-2 py-2 text-center text-xs",
                      d === todayKey ? "font-semibold text-brand-700" : "text-slate-600",
                    )}
                  >
                    <div>{dayShortName(d)}</div>
                    <div className="text-sm">{parts?.d}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {rows.map(({ vehicle, bars, lanes }) => {
            const brand = brandFor(vehicle.companyName);
            const height = Math.max(ROW_HEIGHT, lanes * LANE_HEIGHT + 8);
            return (
              <div
                key={vehicle.id}
                className="grid grid-cols-[180px_1fr] border-b border-line last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: brand.color }}
                    title={vehicle.companyName}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {vehicle.nickname ? `“${vehicle.nickname}”` : vehicle.name}
                    </div>
                    <div className="truncate text-xs text-muted">{vehicle.regNumber}</div>
                  </div>
                </div>

                <div className="relative" style={{ height }}>
                  {/* Day gridlines, and a tint on today so the eye lands on it */}
                  <div className="absolute inset-0 grid grid-cols-7">
                    {days.map((d) => (
                      <div
                        key={d}
                        className={cn(
                          "border-l border-line/70",
                          d === todayKey && "bg-brand-50/40",
                        )}
                      />
                    ))}
                  </div>

                  {bars.map((bar) => {
                    const t = bar.trip;
                    const tone = t.overdue ? "overdue" : t.status;
                    const driver = t.bookedForName ?? t.bookedByName;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onOpen(t.id)}
                        title={
                          `${driver} — ${formatDateTime(t.takenOutAt)} to ` +
                          `${formatDateTime(t.returnedAt ?? t.expectedReturnAt)}` +
                          (t.returnedAt ? "" : " (expected)") +
                          `\n${t.overdue ? "Overdue" : STATUS_LABELS[t.status]}`
                        }
                        className={cn(
                          "absolute flex items-center overflow-hidden px-2 text-xs font-medium transition-opacity hover:opacity-85",
                          BAR_STYLE[tone],
                          // Square off whichever end runs past the edge of the
                          // week, so a clipped bar reads as continuing rather
                          // than as starting or ending on the Monday.
                          bar.clippedStart ? "rounded-l-none" : "rounded-l-md",
                          bar.clippedEnd ? "rounded-r-none" : "rounded-r-md",
                        )}
                        style={{
                          left: `${bar.left}%`,
                          width: `${bar.width}%`,
                          top: bar.lane * LANE_HEIGHT + 4,
                          height: LANE_HEIGHT - 4,
                        }}
                      >
                        <span className="truncate">
                          {bar.clippedStart ? "‹ " : ""}
                          {driver}
                          {bar.clippedEnd ? " ›" : ""}
                        </span>
                      </button>
                    );
                  })}

                  {bars.length === 0 && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
                      Free all week
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        {[
          { tone: "out" as const, label: STATUS_LABELS.out },
          { tone: "overdue" as const, label: "Overdue" },
          { tone: "servicing" as const, label: STATUS_LABELS.servicing },
          { tone: "home" as const, label: "Trip finished" },
        ].map((k) => (
          <span key={k.label} className="inline-flex items-center gap-1.5">
            <span className={cn("h-3 w-5 rounded", BAR_STYLE[k.tone])} />
            {k.label}
          </span>
        ))}
        <span>Click a bar to open the trip.</span>
      </div>
    </div>
  );
}
