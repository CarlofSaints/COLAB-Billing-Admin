"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, TriangleAlert, Users } from "lucide-react";
import {
  saveNotificationRecipients,
  type NotificationState,
} from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import type { NotificationKey, NotificationType } from "@/lib/notifications";

type GroupOption = {
  id: number;
  name: string;
  isLiveRule: boolean;
  memberCount: number;
  /** Members who actually have an address — the ones who'd be emailed. */
  sendableCount: number;
  preview: string[];
};

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
  chosen,
}: {
  types: NotificationType[];
  groups: GroupOption[];
  chosen: Record<NotificationKey, number | null>;
}) {
  const [state, action] = useActionState<NotificationState, FormData>(
    saveNotificationRecipients,
    {},
  );
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(types.map((t) => [t.key, chosen[t.key] ? String(chosen[t.key]) : ""])),
  );

  const byId = new Map(groups.map((g) => [String(g.id), g]));

  return (
    <form action={action} className="space-y-4">
      <Card className="divide-y divide-line">
        {types.map((type) => {
          const value = picked[type.key] ?? "";
          const group = byId.get(value);
          return (
            <div key={type.key} className="px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{type.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{type.description}</p>
                </div>
                <Select
                  name={type.key}
                  value={value}
                  onChange={(e) =>
                    setPicked((prev) => ({ ...prev, [type.key]: e.target.value }))
                  }
                  className="sm:max-w-56"
                >
                  <option value="">Nobody else</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </div>

              {group && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {group.isLiveRule && <Badge tone="brand">Live rule</Badge>}
                  {/* The failure this page exists to prevent: a notification
                      pointed at a group nobody is in. Said plainly, in place. */}
                  {group.sendableCount === 0 ? (
                    <span className="flex items-center gap-1.5 font-medium text-amber-700">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      {group.memberCount === 0
                        ? `${group.name} has nobody in it — nobody extra will be emailed.`
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
