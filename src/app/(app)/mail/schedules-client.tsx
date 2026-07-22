"use client";

import { useActionState, useEffect, useState } from "react";
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Send,
  Pause,
  Play,
  TriangleAlert,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  saveSchedule,
  setScheduleActive,
  deleteSchedule,
  sendScheduleNow,
  type ScheduleState,
} from "@/app/actions/schedules";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import {
  describeRule,
  nextRun,
  ordinal,
  MERGE_TOKENS,
  WEEKDAYS,
  type Audience,
  type Frequency,
} from "@/lib/schedules";
import { formatDateTime, cn } from "@/lib/utils";

export type ScheduleRow = {
  id: number;
  name: string;
  subject: string;
  body: string;
  audience: Audience;
  groupIds: number[];
  frequency: Frequency;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDetail: string | null;
};

type GroupOpt = { id: number; name: string; recipientCount: number };

/** Pre-filled reminder for the case this was built for. */
const STAFF_REMINDER = {
  name: "Monthly staff list update",
  subject: "{{company}}: please update your staff list for {{month}} billing",
  body: `Hi {{contact}},

It's time to check that {{company}}'s staff list is up to date — we use the headcount at month-end to split shared costs, so anyone who has joined or left affects your invoice.

Please sign in and review your people here:
{{link}}

Add anyone new, and remove anyone who has left. If nothing has changed, no action is needed.

Thanks,
COLAB`,
};

function audienceLabel(a: Audience) {
  return a === "company_contacts" ? "Each sub-company's contact" : "Email groups";
}

export function SchedulesPanel({
  schedules,
  groups,
  configured,
}: {
  schedules: ScheduleRow[];
  groups: GroupOpt[];
  configured: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const send = async (s: ScheduleRow) => {
    if (!confirm(`Send “${s.name}” now, to everyone it's addressed to?`)) return;
    setBusy(s.id);
    setNote(null);
    const res = await sendScheduleNow(s.id);
    setBusy(null);
    setNote(
      res.error
        ? { tone: "error", text: res.error }
        : { tone: "ok", text: `Sent to ${res.sent} recipient(s).` },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Reminders go out automatically at 06:00 (SAST) on the day you choose.
        </p>
        <div className="flex gap-2">
          {schedules.length === 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setPreset(true);
                setAdding(true);
              }}
            >
              <Sparkles className="h-4 w-4" /> Use staff-list template
            </Button>
          )}
          <Button
            onClick={() => {
              setPreset(false);
              setAdding(true);
            }}
          >
            <Plus className="h-4 w-4" /> New reminder
          </Button>
        </div>
      </div>

      {!configured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Email isn&apos;t configured, so scheduled reminders won&apos;t send. You can still set
          them up.
        </div>
      )}

      {note && (
        <p
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            note.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
          )}
        >
          {note.tone === "ok" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <TriangleAlert className="h-4 w-4" />
          )}
          {note.text}
        </p>
      )}

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No scheduled reminders yet"
          description="Set one up to nudge each sub-company's admin to refresh their staff list before month-end billing."
          action={
            <Button
              onClick={() => {
                setPreset(true);
                setAdding(true);
              }}
            >
              Use the staff-list template
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => {
            const rule = {
              frequency: s.frequency,
              dayOfMonth: s.dayOfMonth,
              dayOfWeek: s.dayOfWeek,
            };
            const next = s.active ? nextRun(rule, s.lastRunAt) : null;
            return (
              <Card key={s.id} className={cn(!s.active && "opacity-70")}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{s.name}</h3>
                        <Badge tone={s.active ? "green" : "neutral"}>
                          {s.active ? "Active" : "Paused"}
                        </Badge>
                        <Badge tone="brand">{describeRule(rule)}</Badge>
                        <Badge tone="neutral">{audienceLabel(s.audience)}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">{s.subject}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === s.id}
                        onClick={() => send(s)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {busy === s.id ? "Sending…" : "Send now"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={s.active ? "Pause" : "Resume"}
                        onClick={() => setScheduleActive(s.id, !s.active)}
                      >
                        {s.active ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete the reminder “${s.name}”?`)) deleteSchedule(s.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-2 text-xs text-muted">
                    <span>
                      Next:{" "}
                      <span className="font-medium text-slate-700">
                        {next ? formatDateTime(next) : "—"}
                      </span>
                    </span>
                    <span>
                      Last:{" "}
                      <span className="font-medium text-slate-700">
                        {s.lastRunAt ? formatDateTime(s.lastRunAt) : "Never"}
                      </span>
                      {s.lastStatus && s.lastStatus !== "sent" && (
                        <span className="ml-1 text-amber-700">({s.lastStatus})</span>
                      )}
                    </span>
                    {s.lastDetail && <span>{s.lastDetail}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {adding && (
        <Modal title="New reminder" open onOpenChange={setAdding} wide>
          <ScheduleForm
            groups={groups}
            defaults={preset ? STAFF_REMINDER : undefined}
            onDone={() => setAdding(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          wide
        >
          <ScheduleForm
            groups={groups}
            schedule={editing}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function ScheduleForm({
  groups,
  schedule,
  defaults,
  onDone,
}: {
  groups: GroupOpt[];
  schedule?: ScheduleRow;
  defaults?: { name: string; subject: string; body: string };
  onDone: () => void;
}) {
  const [state, action] = useActionState<ScheduleState, FormData>(saveSchedule, {});
  const [frequency, setFrequency] = useState<Frequency>(schedule?.frequency ?? "monthly");
  const [audience, setAudience] = useState<Audience>(schedule?.audience ?? "company_contacts");
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(
    new Set(schedule?.groupIds ?? []),
  );

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const toggleGroup = (id: number) =>
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-4">
      {schedule && <input type="hidden" name="id" value={schedule.id} />}
      <input type="hidden" name="frequency" value={frequency} />
      <input type="hidden" name="audience" value={audience} />

      <Field label="Reminder name" hint="Only you see this — it labels the schedule.">
        <Input
          name="name"
          defaultValue={schedule?.name ?? defaults?.name}
          placeholder="e.g. Monthly staff list update"
          required
          autoFocus
        />
      </Field>

      <div>
        <p className="mb-1.5 block text-sm font-medium text-slate-700">Who gets it?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setAudience("company_contacts")}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm",
              audience === "company_contacts"
                ? "border-brand-600 bg-brand-50 text-brand-800"
                : "border-line text-slate-600 hover:bg-slate-50",
            )}
          >
            <span className="font-medium">Each sub-company&apos;s contact</span>
            <span className="block text-xs text-muted">
              One personalised email per company, to the contact on its record
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAudience("groups")}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm",
              audience === "groups"
                ? "border-brand-600 bg-brand-50 text-brand-800"
                : "border-line text-slate-600 hover:bg-slate-50",
            )}
          >
            <span className="font-medium">Email groups</span>
            <span className="block text-xs text-muted">Everyone in the groups you pick</span>
          </button>
        </div>
      </div>

      {audience === "groups" && (
        <div className="space-y-1 rounded-lg border border-line p-2">
          {groups.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted">No email groups exist yet.</p>
          )}
          {groups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
            >
              <span className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="groupId"
                  value={g.id}
                  checked={selectedGroups.has(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                {g.name}
              </span>
              <Badge tone="neutral">{g.recipientCount}</Badge>
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How often">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </Select>
        </Field>
        {frequency === "monthly" ? (
          <Field label="Day of the month" hint="1–28, so it lands every month including February.">
            <Select name="dayOfMonth" defaultValue={schedule?.dayOfMonth ?? 25}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {ordinal(d)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Day of the week">
            <Select name="dayOfWeek" defaultValue={schedule?.dayOfWeek ?? 1}>
              {WEEKDAYS.map((label, i) => (
                <option key={i} value={i}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <Field label="Subject">
        <Input
          name="subject"
          defaultValue={schedule?.subject ?? defaults?.subject}
          required
        />
      </Field>
      <Field label="Message">
        <Textarea
          name="body"
          rows={12}
          className="min-h-[240px]"
          defaultValue={schedule?.body ?? defaults?.body}
          required
        />
      </Field>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p className="font-medium text-slate-700">You can use these in the subject or message:</p>
        <ul className="mt-1 space-y-0.5">
          {MERGE_TOKENS.map((t) => (
            <li key={t.token}>
              <code className="rounded bg-white px-1 py-0.5 font-mono">{t.token}</code> — {t.hint}
            </li>
          ))}
        </ul>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{schedule ? "Save reminder" : "Create reminder"}</Button>
      </div>
    </form>
  );
}
