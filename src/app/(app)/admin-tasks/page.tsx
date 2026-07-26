import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminTasks, staff } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { AdminTasksClient } from "./admin-tasks-client";

export const metadata = { title: "Admin Tasks — COLAB" };

export default async function AdminTasksPage() {
  await requirePermission("tasks.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "tasks.manage") : false;

  const tasks = await db
    .select({
      id: adminTasks.id,
      name: adminTasks.name,
      description: adminTasks.description,
      assigneeStaffId: adminTasks.assigneeStaffId,
      assigneeName: staff.name,
      dueDate: adminTasks.dueDate,
      priority: adminTasks.priority,
      recurrence: adminTasks.recurrence,
      reminders: adminTasks.reminders,
      status: adminTasks.status,
      createdByName: adminTasks.createdByName,
    })
    .from(adminTasks)
    .leftJoin(staff, eq(adminTasks.assigneeStaffId, staff.id))
    .orderBy(
      // Open tasks first, then by soonest due date.
      sql`case when ${adminTasks.status} = 'open' then 0 else 1 end`,
      sql`${adminTasks.dueDate} asc nulls last`,
    );

  const staffOptions = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.active, true)))
    .orderBy(asc(staff.name));

  return (
    <div>
      <PageHeader
        title="Admin Tasks"
        description="Schedule and assign tasks across the COLAB workspace, with due dates, priorities and email reminders."
      />
      <AdminTasksClient tasks={tasks} staffOptions={staffOptions} canManage={canManage} />
    </div>
  );
}
