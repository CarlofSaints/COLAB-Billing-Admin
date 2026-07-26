import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tags, staffTags } from "@/db/schema";
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
      count: sql<number>`count(${staffTags.staffId})::int`,
    })
    .from(tags)
    .leftJoin(staffTags, eq(staffTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="User Tags"
        description="Custom labels you can apply to team members (e.g. Reception, Admin). Assign them on the Team Members page."
      />
      <TagsClient tags={rows} />
    </div>
  );
}
