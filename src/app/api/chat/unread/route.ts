import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getSummary } from "@/lib/chat";

/**
 * Total unread messages for the signed-in user — what the red badge on the
 * Chat nav item counts.
 *
 * Built from `getSummary`, the same thing the chat page's own per-conversation
 * badges come from, rather than a separate faster count. A standalone query
 * would have to re-derive which conversations this person can actually see
 * (the "all" channel, their groups, their DMs) and would drift from the badges
 * inside the chat the first time that logic changed.
 *
 * Unlike /api/chat/poll this never advances a read cursor: asking how many
 * messages are waiting must not mark them read.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "hub.view")) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const summary = await getSummary({ id: user.id, email: user.email });
  const count =
    summary.channels.reduce((n, c) => n + c.unread, 0) +
    summary.directs.reduce((n, d) => n + d.unread, 0);

  return Response.json({ count });
}
