"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, X, TriangleAlert } from "lucide-react";
import { respondToSwap, type SwapState } from "@/app/actions/reception-swaps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/field";

type Detail = {
  requesterName: string;
  targetName: string;
  message: string | null;
  youGiveUp: string;
  youTake: string;
};

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function SwapResponseClient({
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
  initialAction: "approve" | "decline" | null;
  detail: Detail;
}) {
  const [state, action] = useActionState<SwapState, FormData>(respondToSwap, {});
  // The email link only pre-opens the right form; it never submits on its own,
  // so a link scanner in a mail client can't answer on someone's behalf.
  const [mode, setMode] = useState<"approve" | "decline" | null>(initialAction);

  const summary = (
    <>
      <p className="mb-3 text-sm text-slate-700">
        <strong>{detail.requesterName}</strong> would like to swap reception shifts with you.
      </p>
      <dl className="divide-y divide-line rounded-lg border border-line">
        <div className="flex gap-3 px-3 py-2 text-sm">
          <dt className="w-28 shrink-0 text-muted">You give up</dt>
          <dd className="text-slate-800">{detail.youGiveUp}</dd>
        </div>
        <div className="flex gap-3 px-3 py-2 text-sm">
          <dt className="w-28 shrink-0 text-muted">You take</dt>
          <dd className="text-slate-800">{detail.youTake}</dd>
        </div>
      </dl>
      {detail.message && (
        <div className="mt-3">
          <p className="mb-1 text-sm text-muted">{detail.requesterName} says:</p>
          <blockquote className="rounded-lg border-l-4 border-brand-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {detail.message}
          </blockquote>
        </div>
      )}
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
              <Badge tone="brand">Swapped</Badge>
              <p className="mt-2">
                The rota has been updated — you&apos;re now on {detail.youTake}, and{" "}
                {detail.requesterName} takes {detail.youGiveUp}. They&apos;ve been emailed.
              </p>
            </>
          )}
          {resolved === "declined" && (
            <>
              <Badge tone="slate">Declined</Badge>
              <p className="mt-2">
                Nothing changed and {detail.requesterName} has been told why.
                {declineReason ? ` You said: "${declineReason}"` : ""}
              </p>
            </>
          )}
          {resolved === "withdrawn" && (
            <>
              <Badge tone="slate">No longer needed</Badge>
              <p className="mt-2">
                This was withdrawn, or the rota changed after it was asked.
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
          Only {detail.targetName} can answer this. If they forwarded you the email, they&apos;ll
          need to click it themselves — or an admin can answer on their behalf.
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
            <Check className="h-4 w-4" /> Agree to the swap
          </Button>
        </div>
      )}

      {mode === "approve" && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="approve" />
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            The rota changes as soon as you confirm: you take {detail.youTake},{" "}
            {detail.requesterName} takes {detail.youGiveUp}.
          </p>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <SubmitButton label="Yes, swap us" busy="Swapping…" />
          </div>
        </form>
      )}

      {mode === "decline" && (
        <form action={action} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="decline" />
          <Field label="Why can't you swap?" hint="They'll see this word for word.">
            <Textarea name="reason" required rows={3} maxLength={1000} autoFocus />
          </Field>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <SubmitButton label="Decline the swap" busy="Sending…" />
          </div>
        </form>
      )}
    </div>
  );
}
