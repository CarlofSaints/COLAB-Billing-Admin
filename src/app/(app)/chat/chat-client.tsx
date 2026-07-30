"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Hash,
  Users,
  MessageSquarePlus,
  Send,
  Search,
  MessagesSquare,
  Paperclip,
  FileText,
  Download,
  X,
} from "lucide-react";
import { openConversation, sendMessage } from "@/app/actions/chat";
import { cn, initials } from "@/lib/utils";
import type { ChatSummary, ChatMessageView } from "@/lib/chat-types";

const POLL_MS = 3000;

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PendingChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const url = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 py-1 pl-1.5 pr-2">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="h-8 w-8 rounded object-cover" />
      ) : (
        <FileText className="h-5 w-5 text-slate-400" />
      )}
      <div className="max-w-[140px]">
        <p className="truncate text-xs font-medium text-slate-700">{file.name}</p>
        <p className="text-[10px] text-muted">{formatBytes(file.size)}</p>
      </div>
      <button onClick={onRemove} className="rounded p-0.5 text-slate-400 hover:text-red-500">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ChatClient({
  initialSummary,
  people,
}: {
  initialSummary: ChatSummary;
  people: { id: number; name: string }[];
}) {
  const [summary, setSummary] = useState<ChatSummary>(initialSummary);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const convIdRef = useRef<number | null>(null);
  const lastIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRefRef = useRef<string | null>(null);

  // Keep refs in sync after each render so the polling interval and async
  // handlers read current values without re-subscribing.
  useEffect(() => {
    convIdRef.current = conversationId;
    selectedRefRef.current = selectedRef;
    lastIdRef.current = messages.length ? messages[messages.length - 1].id : 0;
  });

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const appendMessages = useCallback((incoming: ChatMessageView[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Open a conversation by ref (channel or direct).
  const select = useCallback(
    async (ref: string) => {
      setSelectedRef(ref);
      setConversationId(null);
      setMessages([]);
      // Optimistically clear its unread in the sidebar.
      setSummary((s) => ({
        channels: s.channels.map((c) => (c.ref === ref ? { ...c, unread: 0 } : c)),
        directs: s.directs.map((d) => (d.ref === ref ? { ...d, unread: 0 } : d)),
      }));
      const res = await openConversation(ref);
      // Ignore if the user has since switched conversations.
      if (selectedRefRef.current !== ref) return;
      if (res.error || !res.conversationId) return;
      setConversationId(res.conversationId);
      setMessages(res.messages ?? []);
      scrollToBottom();
    },
    [scrollToBottom],
  );

  // Auto-open the All channel on first load (deferred out of the effect body).
  useEffect(() => {
    const t = setTimeout(() => void select("all"), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for new messages + fresh unread badges.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const cid = convIdRef.current ?? 0;
      const after = lastIdRef.current;
      try {
        const res = await fetch(`/api/chat/poll?conversationId=${cid}&after=${after}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages: ChatMessageView[]; summary: ChatSummary };
        if (cancelled) return;
        if (data.summary) setSummary(data.summary);
        if (cid && cid === convIdRef.current && data.messages?.length) {
          appendMessages(data.messages);
          scrollToBottom();
        }
      } catch {
        /* transient — next tick retries */
      }
    };
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [appendMessages, scrollToBottom]);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || !conversationId || sending) return;
    if (files.reduce((s, f) => s + f.size, 0) > 9 * 1024 * 1024) {
      setSendError("Attachments are too large (9 MB total max).");
      return;
    }
    setSending(true);
    setSendError(null);
    const pending = files;
    const fd = new FormData();
    fd.set("conversationId", String(conversationId));
    fd.set("body", text);
    pending.forEach((f) => fd.append("files", f));
    setInput("");
    setFiles([]);
    const res = await sendMessage(fd);
    setSending(false);
    if (res.message) {
      appendMessages([res.message]);
      scrollToBottom();
    } else if (res.error) {
      setInput(text);
      setFiles(pending);
      setSendError(res.error);
    }
  }, [input, files, conversationId, sending, appendMessages, scrollToBottom]);

  const addFiles = useCallback((incoming: File[]) => {
    const ok = incoming.filter((f) => f.size > 0);
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  }, []);

  const title = useMemo(() => {
    if (!selectedRef) return "";
    const ch = summary.channels.find((c) => c.ref === selectedRef);
    if (ch) return ch.name;
    const dm = summary.directs.find((d) => d.ref === selectedRef);
    if (dm) return dm.name;
    if (selectedRef.startsWith("direct:")) {
      const id = Number(selectedRef.slice(7));
      return people.find((p) => p.id === id)?.name ?? "Direct message";
    }
    return "";
  }, [selectedRef, summary, people]);

  const isChannel = selectedRef === "all" || selectedRef?.startsWith("group:");

  const filteredPeople = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  }, [people, pickerQuery]);

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-line bg-white">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <MessagesSquare className="h-5 w-5 text-brand-700" /> Chat
          </h2>
          <button
            onClick={() => setPickerOpen(true)}
            title="New direct message"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Channels
          </p>
          {summary.channels.map((c) => (
            <ListButton
              key={c.ref}
              active={selectedRef === c.ref}
              onClick={() => void select(c.ref)}
              icon={c.kind === "all" ? <Users className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
              label={c.name}
              unread={c.unread}
            />
          ))}

          <p className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Direct messages
          </p>
          {summary.directs.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted">No conversations yet.</p>
          )}
          {summary.directs.map((d) => (
            <ListButton
              key={d.ref}
              active={selectedRef === d.ref}
              onClick={() => void select(d.ref)}
              avatar={d.name}
              label={d.name}
              unread={d.unread}
            />
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedRef ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            Pick a conversation to start chatting.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3">
              {isChannel ? (
                selectedRef === "all" ? (
                  <Users className="h-4 w-4 text-slate-500" />
                ) : (
                  <Hash className="h-4 w-4 text-slate-500" />
                )
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[10px] font-semibold text-white">
                  {initials(title)}
                </div>
              )}
              <span className="font-medium text-slate-900">{title}</span>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">
                  No messages yet — say hello 👋
                </p>
              ) : (
                messages.map((m) => (
                  <Message key={m.id} m={m} showName={!!isChannel && !m.mine} />
                ))
              )}
            </div>

            <div className="border-t border-line p-3">
              {files.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <PendingChip
                      key={i}
                      file={f}
                      onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              )}
              {sendError && <p className="mb-2 text-xs text-red-600">{sendError}</p>}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files ? Array.from(e.target.files) : []);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData?.files;
                    if (pasted && pasted.length > 0) {
                      addFiles(Array.from(pasted));
                      e.preventDefault();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={`Message ${title}`}
                  className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || (!input.trim() && files.length === 0) || !conversationId}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white transition-colors hover:bg-brand-800 disabled:opacity-40"
                  title="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* New DM picker */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-line bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-semibold text-slate-900">New message</h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search people…"
                  className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filteredPeople.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted">No one matches.</p>
                )}
                {filteredPeople.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPickerOpen(false);
                      setPickerQuery("");
                      void select(`direct:${p.id}`);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                      {initials(p.name)}
                    </div>
                    <span className="text-sm text-slate-800">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListButton({
  active,
  onClick,
  icon,
  avatar,
  label,
  unread,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  avatar?: string;
  label: string;
  unread: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {avatar ? (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[10px] font-semibold text-white">
          {initials(avatar)}
        </div>
      ) : (
        <span className="shrink-0 text-slate-400">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unread > 0 && (
        <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {unread}
        </span>
      )}
    </button>
  );
}

function Avatar({ m }: { m: ChatMessageView }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-700 text-[10px] font-semibold text-white">
      {m.senderPhotoStaffId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/photo/${m.senderPhotoStaffId}`}
          alt={m.senderName}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(m.senderName)
      )}
    </div>
  );
}

function Attachment({ a }: { a: ChatMessageView["attachments"][number] }) {
  if (a.contentType.startsWith("image/")) {
    return (
      <a href={`/api/chat/file/${a.id}`} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/chat/file/${a.id}`}
          alt={a.name}
          className="max-h-64 max-w-[240px] rounded-lg border border-line object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={`/api/chat/file/${a.id}?download=1`}
      className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 hover:bg-slate-50"
    >
      <FileText className="h-5 w-5 shrink-0 text-brand-700" />
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-sm font-medium text-slate-800">
          {a.name}
        </span>
        <span className="text-[10px] text-muted">{formatBytes(a.size)}</span>
      </span>
      <Download className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
    </a>
  );
}

function Message({ m, showName }: { m: ChatMessageView; showName: boolean }) {
  return (
    <div className={cn("flex items-end gap-2", m.mine ? "flex-row-reverse" : "flex-row")}>
      <Avatar m={m} />
      {/*
        The 75% cap belongs here, on the flex item whose width comes from the
        row, not on the bubble. On the bubble it resolved against this
        shrink-to-fit column instead — so every bubble was squeezed to 75% of
        the text's own natural width, wrapping perfectly short messages onto
        several lines.
      */}
      <div
        className={cn(
          "flex min-w-0 max-w-[75%] flex-col",
          m.mine ? "items-end" : "items-start",
        )}
      >
        {showName && <span className="mb-0.5 px-1 text-xs text-muted">{m.senderName}</span>}
        {m.body && (
          <div
            className={cn(
              "rounded-2xl px-3 py-2 text-sm",
              m.mine ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-800",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </div>
        )}
        {m.attachments.length > 0 && (
          <div className={cn("mt-1 flex flex-col gap-1.5", m.mine ? "items-end" : "items-start")}>
            {m.attachments.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        <span className="mt-0.5 px-1 text-[10px] text-slate-400">{timeLabel(m.createdAt)}</span>
      </div>
    </div>
  );
}
