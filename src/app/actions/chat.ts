"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, chatMessages } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import {
  resolveRef,
  canAccess,
  recentMessages,
  markRead,
  type ChatMessageView,
} from "@/lib/chat";

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

export async function sendMessage(conversationId: number, body: string): Promise<SendResult> {
  const user = await requirePermission("hub.view");
  const text = body.trim();
  if (!text) return { error: "Message is empty." };
  if (text.length > 4000) return { error: "That message is too long." };

  const ok = await canAccess({ id: user.id, email: user.email }, conversationId);
  if (!ok) return { error: "You don't have access to that conversation." };

  const [row] = await db
    .insert(chatMessages)
    .values({ conversationId, senderUserId: user.id, senderName: user.name, body: text })
    .returning();
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await markRead(conversationId, user.id);

  return {
    message: {
      id: row.id,
      senderUserId: user.id,
      senderName: user.name,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      mine: true,
    },
  };
}
