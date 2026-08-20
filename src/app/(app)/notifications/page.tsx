import { asc } from "drizzle-orm";
import { Bell } from "lucide-react";
import { db } from "@/db";
import { emailGroups } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { resolveGroupMembers } from "@/lib/group-members";
import { NOTIFICATION_TYPES, notificationGroupIds } from "@/lib/notifications";
import { allTags, organiserPeople, organiserTagId } from "@/lib/organisers";
import { NotificationsClient } from "./notifications-client";
import { OrganiserClient } from "./organiser-client";

export const metadata = { title: "Notifications — COLAB" };

export default async function NotificationsPage() {
  await requirePermission("notifications.manage");

  const groups = await db
    .select({ id: emailGroups.id, name: emailGroups.name, rule: emailGroups.rule })
    .from(emailGroups)
    .orderBy(asc(emailGroups.name));

  // Resolved here rather than left to a click: the whole risk of this page is
  // pointing a notification at a group that matches nobody, and a count next to
  // the name is what makes that obvious before it matters.
  const membersByGroup = await resolveGroupMembers(groups.map((g) => g.id));

  const options = groups.map((g) => {
    const members = membersByGroup.get(g.id) ?? [];
    const sendable = members.filter((m) => (m.email ?? "").includes("@"));
    return {
      id: g.id,
      name: g.name,
      isLiveRule: g.rule != null,
      memberCount: members.length,
      sendableCount: sendable.length,
      preview: sendable.slice(0, 8).map((m) => m.name),
    };
  });

  const chosen = await notificationGroupIds();

  // Who can decline a vehicle booking. Kept on this page because it's the same
  // question ("who is the organiser?") asked for a different purpose, but saved
  // separately — it grants a power, not an email.
  const [tagOptions, organiserTag, organisers] = await Promise.all([
    allTags(),
    organiserTagId(),
    organiserPeople(),
  ]);

  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Notifications"
          description="Who else gets emailed when something happens."
        />
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="No email groups yet"
          description="These notifications go to an email group, so there has to be one first. Make a group on the Email Groups page — a live rule like “everyone tagged ORGANISER” keeps itself up to date."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Who gets emailed when something happens. The vehicle emails always reach the booker and the driver, and a group here adds to them. Office issues have no built-in list — they go to the group picked here and nobody else."
      />
      <NotificationsClient types={NOTIFICATION_TYPES} groups={options} chosen={chosen} />
      <div className="mt-8">
        <OrganiserClient
          tags={tagOptions}
          chosenTagId={organiserTag}
          organisers={organisers.map((p) => p.name)}
        />
      </div>
    </div>
  );
}
