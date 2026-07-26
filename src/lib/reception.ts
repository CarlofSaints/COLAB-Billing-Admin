// Shared helpers for the reception rota. Pure functions — safe on client too.

export const RECEPTION_DEFAULTS = { startMin: 8 * 60, endMin: 17 * 60, slotMin: 30 };
export const RECEPTION_TAG = "Reception";

/** minutes-from-midnight → "HH:MM". */
export function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM" → minutes-from-midnight, or null if invalid. */
export function labelToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Build slot boundaries [start,end] from start→end in `slotMin` steps. */
export function buildSlotRanges(
  startMin: number,
  endMin: number,
  slotMin: number,
): { startMinute: number; endMinute: number }[] {
  const out: { startMinute: number; endMinute: number }[] = [];
  for (let s = startMin; s < endMin; s += slotMin) {
    out.push({ startMinute: s, endMinute: Math.min(s + slotMin, endMin) });
  }
  return out;
}
