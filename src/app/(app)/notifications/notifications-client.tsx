"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, TriangleAlert, User, Users } from "lucide-react";
import {
  saveNotificationRecipients,
  type NotificationState,
} from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import type {
  NotificationChoice,
  NotificationKey,
  NotificationType,
} from "@/lib/notifications";

type GroupOption = {
  id: number;
  name: string;
  isLiveRule: boolean;
  memberCount: number;
  /** Members who actually have an address — the ones who'd be emailed. */
  sendableCount: number;
  preview: string[];
};

/** Active team members with an address — everyone the person picker offers. */
type PersonOption = { id: number; name: string; email: string };

/** `vehicle_booked:person` — the person field's name in the submitted form. */
function personField(key: NotificationKey): string {
  return `${key}:person`;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function NotificationsClient({
  types,
  groups,
  people,
  chosen,
}: {
  types: NotificationType[];
  groups: GroupOption[];
  people: PersonOption[];
  chosen: Record<NotificationKey, NotificationChoice>;
}) {
  const [state, action] = useActionState<NotificationState, FormData>(
    saveNotificationRecipients,
    {},
  );
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      types.flatMap((t) => [
        [t.key, chosen[t.key].groupId ? String(chosen[t.key].groupId) : ""],
        [personField(t.key), chosen[t.key].personId ? String(chosen[t.key].personId) : ""],
      ]),
    ),
  );

  const byId = new Map(groups.map((g) => [String(g.id), g]));
  const personById = new Map(people.map((p) => [String(p.id), p]));

  return (
    <form action={action} className="space-y-4">
      <Card className="divide-y divide-line">
        {types.map((type) => {
          const value = picked[type.key] ?? "";
          const group = byId.get(value);
          const personValue = picked[personField(type.key)] ?? "";
          const person = personById.get(personValue);
          return (
            <div key={type.key} className="px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{type.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{type.description}</p>
                </div>
                <div className="flex flex-col gap-2 sm:w-56 sm:shrink-0">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">Group</span>
                    <Select
                      name={type.key}
                      value={value}
                      onChange={(e) =>
                        setPicked((prev) => ({ ...prev, [type.key]: e.target.value }))
                      }
                    >
                      <option value="">{type.soleRecipients ? "Nobody" : "Nobody else"}</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {/* One person, not a second group. Anything wider belongs in
                      a group, where the membership is visible and reusable. */}
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      And one person
                    </span>
                    <Select
                      name={personField(type.key)}
                      value={personValue}
                      onChange={(e) =>
                        setPicked((prev) => ({ ...prev, [personField(type.key)]: e.target.value }))
                      }
                    >
                      <option value="">Nobody</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </div>

              {/* An event with no built-in recipients, no group and no person
                  told nobody at all, which the row would otherwise show as a
                  blank. A person on their own is a complete answer. */}
              {!group && !person && type.soleRecipients && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-amber-700">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Nobody is being told when this happens — pick a group or a person.
                  </span>
                </div>
              )}

              {person && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {person.name} ({person.email})
                    {/* Picking somebody already in the group is a natural thing
                        to do, and the send dedupes — so say so rather than
                        letting it look like a mistake. */}
                    {group && group.preview.includes(person.name) ? " — already in the group, so one email" : ""}
                  </span>
                </div>
              )}

              {group && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {group.isLiveRule && <Badge tone="brand">Live rule</Badge>}
                  {/* The failure this page exists to prevent: a notification
                      pointed at a group nobody is in. Said plainly, in place. */}
                  {group.sendableCount === 0 ? (
                    <span className="flex items-center gap-1.5 font-medium text-amber-700">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      {group.memberCount === 0
                        ? `${group.name} has nobody in it — ${
                            type.soleRecipients ? "nobody will be emailed" : "nobody extra will be emailed"
                          }.`
                        : `Nobody in ${group.name} has an email address.`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {group.sendableCount} {group.sendableCount === 1 ? "person" : "people"}:{" "}
                      {group.preview.join(", ")}
                      {group.sendableCount > group.preview.length ? " and others" : ""}
                    </span>
                  )}
                  {group.sendableCount > 0 && group.sendableCount < group.memberCount && (
                    <span className="text-amber-700">
                      ({group.memberCount - group.sendableCount} with no address, skipped)
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
        {`Anyone already being emailed is never sent a second copy — if the organiser is also the person who booked the vehicle, they get one message, not two.`}
      </p>

      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}
      {state.ok && (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Saved.
        </p>
      )}

      <div className="flex justify-end">
        <SaveButton />
      </div>
    </form>
  );
}
