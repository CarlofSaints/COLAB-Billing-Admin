import type { SavedInvoiceCompany, SavedInvoiceLine } from "@/db/schema";

/**
 * Why a line on a saved draft differs from what was saved:
 * - added:   the calculation has a line that didn't exist when the draft was
 *            saved (a once-off bill submitted later, a new Xero bill).
 * - updated: nobody had touched this line, and the calculation has moved, so it
 *            follows the calculation.
 * - gone:    the calculation no longer produces this line (e.g. the once-off
 *            bill was deleted). Kept, never silently dropped, so a person decides.
 */
export type LineChange = "added" | "updated" | "gone";
export type MergedLine = SavedInvoiceLine & { change?: LineChange };

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * A draft is hand edits laid over the LIVE calculation, not a frozen copy: edited
 * and hand-added lines keep their edits, everything else follows the calculation.
 * `saved.calculated` is what the engine said at save time; it is how an untouched
 * line is told from an edited one, and a line deleted on purpose from a new one.
 * Drafts saved before it existed have none, so every missing line counts as new.
 */
export function mergeDraft(
  calc: SavedInvoiceLine[],
  saved: SavedInvoiceCompany | undefined,
): MergedLine[] {
  if (!saved) return calc;
  const now = new Map(calc.map((l) => [l.key, l]));
  const then = new Map((saved.calculated ?? []).map((l) => [l.key, l]));

  const out: MergedLine[] = saved.lines.map((l) => {
    const c = now.get(l.key);
    if (!c) return l.key.startsWith("manual-") ? l : { ...l, change: "gone" };
    const t = then.get(l.key);
    const untouched = t && same(t.amount, l.amount) && t.description === l.description;
    const moved = !same(c.amount, l.amount) || c.description !== l.description;
    return untouched && moved ? { ...c, change: "updated" } : l;
  });

  const savedKeys = new Set(saved.lines.map((l) => l.key));
  for (const c of calc) {
    if (!savedKeys.has(c.key) && !then.has(c.key)) out.push({ ...c, change: "added" });
  }
  return out;
}
