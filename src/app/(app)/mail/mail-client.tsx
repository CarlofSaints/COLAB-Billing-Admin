"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Send, TriangleAlert, CheckCircle2 } from "lucide-react";
import { sendAnnouncement, type MailState } from "@/app/actions/mail";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea, Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page";
import { Mails } from "lucide-react";

type GroupOpt = { id: number; name: string; description: string; recipientCount: number };

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Send className="h-4 w-4" />
      {pending ? "Sending…" : "Send announcement"}
    </Button>
  );
}

export function MailComposer({
  groups,
  configured,
}: {
  groups: GroupOpt[];
  configured: boolean;
}) {
  const [state, action] = useActionState<MailState, FormData>(sendAnnouncement, {});
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const reach = useMemo(
    () => groups.filter((g) => selected.has(g.id)).reduce((s, g) => s + g.recipientCount, 0),
    [groups, selected],
  );

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Mails className="h-8 w-8" />}
        title="No email groups to send to"
        description="Create an email group first, then come back to send an announcement."
      />
    );
  }

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Recipients</p>
            {groups.map((g) => (
              <label
                key={g.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name="groupId"
                  value={g.id}
                  checked={selected.has(g.id)}
                  onChange={() => toggle(g.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{g.name}</span>
                    <Badge tone="neutral">{g.recipientCount}</Badge>
                  </span>
                  {g.description && (
                    <span className="block text-xs text-muted">{g.description}</span>
                  )}
                </span>
              </label>
            ))}
            <div className="mt-2 border-t border-line pt-2 text-sm text-slate-600">
              Reaching <span className="font-semibold text-slate-900">{reach}</span> people
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        {!configured && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Email isn&apos;t configured yet. Add <code>RESEND_API_KEY</code> and{" "}
              <code>MAIL_FROM</code> in Vercel to enable sending. You can still draft here.
            </div>
          </div>
        )}

        <Card>
          <CardContent className="space-y-4">
            <Field label="Subject">
              <Input name="subject" placeholder="e.g. Office closed on Friday" required />
            </Field>
            <Field label="Message">
              <Textarea
                name="body"
                rows={10}
                className="min-h-[220px]"
                placeholder="Write your announcement…"
                required
              />
            </Field>

            {state.error && (
              <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <TriangleAlert className="h-4 w-4" /> {state.error}
              </p>
            )}
            {state.ok && (
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Sent to {state.count} recipient(s).
              </p>
            )}

            <div className="flex justify-end">
              <SendButton />
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
