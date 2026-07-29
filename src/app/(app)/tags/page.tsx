import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, staff, staffTags, tags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { TagsClient } from "./tags-client";

export const metadata = { title: "User Tags — COLAB" };

export default async function TagsPage() {
  await requirePermission("tags.manage");

  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      costPerPerson: tags.costPerPerson,
      count: sql<number>`count(${staffTags.staffId})::int`,
    })
    .from(tags)
    .leftJoin(staffTags, eq(staffTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));

  // Who a costed tag would actually bill: the same filter the headcount split
  // uses, so the figure on this page matches the invoice.
  const billable = await db
    .select({
      tagId: staffTags.tagId,
      companyId: staff.companyId,
      companyName: companies.name,
      count: sql<number>`count(*)::int`,
    })
    .from(staffTags)
    .innerJoin(staff, eq(staffTags.staffId, staff.id))
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .where(and(eq(staff.active, true), eq(staff.includeInBilling, true)))
    .groupBy(staffTags.tagId, staff.companyId, companies.name)
    .orderBy(asc(companies.name));

  const data = rows.map((r) => {
    const mine = billable.filter((b) => b.tagId === r.id);
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      count: r.count,
      costPerPerson: r.costPerPerson === null ? null : Number(r.costPerPerson),
      billable: mine.map((b) => ({ companyName: b.companyName, count: b.count })),
      billableCount: mine.reduce((s, b) => s + b.count, 0),
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="User Tags"
        description="Custom labels you can apply to team members (e.g. Reception, Admin). Assign them on the Team Members page. Give a tag a cost and it also bills — each sub-company is charged for the people it has tagged."
      />
      <TagsClient tags={data} />
    </div>
  );
}
