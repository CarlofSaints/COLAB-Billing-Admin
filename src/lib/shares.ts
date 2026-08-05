/**
 * Each value's share of the whole, as whole percentages that add to 100.
 *
 * Client-safe and free of any database import: the dashboard computes these on
 * the server, but the maths is the kind that wants testing on its own.
 *
 * ⚠️ ROUNDING EACH SHARE INDEPENDENTLY IS THE OBVIOUS IMPLEMENTATION AND IT IS
 * WRONG. Four companies on 12.5% each round to 13% and the column reads 52%;
 * three on 33.33% round to 33% and it reads 99%. Somebody looking at a billing
 * dashboard notices that immediately and stops trusting the numbers.
 *
 * So this uses largest remainder: everyone gets their floor, and the leftover
 * points go to whoever was cut by the most. The result always sums to exactly
 * 100, and no share is ever more than a point from its true value.
 */

/**
 * Returns one percentage per value, or nulls when there is nothing to divide —
 * a share of zero is not 0%, it's "not applicable", and a card showing "(0%)"
 * for every line in a month with no expenses reads as a bug.
 *
 * Negative values are treated as zero: they can only come from a data problem,
 * and a negative share of a total is not a thing anyone can act on.
 */
export function percentShares(values: number[]): (number | null)[] {
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = safe.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => null);

  const exact = safe.map((v) => (v / total) * 100);
  const shares = exact.map(Math.floor);
  let leftover = 100 - shares.reduce((sum, s) => sum + s, 0);

  // Biggest fractional part first; ties go to the earlier company so the same
  // data always produces the same card, rather than shifting a point around on
  // every render.
  const byRemainder = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    shares[index] += 1;
    leftover -= 1;
  }

  return shares;
}

/** "(12%)" — or nothing at all when there's no total to take a share of. */
export function percentLabel(share: number | null | undefined): string {
  return share == null ? "" : `(${share}%)`;
}
