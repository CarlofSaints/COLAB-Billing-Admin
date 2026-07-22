"use client";

import { useState } from "react";
import { Send, CalendarClock } from "lucide-react";
import { MailComposer } from "./mail-client";
import { SchedulesPanel, type ScheduleRow } from "./schedules-client";
import { cn } from "@/lib/utils";

type GroupOpt = { id: number; name: string; description: string; recipientCount: number };

const TABS = [
  { key: "compose", label: "Compose", icon: Send },
  { key: "schedules", label: "Scheduled reminders", icon: CalendarClock },
] as const;

export function MailTabs({
  groups,
  schedules,
  configured,
}: {
  groups: GroupOpt[];
  schedules: ScheduleRow[];
  configured: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("compose");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-line bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {t.key === "schedules" && schedules.length > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    active ? "bg-white/20" : "bg-slate-100",
                  )}
                >
                  {schedules.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "compose" ? (
        <MailComposer groups={groups} configured={configured} />
      ) : (
        <SchedulesPanel
          schedules={schedules}
          groups={groups.map((g) => ({
            id: g.id,
            name: g.name,
            recipientCount: g.recipientCount,
          }))}
          configured={configured}
        />
      )}
    </div>
  );
}
