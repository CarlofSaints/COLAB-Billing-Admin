import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  chatMessages,
  chatAttachments,
  chatParticipants,
  chatReads,
  staff,
  users,
} from "@/db/schema";
import { groupsForStaff } from "@/lib/group-members";
import type {
  ChatMessageView,
  ChatAttachmentView,
  ChannelItem,
  DirectItem,
  ChatSummary,
} from "@/lib/chat-types";

export type {
  ChatMessageView,
  ChatAttachmentView,
  ChannelItem,
  DirectItem,
  ChatSummary,
} from "@/lib/chat-types";

const RECENT_LIMIT = 50;

function directKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Email groups the user belongs to (via their email → staff → group).
 *
 * Resolved through the shared resolver rather than joining the member table,
 * so a rule group ("everyone tagged Reception") shows up as a chat channel for
 * whoever currently matches. Membership was always computed at read time here,
 * so this changes where the answer comes from, not how it behaves.
 */
async function myGroups(email: string): Promise<{ id: number; name: string }[]> {
  const [person] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(sql`lower(${staff.email}) = ${email.toLowerCase()}`)
    .limit(1);
  if (!person) return [];

  const groups = await groupsForStaff(person.id);
  return groups.map((g) => ({ id: g.id, name: g.name }));
}

async function ensureAll(): Promise<number> {
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.kind, "all"))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(conversations)
    .values({ kind: "all" })
    .onConflictDoNothing()
    .returning({ id: conversations.id });
  if (row) return row.id;
  const [again] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.kind, "all"))
    .limit(1);
  return again.id;
}

async function ensureGroup(groupId: number): Promise<number> {
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.kind, "group"), eq(conversations.groupId, groupId)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(conversations)
    .values({ kind: "group", groupId })
    .onConflictDoNothing()
    .returning({ id: conversations.id });
  if (row) return row.id;
  const [again] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.kind, "group"), eq(conversations.groupId, groupId)))
    .limit(1);
  return again.id;
}

async function ensureDirect(meId: number, otherId: number): Promise<number> {
  const key = directKey(meId, otherId);
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.directKey, key))
    .limit(1);
  let id = existing?.id;
  if (!id) {
    const [row] = await db
      .insert(conversations)
      .values({ kind: "direct", directKey: key })
      .onConflictDoNothing()
      .returning({ id: conversations.id });
    id = row?.id;
    if (!id) {
      const [again] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.directKey, key))
        .limit(1);
      id = again.id;
    }
  }
  await db
    .insert(chatParticipants)
    .values([
      { conversationId: id, userId: meId },
      { conversationId: id, userId: otherId },
    ])
    .onConflictDoNothing();
  return id;
}

/**
 * Turns a client-supplied ref ("all" | "group:<id>" | "direct:<userId>") into a
 * conversation id, creating it if needed and enforcing access. Returns null if
 * the user isn't allowed the target.
 */
export async function resolveRef(
  me: { id: number; email: string },
  ref: string,
): Promise<number | null> {
  if (ref === "all") return ensureAll();

  if (ref.startsWith("group:")) {
    const groupId = Number(ref.slice(6));
    if (!groupId) return null;
    const groups = await myGroups(me.email);
    if (!groups.some((g) => g.id === groupId)) return null;
    return ensureGroup(groupId);
  }

  if (ref.startsWith("direct:")) {
    const otherId = Number(ref.slice(7));
    if (!otherId || otherId === me.id) return null;
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, otherId), eq(users.active, true)))
      .limit(1);
    if (!other) return null;
    return ensureDirect(me.id, otherId);
  }

  return null;
}

/** Whether the user may read/write an existing conversation. */
export async function canAccess(
  me: { id: number; email: string },
  conversationId: number,
): Promise<boolean> {
  const [conv] = await db
    .select({ kind: conversations.kind, groupId: conversations.groupId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return false;
  if (conv.kind === "all") return true;
  if (conv.kind === "group") {
    if (!conv.groupId) return false;
    const groups = await myGroups(me.email);
    return groups.some((g) => g.id === conv.groupId);
  }
  const [member] = await db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(
      and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, me.id)),
    )
    .limit(1);
  return !!member;
}

async function attachmentsByMessage(
  messageIds: number[],
): Promise<Map<number, ChatAttachmentView[]>> {
  const map = new Map<number, ChatAttachmentView[]>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .select({
      id: chatAttachments.id,
      messageId: chatAttachments.messageId,
      name: chatAttachments.name,
      contentType: chatAttachments.contentType,
      size: chatAttachments.size,
    })
    .from(chatAttachments)
    .where(inArray(chatAttachments.messageId, messageIds))
    .orderBy(chatAttachments.id);
  for (const r of rows) {
    const list = map.get(r.messageId) ?? [];
    list.push({ id: r.id, name: r.name, contentType: r.contentType, size: r.size });
    map.set(r.messageId, list);
  }
  return map;
}

/** Map sender userId → their staff id, but only when they have a photo. */
async function senderPhotoMap(senderIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const ids = [...new Set(senderIds.filter((n): n is number => n != null))];
  if (ids.length === 0) return map;
  const rows = await db
    .select({ userId: staff.userId, staffId: staff.id, photoUrl: staff.photoUrl })
    .from(staff)
    .where(and(inArray(staff.userId, ids), sql`${staff.photoUrl} is not null`));
  for (const r of rows) if (r.userId != null) map.set(r.userId, r.staffId);
  return map;
}

async function toView(
  rows: { id: number; senderUserId: number | null; senderName: string; body: string; createdAt: Date }[],
  meId: number,
): Promise<ChatMessageView[]> {
  const [att, photos] = await Promise.all([
    attachmentsByMessage(rows.map((r) => r.id)),
    senderPhotoMap(rows.map((r) => r.senderUserId).filter((n): n is number => n != null)),
  ]);
  return rows.map((m) => ({
    id: m.id,
    senderUserId: m.senderUserId,
    senderName: m.senderName,
    senderPhotoStaffId: m.senderUserId != null ? photos.get(m.senderUserId) ?? null : null,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: m.senderUserId === meId,
    attachments: att.get(m.id) ?? [],
  }));
}

/** The most recent messages in a conversation (oldest → newest). */
export async function recentMessages(conversationId: number, meId: number): Promise<ChatMessageView[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      senderUserId: chatMessages.senderUserId,
      senderName: chatMessages.senderName,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.id))
    .limit(RECENT_LIMIT);
  return toView(rows.reverse(), meId);
}

/** Messages after a given id (for polling). */
export async function messagesAfter(
  conversationId: number,
  afterId: number,
  meId: number,
): Promise<ChatMessageView[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      senderUserId: chatMessages.senderUserId,
      senderName: chatMessages.senderName,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), sql`${chatMessages.id} > ${afterId}`))
    .orderBy(chatMessages.id)
    .limit(200);
  return toView(rows, meId);
}

/** Advance the read cursor to the latest message in a conversation. */
export async function markRead(conversationId: number, meId: number): Promise<void> {
  const [latest] = await db
    .select({ id: sql<number>`coalesce(max(${chatMessages.id}), 0)` })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));
  const lastReadMessageId = latest?.id ?? 0;
  await db
    .insert(chatReads)
    .values({ conversationId, userId: meId, lastReadMessageId })
    .onConflictDoUpdate({
      target: [chatReads.conversationId, chatReads.userId],
      set: { lastReadMessageId },
    });
}

/** The left-panel list: channels (All + my groups) and direct messages. */
export async function getSummary(me: { id: number; email: string }): Promise<ChatSummary> {
  const groups = await myGroups(me.email);

  // Unread per conversation: messages I haven't read that aren't mine.
  const unreadRows = await db
    .select({
      conversationId: chatMessages.conversationId,
      unread: sql<number>`count(*)::int`,
    })
    .from(chatMessages)
    .leftJoin(
      chatReads,
      and(eq(chatReads.conversationId, chatMessages.conversationId), eq(chatReads.userId, me.id)),
    )
    .where(
      and(
        sql`${chatMessages.senderUserId} is distinct from ${me.id}`,
        sql`${chatMessages.id} > coalesce(${chatReads.lastReadMessageId}, 0)`,
      ),
    )
    .groupBy(chatMessages.conversationId);
  const unreadByConv = new Map(unreadRows.map((r) => [r.conversationId, r.unread]));

  // Existing conversation rows for all + my groups.
  const chanConvs = await db
    .select({
      id: conversations.id,
      kind: conversations.kind,
      groupId: conversations.groupId,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(sql`${conversations.kind} in ('all','group')`);
  const allConv = chanConvs.find((c) => c.kind === "all") ?? null;
  const groupConvById = new Map(chanConvs.filter((c) => c.groupId != null).map((c) => [c.groupId!, c]));

  const channels: ChannelItem[] = [
    {
      ref: "all",
      kind: "all",
      name: "All",
      conversationId: allConv?.id ?? null,
      unread: allConv ? unreadByConv.get(allConv.id) ?? 0 : 0,
      lastMessageAt: allConv?.lastMessageAt ? allConv.lastMessageAt.toISOString() : null,
    },
    ...groups.map((g): ChannelItem => {
      const c = groupConvById.get(g.id);
      return {
        ref: `group:${g.id}`,
        kind: "group",
        name: g.name,
        conversationId: c?.id ?? null,
        unread: c ? unreadByConv.get(c.id) ?? 0 : 0,
        lastMessageAt: c?.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      };
    }),
  ];

  // My direct conversations, with the other participant's name.
  const directRows = await db
    .select({
      conversationId: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
      otherUserId: chatParticipants.userId,
      otherName: users.name,
    })
    .from(conversations)
    .innerJoin(
      chatParticipants,
      and(
        eq(chatParticipants.conversationId, conversations.id),
        ne(chatParticipants.userId, me.id),
      ),
    )
    .innerJoin(users, eq(users.id, chatParticipants.userId))
    .where(
      and(
        eq(conversations.kind, "direct"),
        sql`exists (select 1 from ${chatParticipants} cp where cp.conversation_id = ${conversations.id} and cp.user_id = ${me.id})`,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt));

  const directs: DirectItem[] = directRows.map((d) => ({
    ref: `direct:${d.otherUserId}`,
    otherUserId: d.otherUserId,
    name: d.otherName,
    conversationId: d.conversationId,
    unread: unreadByConv.get(d.conversationId) ?? 0,
    lastMessageAt: d.lastMessageAt ? d.lastMessageAt.toISOString() : null,
  }));

  return { channels, directs };
}

/** Active hub users other than me — for the "new direct message" picker. */
export async function chatUsers(meId: number): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.active, true), ne(users.id, meId)))
    .orderBy(users.name);
}
