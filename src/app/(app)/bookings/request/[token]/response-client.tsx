"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, X, TriangleAlert } from "lucide-react";
import { respondToSteal, type BookingState } from "@/app/actions/bookings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/field";

type Detail = {
  requesterName: string;
  requesterMeeting: string;
  message: string;
  attendeeCount: number;
  clientName: string | null;
  roomName: string;
  dateLabel: string;
  timeLabel: string;
  yourMeeting: string;
  holderName: string;
};

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function StealResponseClient({
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
  const [state, action] = useActionState<BookingState, FormData>(respondToSteal, {});
  // The email link only pre-opens the right form — it never submits on its own,
  // so a link preview or scanner in their mail client can't answer for them.
  const [mode, setMode] = useState<"approve" | "decline" | null>(initialAction);

  const rows: [string, string][] = [
    ["Your booking", detail.yourMeeting],
    ["Room", detail.roomName],
    ["When", `${detail.dateLabel}, ${detail.timeLabel}`],
    ["They want it for", detail.requesterMeeting],
    ["Their attendees", String(detail.attendeeCount)],
    ...(detail.clientName ? ([["Their client", detail.clientName]] as [string, string][]) : []),
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
                {detail.requesterName} has the room. It's booked in their name and they've been
                emailed — nothing further for you to do.
              </p>
            </>
          )}
          {resolved === "declined" && (
            <>
              <Badge tone="slate">Declined</Badge>
              <p className="mt-2">
                You kept the room and {detail.requesterName} has been told why.
                {declineReason ? ` You said: "${declineReason}"` : ""}
              </p>
            </>
          )}
          {resolved === "withdrawn" && (
            <>
              <Badge tone="slate">No longer needed</Badge>
              <p className="mt-2">
                This request was withdrawn — the booking was cancelled or handed over to someone
                else.
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
          Only {detail.holderName}, who booked the room, can answer this. If they forwarded you the
          email, they'll need to click it themselves.
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
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            The slot passes straight to {detail.requesterName} — it becomes their meeting, at the
            same room and time, and your booking goes. They'll be emailed.
          </p>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <SubmitButton label="Yes, give them the room" busy="Handing over…" />
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
