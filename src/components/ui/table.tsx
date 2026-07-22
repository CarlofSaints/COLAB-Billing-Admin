import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `sticky` drops the horizontal scroll wrapper so a sticky <thead> can anchor
 * to the page's scroll container — an `overflow-x-auto` ancestor is itself a
 * scroll container and would pin the header inside it instead. Only use it on
 * tables narrow enough not to need horizontal scrolling.
 */
export function Table({
  className,
  sticky,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { sticky?: boolean }) {
  return (
    <div className={cn("w-full", !sticky && "overflow-x-auto")}>
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function THead({
  className,
  sticky,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return (
    <thead className={cn("bg-slate-50", sticky && "sticky top-0 z-20", className)} {...props} />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-line px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-slate-50/60", className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-4 py-3 text-slate-700", className)} {...props} />;
}
