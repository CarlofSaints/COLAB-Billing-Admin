"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  Megaphone,
  CheckCircle2,
  TriangleAlert,
  Trash2,
  Inbox,
  Search,
  QrCode,
} from "lucide-react";
import { reportIssue, setIssueStatus, deleteIssue, type ReportState } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, SortableTH, TR, TD } from "@/components/ui/table";
import { useTableSort } from "@/lib/use-table-sort";
import { formatDateTime } from "@/lib/utils";
import { ISSUE_CATEGORIES, ISSUE_STATUSES, statusLabel, statusTone } from "@/lib/issues";

type IssueRow = {
  id: number;
  category: string;
  detail: string;
  status: string;
  reportedByName: string;
  /** "hub" = signed in, so the name is proven. "public" = QR page, unverified. */
  source: string;
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

function StatusSelect({ issue }: { issue: IssueRow }) {
  const [pending, start] = useTransition();
  return (
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
  );
}

function DeleteButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      title="Delete"
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this issue?")) start(() => deleteIssue(id));
      }}
    >
      <Trash2 className="h-3.5 w-3.5 text-red-500" />
    </Button>
  );
}

/** Manager view: a sortable, filterable grid of every submission. */
function IssuesGrid({ issues }: { issues: IssueRow[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return issues.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!q) return true;
      return [i.category, i.detail, i.reportedByName].join(" ").toLowerCase().includes(q);
    });
  }, [issues, query, statusFilter]);

  const { sorted, sort, toggle } = useTableSort(
    filtered,
    {
      date: (i) => i.createdAt,
      reporter: (i) => i.reportedByName,
      type: (i) => i.category,
      status: (i) => i.status,
    },
    { key: "date", dir: "desc" },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search issues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select
          className="w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          {ISSUE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted">
          {filtered.length} of {issues.length}
        </span>
      </div>

      {issues.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="Nothing reported"
          description="Issues reported by the team will show up here."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <SortableTH sortKey="date" sort={sort} onSort={toggle}>
                  Date
                </SortableTH>
                <SortableTH sortKey="reporter" sort={sort} onSort={toggle}>
                  Reported by
                </SortableTH>
                <SortableTH sortKey="type" sort={sort} onSort={toggle}>
                  Type
                </SortableTH>
                <TH>Details</TH>
                <SortableTH sortKey="status" sort={sort} onSort={toggle}>
                  Status
                </SortableTH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <TD colSpan={6} className="py-10 text-center text-sm text-muted">
                    No issues match this search or filter.
                  </TD>
                </tr>
              )}
              {sorted.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(i.createdAt)}
                  </TD>
                  <TD className="whitespace-nowrap">
                    {i.reportedByName}
                    {/* Nobody signed in, so the name is a claim. Say so here
                        rather than letting it read like a verified identity. */}
                    {i.source === "public" && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                        title="Reported from the public QR-code page — nobody was signed in, so this name is unconfirmed."
                      >
                        <QrCode className="h-3 w-3" /> unverified
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone="indigo">{i.category}</Badge>
                  </TD>
                  <TD>
                    <div className="max-w-sm whitespace-pre-wrap text-sm text-slate-700">
                      {i.detail}
                    </div>
                    {i.status === "resolved" && i.resolvedByName && (
                      <div className="mt-0.5 text-[10px] text-muted">
                        resolved by {i.resolvedByName}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <StatusSelect issue={i} />
                  </TD>
                  <TD className="text-right">
                    <DeleteButton id={i.id} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Reporter view: a simple read-only list of your own reports. */
function MyReports({ issues }: { issues: IssueRow[] }) {
  if (issues.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        title="You haven't reported anything"
        description="Spot a problem? Use the button above to report it."
      />
    );
  }
  return (
    <Card className="divide-y divide-line">
      {issues.map((i) => (
        <div key={i.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">{i.category}</Badge>
            <Badge tone={statusTone(i.status)}>{statusLabel(i.status)}</Badge>
            <span className="text-xs text-muted">{formatDateTime(i.createdAt)}</span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800">{i.detail}</p>
        </div>
      ))}
    </Card>
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
        {canManage ? "All submissions" : "Your reports"}
      </h2>

      {canManage ? <IssuesGrid issues={issues} /> : <MyReports issues={issues} />}
    </div>
  );
}
