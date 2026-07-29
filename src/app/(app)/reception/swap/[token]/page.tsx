import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { receptionSlots, receptionSwapRequests, staff } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { dayLabel, minutesToLabel } from "@/lib/reception";
import { Repeat2 } from "lucide-react";
import { SwapResponseClient } from "./response-client";

export const metadata = { title: "Reception swap — COLAB" };

/**
 * Where the Agree / Decline links in a swap email land.
 *
 * The token names the request; it does not authenticate. Whoever follows the
 * link still has to be signed in as the person being asked — or be an admin,
 * because a good number of desk staff have no login at all and a request would
 * otherwise sit unanswerable forever.
 */
export default async function SwapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  await requirePermission("reception.view");
  const user = await getCurrentUser();
  const { token } = await params;
  const { action } = await searchParams;

  const [request] = await db
    .select()
    .from(receptionSwapRequests)
    .where(eq(receptionSwapRequests.token, token))
    .limit(1);

  if (!request) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Reception swap" />
        <EmptyState
          icon={<Repeat2 className="h-8 w-8" />}
          title="That swap request no longer exists"
          description="It may have been withdrawn, or the rota was rebuilt."
        />
      </div>
    );
  }

  const slots = await db
    .select()
    .from(receptionSlots)
    .where(inArray(receptionSlots.id, [request.fromSlotId, request.toSlotId]));
  const from = slots.find((s) => s.id === request.fromSlotId);
  const to = slots.find((s) => s.id === request.toSlotId);

  const [requester] = await db
    .select({ name: staff.name })
    .from(staff)
    .where(eq(staff.id, request.requesterStaffId))
    .limit(1);
  const [target] = await db
    .select({ name: staff.name, userId: staff.userId })
    .from(staff)
    .where(eq(staff.id, request.targetStaffId))
    .limit(1);

  if (!from || !to) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Reception swap" />
        <EmptyState
          icon={<Repeat2 className="h-8 w-8" />}
          title="One of those shifts has gone"
          description="The rota has been rebuilt since this was asked, so there's nothing to swap."
        />
      </div>
    );
  }

  const canAnswer =
    target?.userId === user?.id || (user ? hasPermission(user, "reception.manage") : false);

  const slotText = (s: typeof from) =>
    `${dayLabel(s.date)}, ${minutesToLabel(s.startMinute)}–${minutesToLabel(s.endMinute)}`;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Swap reception shifts?"
        description="Nothing has changed yet. The rota only moves if you agree."
      />
      <Card className="p-4">
        <SwapResponseClient
          token={token}
          status={request.status}
          canAnswer={canAnswer}
          declineReason={request.declineReason}
          initialAction={action === "decline" ? "decline" : action === "approve" ? "approve" : null}
          detail={{
            requesterName: requester?.name ?? "Someone",
            targetName: target?.name ?? "you",
            message: request.message,
            // From the responder's point of view: they'd hand over the shift
            // they currently hold and pick up the requester's.
            youGiveUp: slotText(to),
            youTake: slotText(from),
          }}
        />
      </Card>
    </div>
  );
}
