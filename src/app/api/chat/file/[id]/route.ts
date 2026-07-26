import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatAttachments, chatMessages } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { canAccess } from "@/lib/chat";

/**
 * Serves a chat attachment from the PRIVATE Blob store, but only to a member
 * of the conversation it belongs to. The raw blob URL is never exposed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "hub.view")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const attachmentId = Number(id);
  if (!Number.isInteger(attachmentId)) return new Response("Bad request", { status: 400 });

  const [att] = await db
    .select({
      pathname: chatAttachments.pathname,
      name: chatAttachments.name,
      contentType: chatAttachments.contentType,
      conversationId: chatMessages.conversationId,
    })
    .from(chatAttachments)
    .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .where(eq(chatAttachments.id, attachmentId))
    .limit(1);
  if (!att) return new Response("Not found", { status: 404 });

  if (!(await canAccess({ id: user.id, email: user.email }, att.conversationId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const res = await get(att.pathname, { access: "private" });
  if (!res || res.statusCode !== 200) return new Response("Not found", { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="${att.name.replace(/"/g, "")}"`;

  return new Response(res.stream, {
    headers: {
      "Content-Type": att.contentType || "application/octet-stream",
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=300",
    },
  });
}
