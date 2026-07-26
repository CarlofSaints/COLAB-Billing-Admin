import { getCurrentUser, hasPermission } from "@/lib/auth";
import { canAccess, markRead, messagesAfter, getSummary, type ChatMessageView } from "@/lib/chat";

/**
 * Client polls this (~every few seconds). Returns new messages for the open
 * conversation (after a given id) plus the always-fresh conversation summary
 * for unread badges. Viewing a conversation advances its read cursor.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "hub.view")) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = Number(url.searchParams.get("conversationId")) || 0;
  const after = Number(url.searchParams.get("after")) || 0;

  let messages: ChatMessageView[] = [];
  if (conversationId) {
    const me = { id: user.id, email: user.email };
    if (await canAccess(me, conversationId)) {
      messages = await messagesAfter(conversationId, after, user.id);
      await markRead(conversationId, user.id);
    }
  }

  const summary = await getSummary({ id: user.id, email: user.email });
  return Response.json({ messages, summary });
}
