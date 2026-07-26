"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Megaphone, CheckCircle2, TriangleAlert, Trash2, Inbox } from "lucide-react";
import { reportIssue, setIssueStatus, deleteIssue, type ReportState } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, Textarea, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { formatDateTime } from "@/lib/utils";
import { ISSUE_CATEGORIES, ISSUE_STATUSES, statusLabel, statusTone } from "@/lib/issues";

type IssueRow = {
  id: number;
  category: string;
  detail: string;
  status: string;
  reportedByName: string;
  resolvedByName: string | null;
  createdAt: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending…" : "Report issue"}
    </Button>
  );
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const [state, action] = useActionState<ReportState, FormData>(reportIssue, {});

  if (state.ok) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
        <p className="text-sm text-slate-700">
          Thanks — your report is in{state.note ? "" : " and the team has been notified"}.
        </p>
        {state.note && <p className="text-xs text-amber-700">{state.note}</p>}
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Type of issue">
        <Select name="category" defaultValue="" required>
          <option value="" disabled>
            Select type…
          </option>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Details" hint="What's wrong, and where? The more detail, the faster it's sorted.">
        <Textarea name="detail" rows={4} required autoFocus />
      </Field>
      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}

function ManageControls({ issue }: { issue: IssueRow }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <select
        value={issue.status}
        disabled={pending}
        onChange={(e) =>
          start(() => setIssueStatus(issue.id, e.target.value as "open" | "in_progress" | "resolved"))
        }
        className="rounded-lg border border-line bg-white px-2 py-1 text-xs focus:border-brand-600 focus:outline-none"
      >
        {ISSUE_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        title="Delete"
        disabled={pending}
        onClick={() => {
          if (confirm("Delete this issue?")) start(() => deleteIssue(issue.id));
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-red-500" />
      </Button>
    </div>
  );
}

export function IssuesClient({
  issues,
  canManage,
}: {
  issues: IssueRow[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Modal
          title="Report an issue"
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button>
              <Megaphone className="h-4 w-4" /> Report an issue
            </Button>
          }
        >
          <ReportForm onDone={() => setOpen(false)} />
        </Modal>
      </div>

      <h2 className="text-sm font-semibold text-slate-700">
        {canManage ? "Reported issues" : "Your reports"}
      </h2>

      {issues.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={canManage ? "Nothing reported" : "You haven't reported anything"}
          description={
            canManage
              ? "Issues reported by the team will show up here."
              : "Spot a problem? Use the button above to report it."
          }
        />
      ) : (
        <Card className="divide-y divide-line">
          {issues.map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="indigo">{i.category}</Badge>
                  <Badge tone={statusTone(i.status)}>{statusLabel(i.status)}</Badge>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800">{i.detail}</p>
                <p className="mt-1 text-xs text-muted">
                  {canManage ? `${i.reportedByName} · ` : ""}
                  {formatDateTime(i.createdAt)}
                  {i.status === "resolved" && i.resolvedByName ? ` · resolved by ${i.resolvedByName}` : ""}
                </p>
              </div>
              {canManage && <ManageControls issue={i} />}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
