import { cn } from "@/lib/utils";

const FALLBACK = "#64748b";

/**
 * A tag pill. Display-only by default; pass `onClick` to make it a toggle
 * button (used by the multiselect on the team-member form), where `selected`
 * controls whether it shows in colour or muted.
 */
export function TagChip({
  name,
  color,
  selected,
  onClick,
  className,
}: {
  name: string;
  color?: string | null;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const c = color || FALLBACK;
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors";
  const colored = { backgroundColor: `${c}22`, color: c, borderColor: `${c}55` };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(base, !selected && "text-slate-500 hover:bg-slate-50", className)}
        style={selected ? colored : { borderColor: "#e2e8f0" }}
      >
        {name}
      </button>
    );
  }

  return (
    <span className={cn(base, className)} style={colored}>
      {name}
    </span>
  );
}
