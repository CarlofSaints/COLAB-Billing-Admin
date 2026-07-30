"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * The red count on the Chat nav item, so a message that arrives while someone
 * is on another page doesn't go unnoticed.
 *
 * Silent by design — no sound, no desktop notification, no title flash. It is
 * a number that appears and goes away again.
 *
 * Polled rather than pushed: the chat itself already polls, and adding a
 * socket for a badge would be a lot of moving parts for one number. Every 20
 * seconds off the chat page, because this runs on every screen in the app for
 * everyone signed in — the 3-second cadence inside the chat is affordable
 * precisely because it only runs while that page is open.
 */
const POLL_MS = 20_000;

export function ChatUnreadBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  // On /chat the page's own polling owns the count and is marking things read
  // as they're seen; a second poller here would fight it and flicker.
  const onChatPage = pathname?.startsWith("/chat") ?? false;

  useEffect(() => {
    if (onChatPage) {
      setCount(0);
      return;
    }

    let cancelled = false;

    const load = async () => {
      // Skip while the tab is hidden — no point polling a background tab, and
      // it comes back on the visibilitychange below.
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/chat/unread", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled) setCount(data.count ?? 0);
      } catch {
        // A failed poll is not worth surfacing: the next one is 20s away and
        // an error badge would be worse than a briefly stale number.
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [onChatPage, pathname]);

  if (count <= 0) return null;

  return (
    <span
      className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-none text-white"
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
