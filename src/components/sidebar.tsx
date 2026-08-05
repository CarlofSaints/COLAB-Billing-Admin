"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Menu,
  X,
  LayoutDashboard,
  SlidersHorizontal,
  Building2,
  Wallet,
  Receipt,
  Link2,
  FileText,
  Users,
  UsersRound,
  Mails,
  Send,
  ShieldCheck,
  UserCog,
  UserCheck,
  Sparkles,
  MessagesSquare,
  Megaphone,
  ListChecks,
  Tag,
  CalendarClock,
  CalendarDays,
  DoorOpen,
  Car,
  ScrollText,
  Plug,
  LogOut,
} from "lucide-react";
import { ColabWordmark, Logo } from "./logo";
import { ChatUnreadBadge } from "./chat-unread-badge";
import { logout } from "@/app/actions/auth";
import { cn, initials } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: string; // required permission key (super_admin bypasses)
};

type NavSection = { heading?: string; items: NavItem[] };

// Imported here rather than inlined so the polling lives in its own client
// component and doesn't re-render the whole sidebar every 20 seconds.

const SECTIONS: NavSection[] = [
  // Mirrors the redirect on the page itself: anyone without `companies.view`
  // is bounced from / to /hub, so offering them the link was pointing at a
  // page they can never actually see. Left without a `perm` it showed to
  // everyone, because `can()` treats "no permission required" as "always".
  {
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "companies.view" }],
  },
  {
    heading: "Team Hub",
    items: [
      { href: "/hub", label: "Team Dashboard", icon: Sparkles, perm: "hub.view" },
      { href: "/meet-the-team", label: "Meet Your Team", icon: UsersRound, perm: "hub.directory" },
      { href: "/bookings", label: "Room Bookings", icon: CalendarDays, perm: "hub.view" },
      // Booking a vehicle sits with the things everyone does, not with the
      // register under People — that one is fleet admin and needs vehicles.manage.
      { href: "/vehicle-bookings", label: "Vehicle Bookings", icon: Car, perm: "hub.view" },
      { href: "/chat", label: "Chat", icon: MessagesSquare, perm: "hub.view" },
      { href: "/issues", label: "Say Something!", icon: Megaphone, perm: "hub.view" },
      // Moved up from People: with team members able to reach them, these are
      // things the whole office uses, not admin tooling.
      { href: "/email-groups", label: "Email Groups", icon: Mails, perm: "groups.view" },
      { href: "/mail", label: "Mail Sender", icon: Send, perm: "mail.send" },
      // "My Profile" used to sit here. It's part of My Account now — the
      // avatar bottom-left is the single place for anything about you.
    ],
  },
  {
    heading: "Billing",
    items: [
      { href: "/invoices", label: "Invoice Run", icon: FileText, perm: "billing.view" },
      { href: "/controls", label: "Controls", icon: SlidersHorizontal, perm: "controls.view" },
      {
        href: "/expense-accounts",
        label: "Expense Accounts",
        icon: Wallet,
        perm: "controls.view",
      },
      {
        href: "/supplier-splits",
        label: "Supplier Splits",
        icon: Receipt,
        perm: "controls.view",
      },
      { href: "/creditor-links", label: "Creditor Links", icon: Link2, perm: "controls.view" },
      { href: "/companies", label: "Sub-Companies", icon: Building2, perm: "companies.view" },
    ],
  },
  {
    heading: "People",
    items: [
      { href: "/staff", label: "Team Members", icon: Users, perm: "staff.view" },
      { href: "/reception", label: "Reception Rota", icon: CalendarClock, perm: "reception.view" },
      { href: "/rooms", label: "Meeting Rooms", icon: DoorOpen, perm: "rooms.manage" },
      { href: "/vehicles", label: "Vehicles", icon: Car, perm: "vehicles.manage" },
    ],
  },
  {
    heading: "Administration",
    items: [
      { href: "/admin-tasks", label: "Admin Tasks", icon: ListChecks, perm: "tasks.view" },
      { href: "/tags", label: "Tags", icon: Tag, perm: "tags.manage" },
      { href: "/users", label: "Users", icon: UserCog, perm: "users.view" },
      {
        href: "/signup-requests",
        label: "Sign-up Requests",
        icon: UserCheck,
        perm: "team.invite",
      },
      { href: "/roles", label: "Roles & Permissions", icon: ShieldCheck, perm: "roles.manage" },
      { href: "/integrations", label: "Integrations", icon: Plug, perm: "integrations.manage" },
      { href: "/logs", label: "Activity Log", icon: ScrollText, perm: "logs.view" },
    ],
  },
];

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; roleKey: string; roleName: string; permissions: string[] };
}) {
  const pathname = usePathname();
  // On a phone the nav is a drawer. Closed on every navigation — otherwise
  // tapping a link leaves the menu covering the page you just asked for.
  //
  // Adjusted during render rather than in an effect: this is state derived from
  // where you are, not a side effect of arriving, and doing it in an effect
  // renders the drawer open for a frame first. Catches the back button too,
  // which closing it from the link's onClick would not.
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const can = (perm?: string) =>
    !perm || user.roleKey === "super_admin" || user.permissions.includes(perm);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Phone top bar. On a 390px screen a permanent 256px rail leaves 134px
          for the page, so below `md` the nav has to get out of the way. */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 text-slate-300 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the menu"
          aria-expanded={open}
          className="-ml-2 rounded-lg p-2 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>
        {/* The wordmark alone, not the sidebar `Logo` — that one stacks "Hub"
            beneath it and is taller than a 56px bar. */}
        <ColabWordmark size="sm" />
        <Link
          href="/account"
          aria-label="My account"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white"
        >
          {initials(user.name)}
        </Link>
      </header>

      {/* Tapping away closes it, which is what people expect of a drawer and is
          the only exit on a phone with no visible close target. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <SidebarNav
        user={user}
        can={can}
        isActive={isActive}
        pathname={pathname}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function SidebarNav({
  user,
  can,
  isActive,
  pathname,
  open,
  onClose,
}: {
  user: { name: string; roleName: string };
  can: (perm?: string) => boolean;
  isActive: (href: string) => boolean;
  pathname: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      className={cn(
        "z-50 flex w-64 shrink-0 flex-col bg-slate-900 text-slate-300",
        // Below md it's a drawer sliding over the page; from md it's the
        // ordinary rail the desktop layout has always had.
        "fixed inset-y-0 left-0 transition-transform duration-200 md:static md:h-full md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the menu"
        className="absolute right-2 top-4 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white md:hidden"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="px-5 py-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {SECTIONS.map((section, i) => {
          const items = section.items.filter((it) => can(it.perm));
          if (items.length === 0) return null;
          return (
            <div key={i}>
              {section.heading && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {section.heading}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((it) => {
                  const active = isActive(it.href);
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-brand-700 text-white"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white",
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                        <span className="flex-1">{it.label}</span>
                        {it.href === "/chat" && <ChatUnreadBadge />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Link
            href="/account"
            title="My account"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-colors hover:opacity-90"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
              {initials(user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="truncate text-xs text-slate-400">
                {pathname === "/account" ? "My account" : user.roleName}
              </p>
            </div>
          </Link>
          <form action={logout}>
            <button
              type="submit"
              title="Sign out"
              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
