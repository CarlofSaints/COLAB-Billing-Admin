import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "slate" | "indigo" | "violet";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  brand: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-800 text-white",
  indigo: "bg-indigo-50 text-indigo-700",
  violet: "bg-violet-50 text-violet-700",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
