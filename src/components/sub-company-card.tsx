import Link from "next/link";
import { brandFor } from "@/lib/brands";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Branded tile for a sub-company — colour accent + name + tagline, matching the
 * card style on colab2.co.za. Used on the dashboard as the sub-company "logos".
 */
export function SubCompanyCard({
  name,
  href,
  staffCount,
  sqm,
  fixedItems,
  rent,
  otherExpenses,
  className,
}: {
  name: string;
  href?: string;
  staffCount?: number;
  sqm?: number;
  /** Each item's name plus how this company's share reads, e.g. "×3" or "25%". */
  fixedItems?: { name: string; share: string }[];
  /** Monthly rent share, from the effective floor-space calculation. */
  rent?: number;
  /** Everything else billed monthly (currently the fixed line items). */
  otherExpenses?: number;
  className?: string;
}) {
  const brand = brandFor(name);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const inner = (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-line bg-white p-5 shadow-sm transition-all hover:shadow-md",
        className,
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-1 transition-all group-hover:h-1.5"
        style={{ backgroundColor: brand.color }}
      />
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg text-sm font-black text-white"
          style={{ backgroundColor: brand.color }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate font-bold text-colab-black">{name}</div>
          <div
            className="truncate text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: brand.color }}
          >
            {brand.tagline}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
        {typeof staffCount === "number" && (
          <div className="flex items-center justify-between">
            <span className="text-muted">Staff</span>
            <span className="font-medium text-slate-700">
              {staffCount} {staffCount === 1 ? "person" : "people"}
            </span>
          </div>
        )}
        {typeof sqm === "number" && (
          <div className="flex items-center justify-between">
            <span className="text-muted">Occupied space</span>
            <span className="font-medium text-slate-700">
              {sqm.toLocaleString()} m²
            </span>
          </div>
        )}
      </div>

      {(typeof rent === "number" || typeof otherExpenses === "number") && (
        <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
          {typeof rent === "number" && (
            <div className="flex items-center justify-between">
              <span className="text-muted">Rent</span>
              <span className="font-semibold text-slate-900">
                {rent > 0 ? formatCurrency(rent) : "—"}
              </span>
            </div>
          )}
          {typeof otherExpenses === "number" && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Other expenses</span>
                <span className="font-semibold text-slate-900">
                  {otherExpenses > 0 ? formatCurrency(otherExpenses) : "—"}
                </span>
              </div>
              {fixedItems && fixedItems.length > 0 && (
                <div className="mt-0.5 text-[11px] leading-tight text-muted">
                  {/* Always show the share — a bare "Parking Bays" next to a
                      "Parking Bays ×3" reads as if the count is missing. */}
                  {fixedItems.map((f) => `${f.name} ${f.share}`).join(", ")}
                </div>
              )}
            </div>
          )}
          {typeof rent === "number" && typeof otherExpenses === "number" && (
            <div className="flex items-center justify-between border-t border-line pt-1.5">
              <span className="font-medium text-slate-700">Total for the month</span>
              <span className="font-bold text-slate-900">
                {formatCurrency(rent + otherExpenses)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}
