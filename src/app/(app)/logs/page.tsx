import { desc } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { LogViewer } from "./logs-client";

export const metadata = { title: "Activity Log — COLAB" };

export default async function LogsPage() {
  await requirePermission("logs.view");

  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(300);

  const data = rows.map((r) => ({
    id: r.id,
    actorType: r.actorType,
    actorLabel: r.actorLabel ?? "—",
    action: r.action,
    summary: r.summary,
    entityType: r.entityType ?? "",
    entityId: r.entityId ?? "",
    ip: r.ip ?? "",
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader
        title="Activity Log"
        description="Every event across the system — user actions and API calls. The most recent 300 are shown."
      />
      <LogViewer entries={data} />
    </div>
  );
}
