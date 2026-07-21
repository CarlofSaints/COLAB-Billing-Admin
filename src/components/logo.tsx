import { cn } from "@/lib/utils";

/** COLAB stacked-letter mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 flex-col items-center justify-center rounded-lg bg-brand-700 leading-none text-white",
        className,
      )}
    >
      <span className="text-[11px] font-bold tracking-widest">CO</span>
      <span className="text-[11px] font-bold tracking-widest text-accent-400">LAB</span>
    </div>
  );
}

export function Logo({ subtitle = "Billing & Admin" }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className="text-sm font-bold tracking-wide text-white">COLAB</div>
        <div className="text-[11px] font-medium text-slate-400">{subtitle}</div>
      </div>
    </div>
  );
}
