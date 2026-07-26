// Shared chat types — safe to import from client and server (no server-only).

export type ChatMessageView = {
  id: number;
  senderUserId: number | null;
  senderName: string;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ChannelItem = {
  ref: string;
  kind: "all" | "group";
  name: string;
  conversationId: number | null;
  unread: number;
  lastMessageAt: string | null;
};

export type DirectItem = {
  ref: string;
  otherUserId: number;
  name: string;
  conversationId: number | null;
  unread: number;
  lastMessageAt: string | null;
};

export type ChatSummary = { channels: ChannelItem[]; directs: DirectItem[] };
