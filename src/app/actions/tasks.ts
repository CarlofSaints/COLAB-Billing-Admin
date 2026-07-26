"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminTasks, staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  mailConfigured,
  sendMail,
  taskAssignedEmail,
  taskCreatedEmail,
} from "@/lib/mailer";
import { priorityLabel, recurrenceLabel, formatTaskDate } from "@/lib/tasks";

export type TaskState = { error?: string; ok?: boolean; note?: string };

const taskSchema = z.object({
  name: z.string().trim().min(1, "Give the task a name"),
  description: z.string().trim().max(2000).optional(),
  assigneeStaffId: z.coerce.number().int().positive("Assign the task to someone"),
  dueDate: z
    .string()
    .trim()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a due date"),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  recurrence: z.enum(["once", "daily", "weekly", "monthly"]),
  reminders: z.boolean(),
});

function parse(formData: FormData) {
  return taskSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    assigneeStaffId: formData.get("assigneeStaffId"),
    dueDate: formData.get("dueDate"),
    priority: formData.get("priority") || "normal",
    recurrence: formData.get("recurrence") || "once",
    reminders: formData.get("reminders") != null,
  });
}

export async function createTask(_prev: TaskState, formData: FormData): Promise<TaskState> {
  const actor = await requirePermission("tasks.manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const [assignee] = await db
    .select({ id: staff.id, name: staff.name, email: staff.email })
    .from(staff)
    .where(eq(staff.id, data.assigneeStaffId))
    .limit(1);
  if (!assignee) return { error: "That team member no longer exists." };

  const [row] = await db
    .insert(adminTasks)
    .values({
      name: data.name,
      description: data.description || null,
      assigneeStaffId: assignee.id,
      createdByUserId: actor.id,
      createdByName: actor.name,
      dueDate: data.dueDate,
      priority: data.priority,
      recurrence: data.recurrence,
      // Reminders only make sense for recurring tasks.
      reminders: data.recurrence === "once" ? false : data.reminders,
    })
    .returning();

  await logEvent({
    action: "task.create",
    summary: `Created task "${row.name}" for ${assignee.name}`,
    actor,
    entityType: "admin_task",
    entityId: row.id,
    metadata: { priority: data.priority, recurrence: data.recurrence },
  });

  // Notify assignee + confirm to creator (best effort — never fail the task).
  // Every send's outcome is logged so delivery problems are visible in the
  // Activity Log rather than failing silently.
  let note: string | undefined;
  if (mailConfigured()) {
    const base = await appBaseUrl();
    const tasksUrl = `${base}/admin-tasks`;

    if (assignee.email) {
      const mail = taskAssignedEmail({
        assigneeName: assignee.name,
        taskName: row.name,
        description: row.description,
        dueDate: formatTaskDate(row.dueDate),
        priorityLabel: priorityLabel(row.priority),
        recurrenceLabel: recurrenceLabel(row.recurrence),
        assignedByName: actor.name,
        tasksUrl,
      });
      const res = await sendMail({ to: assignee.email, subject: mail.subject, html: mail.html, text: mail.text });
      await logEvent({
        action: res.ok ? "task.assignee_emailed" : "task.assignee_email_failed",
        summary: res.ok
          ? `Emailed task "${row.name}" to ${assignee.email}`
          : `Failed to email task to ${assignee.email}: ${res.error}`,
        entityType: "admin_task",
        entityId: row.id,
      });
      if (!res.ok) note = `Couldn't email ${assignee.name}: ${res.error}`;
    } else {
      note = `${assignee.name} has no email on file, so they weren't notified.`;
    }

    const confirm = taskCreatedEmail({
      creatorName: actor.name,
      taskName: row.name,
      assigneeName: assignee.name,
      dueDate: formatTaskDate(row.dueDate),
      tasksUrl,
    });
    const cres = await sendMail({ to: actor.email, subject: confirm.subject, html: confirm.html, text: confirm.text });
    await logEvent({
      action: cres.ok ? "task.creator_emailed" : "task.creator_email_failed",
      summary: cres.ok
        ? `Emailed task confirmation to ${actor.email}`
        : `Failed to email confirmation to ${actor.email}: ${cres.error}`,
      entityType: "admin_task",
      entityId: row.id,
    });
  } else {
    note = "Email isn't configured, so no notifications were sent.";
  }

  revalidatePath("/admin-tasks");
  return { ok: true, note };
}

export async function updateTask(_prev: TaskState, formData: FormData): Promise<TaskState> {
  const actor = await requirePermission("tasks.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing task id" };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  await db
    .update(adminTasks)
    .set({
      name: data.name,
      description: data.description || null,
      assigneeStaffId: data.assigneeStaffId,
      dueDate: data.dueDate,
      priority: data.priority,
      recurrence: data.recurrence,
      reminders: data.recurrence === "once" ? false : data.reminders,
      updatedAt: new Date(),
    })
    .where(eq(adminTasks.id, id));

  await logEvent({
    action: "task.update",
    summary: `Updated task "${data.name}"`,
    actor,
    entityType: "admin_task",
    entityId: id,
  });

  revalidatePath("/admin-tasks");
  return { ok: true };
}

export async function setTaskStatus(id: number, done: boolean) {
  const actor = await requirePermission("tasks.manage");
  await db
    .update(adminTasks)
    .set({
      status: done ? "done" : "open",
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(adminTasks.id, id));

  await logEvent({
    action: done ? "task.complete" : "task.reopen",
    summary: done ? "Marked a task done" : "Reopened a task",
    actor,
    entityType: "admin_task",
    entityId: id,
  });

  revalidatePath("/admin-tasks");
}

export async function deleteTask(id: number) {
  const actor = await requirePermission("tasks.manage");
  await db.delete(adminTasks).where(eq(adminTasks.id, id));
  await logEvent({
    action: "task.delete",
    summary: "Deleted a task",
    actor,
    entityType: "admin_task",
    entityId: id,
  });
  revalidatePath("/admin-tasks");
}
