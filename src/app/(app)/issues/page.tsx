import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { requirePermission, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { IssuesClient } from "./issues-client";

export const metadata = { title: "If you see something, say something! — COLAB" };
export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const user = await requirePermission("hub.view");
  const canManage = hasPermission(user, "issues.manage");

  const base = db
    .select({
      id: issues.id,
      category: issues.category,
      detail: issues.detail,
      status: issues.status,
      reportedByName: issues.reportedByName,
      resolvedByName: issues.resolvedByName,
      createdAt: issues.createdAt,
    })
    .from(issues);

  const rows = canManage
    ? await base
        .orderBy(sql`case when ${issues.status} = 'resolved' then 1 else 0 end`, desc(issues.createdAt))
    : await base.where(eq(issues.reportedByUserId, user.id)).orderBy(desc(issues.createdAt));

  const list = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="If you see something, say something!"
        description="Spot a problem around the office? Report it here and the right people are notified straight away."
      />
      <IssuesClient issues={list} canManage={canManage} />
    </div>
  );
}
