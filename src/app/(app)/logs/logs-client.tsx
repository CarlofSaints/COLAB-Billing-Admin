"use client";

import { useMemo, useState } from "react";
import { Search, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

type LogEntry = {
  id: number;
  actorType: string;
  actorLabel: string;
  action: string;
  summary: string;
  entityType: string;
  entityId: string;
  ip: string;
  createdAt: string;
};

function actorTone(t: string) {
  if (t === "user") return "brand" as const;
  if (t === "api") return "amber" as const;
  return "neutral" as const;
}

export function LogViewer({ entries }: { entries: LogEntry[] }) {
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("all");

  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action.split(".")[0]))).sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (actor !== "all" && !e.action.startsWith(actor)) return false;
      if (!q) return true;
      return [e.summary, e.actorLabel, e.action].join(" ").toLowerCase().includes(q);
    });
  }, [entries, query, actor]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select className="w-48" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="all">All categories</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted">{filtered.length} events</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-8 w-8" />} title="No events match" />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH className="w-44">When</TH>
                <TH className="w-40">Actor</TH>
                <TH className="w-44">Action</TH>
                <TH>Summary</TH>
              </tr>
            </THead>
            <tbody>
              {filtered.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(e.createdAt)}
                  </TD>
                  <TD>
                    <Badge tone={actorTone(e.actorType)}>{e.actorLabel}</Badge>
                  </TD>
                  <TD>
                    <code className="font-mono text-xs text-slate-600">{e.action}</code>
                  </TD>
                  <TD className="text-slate-700">{e.summary}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
