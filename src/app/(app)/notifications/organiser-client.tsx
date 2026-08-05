"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { saveOrganiserTag, type NotificationState } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/**
 * Which tag makes somebody an organiser.
 *
 * A tag rather than a role, because that's the shape of the thing: Tyrone is
 * Finance, and the other six people in Finance are not organisers. WHICH tag is
 * a setting rather than a constant, so renaming the tag can't quietly take
 * everyone's authority away.
 */
export function OrganiserClient({
  tags,
  chosenTagId,
  organisers,
}: {
  tags: { id: number; name: string }[];
  chosenTagId: number | null;
  /** Who currently carries it — the answer to "so who can do this?". */
  organisers: string[];
}) {
  const [state, action] = useActionState<NotificationState, FormData>(saveOrganiserTag, {});
  const [tagId, setTagId] = useState(chosenTagId ? String(chosenTagId) : "");

  // The list is only about the SAVED tag, so it would be a lie next to an
  // unsaved pick. Say so instead of showing the wrong people.
  const changed = tagId !== (chosenTagId ? String(chosenTagId) : "");

  return (
    <form action={action}>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">Organisers</h2>
            <p className="mt-0.5 text-sm text-muted">
              Anyone carrying this tag can <strong>decline</strong> somebody else&apos;s vehicle
              booking, giving a reason that&apos;s emailed to whoever booked it. Tag or untag
              someone on the Team Members page and this follows.
            </p>

            <div className="mt-3 max-w-xs">
              <Field label="The organiser tag">
                <Select
                  name="tagId"
                  value={tagId}
                  onChange={(e) => setTagId(e.target.value)}
                >
                  <option value="">Nobody is an organiser</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {changed ? (
              <p className="mt-2 text-xs text-muted">Save to see who that covers.</p>
            ) : chosenTagId == null ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                Nobody can decline a booking at the moment.
              </p>
            ) : organisers.length === 0 ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-700">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Nobody active carries that tag, so nobody can decline a booking.
              </p>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {organisers.length === 1 ? "Organiser: " : "Organisers: "}
                {organisers.join(", ")}
              </p>
            )}

            {state.error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
              </p>
            )}
            {state.ok && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Saved.
              </p>
            )}

            <div className="mt-3 flex justify-end">
              <SaveButton />
            </div>
          </div>
        </div>
      </Card>
    </form>
  );
}
