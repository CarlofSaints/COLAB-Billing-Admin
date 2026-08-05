import Link from "next/link";
import { brandFor } from "@/lib/brands";
import { percentLabel } from "@/lib/shares";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * The share of the whole this line represents, in brackets after the figure.
 *
 * Lighter and smaller than the number it follows: the figure is the fact, the
 * percentage is the context, and a card with ten equally-weighted numbers on it
 * is a card nobody reads. Renders nothing at all when there's no total to take
 * a share of, rather than "(0%)" on every line of a quiet month.
 */
function Share({ of }: { of?: number | null }) {
  const label = percentLabel(of);
  if (!label) return null;
  return <span className="ml-0.5 font-normal tabular-nums text-slate-400">{label}</span>;
}

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
  shares,
  className,
}: {
  name: string;
  href?: string;
  staffCount?: number;
  sqm?: number;
  /**
   * Each item's name, how this company's share reads ("×3", "25%", or
   * "3 tagged" for a costed tag), and what it comes to.
   */
  fixedItems?: { name: string; share: string; amount?: number }[];
  /** Monthly rent share, from the effective floor-space calculation. */
  rent?: number;
  /** Everything else billed monthly (currently the fixed line items). */
  otherExpenses?: number;
  /**
   * This company's share of each line across all the sub-companies, as whole
   * percentages. Worked out together on the dashboard rather than per card,
   * because they're only meaningful as a set — see `percentShares`, which makes
   * the column add to exactly 100.
   */
  shares?: {
    staff?: number | null;
    sqm?: number | null;
    rent?: number | null;
    other?: number | null;
    total?: number | null;
  };
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
            <span className="text-muted">Team</span>
            <span className="font-medium text-slate-700">
              {staffCount} {staffCount === 1 ? "person" : "people"} <Share of={shares?.staff} />
            </span>
          </div>
        )}
        {typeof sqm === "number" && (
          <div className="flex items-center justify-between">
            <span className="text-muted">Occupied space</span>
            <span className="font-medium text-slate-700">
              {sqm.toLocaleString()} m² <Share of={shares?.sqm} />
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
                {rent > 0 ? formatCurrency(rent) : "—"} <Share of={shares?.rent} />
              </span>
            </div>
          )}
          {typeof otherExpenses === "number" && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Other expenses</span>
                {/* ⚠️ A NEGATIVE HERE IS REAL AND MUST BE SHOWN. It used to
                    test `> 0`, so a month-end credit larger than the recurring
                    fixed items rendered as an em dash — the card then showed
                    rent, a dash, and a total that was smaller than the rent
                    above it and explained by nothing on screen. */}
                <span
                  className={cn(
                    "font-semibold",
                    otherExpenses < 0 ? "text-emerald-700" : "text-slate-900",
                  )}
                >
                  {otherExpenses !== 0 ? formatCurrency(otherExpenses) : "—"}{" "}
                  <Share of={shares?.other} />
                </span>
              </div>
              {fixedItems && fixedItems.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {/* Itemised rather than a comma-separated run-on: a costed
                      tag's line is a real charge, and "Parking 3 tagged" with
                      no amount next to it invites the question anyway. */}
                  {fixedItems.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between gap-2 text-[11px] leading-tight text-muted"
                    >
                      <span className="truncate">
                        {f.name} <span className="text-slate-400">{f.share}</span>
                      </span>
                      {typeof f.amount === "number" && (
                        <span className="shrink-0 tabular-nums text-slate-600">
                          {formatCurrency(f.amount)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {typeof rent === "number" && typeof otherExpenses === "number" && (
            <div className="flex items-center justify-between border-t border-line pt-1.5">
              <span className="font-medium text-slate-700">Total for the month</span>
              <span className="font-bold text-slate-900">
                {formatCurrency(rent + otherExpenses)} <Share of={shares?.total} />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}
