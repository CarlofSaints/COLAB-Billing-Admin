import { cn } from "@/lib/utils";

/**
 * Authentic COLAB wordmark — the letters C·O·L·A·B, each with its brand-coloured
 * dot (the "O" is a dash), matching colab2.co.za.
 */
const MARKS = [
  { ch: "C", color: "#ED1C24" },
  { ch: "O", color: "#FFFFFF", dash: true },
  { ch: "L", color: "#8DC63F" },
  { ch: "A", color: "#F15A29" },
  { ch: "B", color: "#29ABE2" },
];

type Size = "sm" | "md" | "lg";
type Tone = "light" | "dark";

const SIZES: Record<Size, { letter: string; gap: string; dot: string; dash: string; mt: string }> = {
  sm: { letter: "text-lg", gap: "gap-1.5", dot: "h-1 w-1", dash: "h-[3px] w-2.5", mt: "mt-1" },
  md: { letter: "text-3xl", gap: "gap-2.5", dot: "h-1.5 w-1.5", dash: "h-1 w-3.5", mt: "mt-1.5" },
  lg: { letter: "text-5xl", gap: "gap-3.5", dot: "h-2.5 w-2.5", dash: "h-1.5 w-5", mt: "mt-2.5" },
};

export function ColabWordmark({
  size = "sm",
  tone = "light",
  className,
}: {
  size?: Size;
  tone?: Tone;
  className?: string;
}) {
  const s = SIZES[size];
  const letterColor = tone === "light" ? "text-white" : "text-colab-black";
  return (
    <div className={cn("flex items-end", s.gap, className)}>
      {MARKS.map((m) => {
        const isDash = Boolean(m.dash);
        const color = isDash ? (tone === "light" ? "#FFFFFF" : "#111111") : m.color;
        return (
          <div key={m.ch} className="flex flex-col items-center">
            <span className={cn("font-black leading-none tracking-widest", s.letter, letterColor)}>
              {m.ch}
            </span>
            <span
              className={cn("rounded-full", isDash ? s.dash : s.dot, s.mt)}
              style={{ backgroundColor: color }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Sidebar logo: wordmark + subtitle (for dark backgrounds). */
export function Logo({ subtitle = "Billing & Admin" }: { subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ColabWordmark size="sm" tone="light" />
      <span className="text-[11px] font-medium tracking-wide text-slate-400">{subtitle}</span>
    </div>
  );
}
