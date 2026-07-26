"use server";

import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db } from "@/db";
import { conversations, chatMessages, chatAttachments, staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import {
  resolveRef,
  canAccess,
  recentMessages,
  markRead,
  type ChatMessageView,
  type ChatAttachmentView,
} from "@/lib/chat";

// Keep the whole message (text + files) comfortably under the 10 MB server
// action body limit.
const MAX_TOTAL_BYTES = 9 * 1024 * 1024;

function extFor(file: File): string {
  const fromName = file.name.split(".").pop();
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  return map[file.type] ?? "bin";
}

export type OpenResult = {
  error?: string;
  conversationId?: number;
  messages?: ChatMessageView[];
};

/** Open (or create) the conversation for a ref and return its recent messages. */
export async function openConversation(ref: string): Promise<OpenResult> {
  const user = await requirePermission("hub.view");
  const conversationId = await resolveRef({ id: user.id, email: user.email }, ref);
  if (!conversationId) return { error: "You don't have access to that conversation." };
  await markRead(conversationId, user.id);
  const messages = await recentMessages(conversationId, user.id);
  return { conversationId, messages };
}

export type SendResult = { error?: string; message?: ChatMessageView };

export async function sendMessage(formData: FormData): Promise<SendResult> {
  const user = await requirePermission("hub.view");
  const conversationId = Number(formData.get("conversationId")) || 0;
  const text = String(formData.get("body") ?? "").trim();
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (!conversationId) return { error: "No conversation selected." };
  if (!text && files.length === 0) return { error: "Message is empty." };
  if (text.length > 4000) return { error: "That message is too long." };
  if (files.length > 10) return { error: "Too many files — 10 at a time." };
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) {
    return { error: "Attachments are too large (9 MB total max)." };
  }

  const ok = await canAccess({ id: user.id, email: user.email }, conversationId);
  if (!ok) return { error: "You don't have access to that conversation." };

  const [row] = await db
    .insert(chatMessages)
    .values({ conversationId, senderUserId: user.id, senderName: user.name, body: text })
    .returning();

  const attachments: ChatAttachmentView[] = [];
  for (const file of files) {
    try {
      const blob = await put(
        `chat/${conversationId}/${randomBytes(8).toString("hex")}.${extFor(file)}`,
        file,
        { access: "private", contentType: file.type || "application/octet-stream", addRandomSuffix: false },
      );
      const [a] = await db
        .insert(chatAttachments)
        .values({
          messageId: row.id,
          pathname: blob.pathname,
          name: file.name.slice(0, 200),
          contentType: file.type || "application/octet-stream",
          size: file.size,
        })
        .returning();
      attachments.push({ id: a.id, name: a.name, contentType: a.contentType, size: a.size });
    } catch {
      /* skip a failed file rather than lose the whole message */
    }
  }

  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await markRead(conversationId, user.id);

  const [meStaff] = await db
    .select({ staffId: staff.id, photoUrl: staff.photoUrl })
    .from(staff)
    .where(eq(staff.userId, user.id))
    .limit(1);

  return {
    message: {
      id: row.id,
      senderUserId: user.id,
      senderName: user.name,
      senderPhotoStaffId: meStaff?.photoUrl ? meStaff.staffId : null,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      mine: true,
      attachments,
    },
  };
}
