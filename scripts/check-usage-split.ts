/**
 * Self-check for usagePercentages: usage → 2-decimal percentages totalling 100.
 *
 *   npx tsx scripts/check-usage-split.ts
 */
import assert from "node:assert/strict";
import { parsePercentages, usagePercentages } from "../src/lib/expense-accounts";

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

assert.deepEqual(usagePercentages([1, 1, 1]), [33.34, 33.33, 33.33], "thirds still total 100");
assert.equal(sum(usagePercentages([144, 863, 138, 855])!), 100);
assert.deepEqual(usagePercentages([300, 0, 100, 0]), [75, 0, 25, 0], "no usage = 0%");
assert.equal(usagePercentages([0, 0]), null, "nothing to divide");
assert.equal(usagePercentages([-5, 0]), null, "negative usage is ignored");

// Usage survives the server's parser; junk usage is dropped, the percentage kept.
assert.deepEqual(parsePercentages([{ companyId: 2, percent: 75, usage: 300 }]), [
  { companyId: 2, percent: 75, usage: 300 },
]);
assert.deepEqual(parsePercentages([{ companyId: 2, percent: 100, usage: "x" }]), [
  { companyId: 2, percent: 100 },
]);

console.log("OK usagePercentages: 7 checks");
