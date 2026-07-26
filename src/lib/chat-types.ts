// Shared chat types — safe to import from client and server (no server-only).

export type ChatAttachmentView = {
  id: number;
  name: string;
  contentType: string;
  size: number;
};

export type ChatMessageView = {
  id: number;
  senderUserId: number | null;
  senderName: string;
  // Staff id to load the sender's avatar via /api/photo/[id] — only set when
  // they actually have a photo; otherwise the client shows initials.
  senderPhotoStaffId: number | null;
  body: string;
  createdAt: string;
  mine: boolean;
  attachments: ChatAttachmentView[];
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
