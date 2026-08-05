"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, X, TriangleAlert } from "lucide-react";
import { respondToVehicleSteal, type VehicleBookingState } from "@/app/actions/vehicle-bookings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/field";

type Detail = {
  requesterName: string;
  message: string;
  vehicleLabel: string;
  yourFromLabel: string;
  yourToLabel: string;
  wantedFromLabel: string;
  wantedToLabel: string;
  holderName: string;
  /** Their booking starts first, so approving shortens it rather than ending it. */
  keepsTheFirstPart: boolean;
  shortenedToLabel: string;
};

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function VehicleStealResponseClient({
  token,
  status,
  canAnswer,
  declineReason,
  initialAction,
  detail,
}: {
  token: string;
  status: string;
  canAnswer: boolean;
  declineReason: string | null;
  /** Which button the email link pre-selected. */
  initialAction: "approve" | "decline" | null;
  detail: Detail;
}) {
  const [state, action] = useActionState<VehicleBookingState, FormData>(
    respondToVehicleSteal,
    {},
  );
  // The email link only pre-opens the right form — it never submits on its own,
  // so a link preview or scanner in their mail client can't answer for them.
  const [mode, setMode] = useState<"approve" | "decline" | null>(initialAction);

  const rows: [string, string][] = [
    ["Vehicle", detail.vehicleLabel],
    ["You have it", `${detail.yourFromLabel} – ${detail.yourToLabel}`],
    ["They want it", `${detail.wantedFromLabel} – ${detail.wantedToLabel}`],
  ];

  const summary = (
    <>
      <dl className="divide-y divide-line rounded-lg border border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 px-3 py-2 text-sm">
            <dt className="w-32 shrink-0 text-muted">{label}</dt>
            <dd className="text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <p className="mb-1 text-sm text-muted">{detail.requesterName} says:</p>
        <blockquote className="rounded-lg border-l-4 border-brand-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {detail.message}
        </blockquote>
      </div>
    </>
  );

  if (status !== "pending" || state.ok) {
    const resolved = state.ok ? (mode === "approve" ? "approved" : "declined") : status;
    return (
      <div className="space-y-3">
        {summary}
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700">
          {resolved === "approved" && (
            <>
              <Badge tone="brand">Approved</Badge>
              <p className="mt-2">
                {detail.requesterName} has the vehicle for that window, and has been emailed.
                {detail.keepsTheFirstPart
                  ? ` Your booking now ends at ${detail.shortenedToLabel} — if you have the vehicle, that's when it needs to be back.`
                  : " Your booking has been given up."}
              </p>
            </>
          )}
          {resolved === "declined" && (
            <>
              <Badge tone="slate">Declined</Badge>
              <p className="mt-2">
                {`You kept the vehicle and ${detail.requesterName} has been told why.`}
                {declineReason ? ` You said: “${declineReason}”` : ""}
              </p>
            </>
          )}
          {resolved === "withdrawn" && (
            <>
              <Badge tone="slate">No longer needed</Badge>
              <p className="mt-2">
                This request was withdrawn — the booking was removed or handed to somebody else.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!canAnswer) {
    return (
      <div className="space-y-3">
        {summary}
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {`Only ${detail.holderName}, who booked the vehicle, can answer this. If they forwarded you the email, they'll need to click it themselves.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary}

      {mode === null && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setMode("decline")}>
            <X className="h-4 w-4" /> Decline
          </Button>
          <Button onClick={() => setMode("approve")}>
            <Check className="h-4 w-4" /> Let them have it
          </Button>
        </div>
      )}

      {mode === "approve" && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="approve" />
          {/* Spelled out, because "shortened" and "given up" are very different
              answers and the two windows alone don't make it obvious which
              this is. */}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {detail.keepsTheFirstPart
              ? `${detail.requesterName} gets the vehicle from ${detail.wantedFromLabel}. Your booking is shortened to end then — if you already have it, that's when it needs to be back. They'll be emailed.`
              : `${detail.requesterName} gets the vehicle for that window, and your booking is given up entirely. They'll be emailed.`}
          </p>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <SubmitButton label="Yes, let them have it" busy="Handing over…" />
          </div>
        </form>
      )}

      {mode === "decline" && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="decline" />
          <Field label="Why are you keeping it?" hint="They'll see this word for word.">
            <Textarea name="reason" required rows={3} maxLength={1000} autoFocus />
          </Field>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <SubmitButton label="Decline the request" busy="Sending…" />
          </div>
        </form>
      )}
    </div>
  );
}
