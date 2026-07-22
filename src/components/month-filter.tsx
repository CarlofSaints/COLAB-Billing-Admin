"use client";

import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Select } from "@/components/ui/field";
import { periodLabel } from "@/lib/periods";

/** Month picker that drives a page's `?period=` search param. */
export function MonthFilter({
  period,
  periods,
  basePath,
}: {
  period: string;
  periods: string[];
  basePath: string;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <CalendarRange className="h-4 w-4 text-muted" />
      <Select
        className="w-44"
        value={period}
        onChange={(e) => router.push(`${basePath}?period=${e.target.value}`)}
      >
        {periods.map((p) => (
          <option key={p} value={p}>
            {periodLabel(p)}
          </option>
        ))}
      </Select>
    </div>
  );
}
