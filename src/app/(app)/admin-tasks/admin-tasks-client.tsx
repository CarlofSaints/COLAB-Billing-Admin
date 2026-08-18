"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  RotateCcw,
  TriangleAlert,
  ClipboardList,
  Repeat,
} from "lucide-react";
import {
  createTask,
  updateTask,
  setTaskStatus,
  deleteTask,
  type TaskState,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, SortableTH, TR, TD } from "@/components/ui/table";
import { useTableSort } from "@/lib/use-table-sort";
import {
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  priorityLabel,
  priorityTone,
  recurrenceLabel,
  formatTaskDate,
} from "@/lib/tasks";

type StaffOption = { id: number; name: string };

export type TaskRow = {
  id: number;
  name: string;
  description: string | null;
  assigneeStaffId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
  recurrence: string;
  reminders: boolean;
  status: string;
  createdByName: string | null;
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function TaskForm({
  task,
  staffOptions,
  onDone,
}: {
  task?: TaskRow;
  staffOptions: StaffOption[];
  onDone: () => void;
}) {
  const editing = !!task;
  const [state, action] = useActionState<TaskState, FormData>(
    editing ? updateTask : createTask,
    {},
  );
  const [recurrence, setRecurrence] = useState(task?.recurrence ?? "once");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={task.id} />}

      <Field label="Task name">
        <Input name="name" defaultValue={task?.name ?? ""} required autoFocus />
      </Field>

      <Field label="Description" hint="What needs doing?">
        <Textarea name="description" defaultValue={task?.description ?? ""} rows={3} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assign to">
          <Select name="assigneeStaffId" defaultValue={task?.assigneeStaffId ?? ""} required>
            <option value="" disabled>
              Choose a team member…
            </option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Due date">
          <Input name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} required />
        </Field>

        <Field label="Priority">
          <Select name="priority" defaultValue={task?.priority ?? "normal"}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Repeats">
          <Select
            name="recurrence"
            defaultValue={task?.recurrence ?? "once"}
            onChange={(e) => setRecurrence(e.target.value)}
          >
            {TASK_RECURRENCES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {recurrence !== "once" && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="reminders"
            defaultChecked={task ? task.reminders : true}
            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
          />
          Email the assignee a reminder each {recurrenceLabel(recurrence).toLowerCase()} cycle
        </label>
      )}

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveButton label={editing ? "Save changes" : "Create task"} />
      </div>
    </form>
  );
}

function RowActions({ task, staffOptions }: { task: TaskRow; staffOptions: StaffOption[] }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const done = task.status === "done";
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        title={done ? "Reopen" : "Mark done"}
        disabled={pending}
        onClick={() => start(() => setTaskStatus(task.id, !done))}
      >
        {done ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
      </Button>
      <Modal
        title={`Edit ${task.name}`}
        open={editing}
        onOpenChange={setEditing}
        trigger={
          <Button variant="ghost" size="sm" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <TaskForm task={task} staffOptions={staffOptions} onDone={() => setEditing(false)} />
      </Modal>
      <Button
        variant="ghost"
        size="sm"
        title="Delete"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete task "${task.name}"?`)) start(() => deleteTask(task.id));
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-red-500" />
      </Button>
    </div>
  );
}

export function AdminTasksClient({
  tasks,
  staffOptions,
  canManage,
}: {
  tasks: TaskRow[];
  staffOptions: StaffOption[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);

  const { sorted, sort, toggle } = useTableSort(
    tasks,
    {
      task: (t) => t.name,
      assignee: (t) => t.assigneeName,
      // ISO dates, so a string compare is a date compare.
      due: (t) => t.dueDate,
      // Rank by severity, not by the label's spelling — "Can wait" before
      // "Urgent" alphabetically is the opposite of what you asked for.
      priority: (t) => TASK_PRIORITIES.findIndex((p) => p.value === t.priority),
      repeats: (t) => recurrenceLabel(t.recurrence),
      status: (t) => (t.status === "done" ? "Done" : "Open"),
    },
    { key: "due", dir: "asc" },
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Modal
            title="New task"
            open={adding}
            onOpenChange={setAdding}
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Add task
              </Button>
            }
          >
            <TaskForm staffOptions={staffOptions} onDone={() => setAdding(false)} />
          </Modal>
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No tasks yet"
          description="Create the first task and assign it to a team member."
          action={
            canManage ? <Button onClick={() => setAdding(true)}>Add task</Button> : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <SortableTH sortKey="task" sort={sort} onSort={toggle}>
                  Task
                </SortableTH>
                <SortableTH sortKey="assignee" sort={sort} onSort={toggle}>
                  Assigned to
                </SortableTH>
                <SortableTH sortKey="due" sort={sort} onSort={toggle}>
                  Due
                </SortableTH>
                <SortableTH sortKey="priority" sort={sort} onSort={toggle}>
                  Priority
                </SortableTH>
                <SortableTH sortKey="repeats" sort={sort} onSort={toggle}>
                  Repeats
                </SortableTH>
                <SortableTH sortKey="status" sort={sort} onSort={toggle}>
                  Status
                </SortableTH>
                {canManage && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {sorted.map((t) => {
                const done = t.status === "done";
                return (
                  <TR key={t.id} className={done ? "opacity-60" : undefined}>
                    <TD>
                      <div className="font-medium text-slate-900">{t.name}</div>
                      {t.description && (
                        <div className="max-w-md truncate text-xs text-muted">{t.description}</div>
                      )}
                    </TD>
                    <TD>{t.assigneeName ?? "—"}</TD>
                    <TD>{formatTaskDate(t.dueDate) || "—"}</TD>
                    <TD>
                      <Badge tone={priorityTone(t.priority)}>{priorityLabel(t.priority)}</Badge>
                    </TD>
                    <TD>
                      {t.recurrence === "once" ? (
                        <span className="text-muted">Once-off</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <Repeat className="h-3 w-3" /> {recurrenceLabel(t.recurrence)}
                        </span>
                      )}
                    </TD>
                    <TD>
                      {done ? (
                        <Badge tone="green">Done</Badge>
                      ) : (
                        <Badge tone="neutral">Open</Badge>
                      )}
                    </TD>
                    {canManage && (
                      <TD className="text-right">
                        <RowActions task={t} staffOptions={staffOptions} />
                      </TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
