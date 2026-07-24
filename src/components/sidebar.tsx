"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  SlidersHorizontal,
  Building2,
  Wallet,
  Receipt,
  FileText,
  Users,
  Mails,
  Send,
  ShieldCheck,
  UserCog,
  UserRound,
  UserCheck,
  Sparkles,
  ScrollText,
  Plug,
  LogOut,
} from "lucide-react";
import { Logo } from "./logo";
import { logout } from "@/app/actions/auth";
import { cn, initials } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: string; // required permission key (super_admin bypasses)
};

type NavSection = { heading?: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  { items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    heading: "Team Hub",
    items: [
      { href: "/hub", label: "Team Dashboard", icon: Sparkles, perm: "hub.view" },
      { href: "/profile", label: "My Profile", icon: UserRound, perm: "profile.edit" },
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
      { href: "/companies", label: "Sub-Companies", icon: Building2, perm: "companies.view" },
    ],
  },
  {
    heading: "People",
    items: [
      { href: "/staff", label: "Staff", icon: Users, perm: "staff.view" },
      { href: "/email-groups", label: "Email Groups", icon: Mails, perm: "groups.view" },
      { href: "/mail", label: "Mail Sender", icon: Send, perm: "mail.send" },
    ],
  },
  {
    heading: "Administration",
    items: [
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
  const can = (perm?: string) =>
    !perm || user.roleKey === "super_admin" || user.permissions.includes(perm);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-slate-900 text-slate-300">
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
                        {it.label}
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
