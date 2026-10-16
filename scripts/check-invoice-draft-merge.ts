/**
 * Self-check for mergeDraft: a saved draft keeps its edits and follows the
 * calculation for everything else. Pure, no DB.
 *
 *   npx tsx scripts/check-invoice-draft-merge.ts
 */
import assert from "node:assert/strict";
import { mergeDraft } from "../src/lib/invoice-draft-merge";

const L = (key: string, amount: number, description = key) => ({ key, description, amount, detail: [] });

const atSave = [L("acct-1", 100), L("acct-2", 200), L("acct-3", 300)];
const saved = {
  companyId: 1,
  lines: [
    L("acct-1", 150), // edited by hand
    L("acct-2", 200), // untouched
    // acct-3 deleted on purpose
    L("manual-1-1", 50, "Extra"), // added by hand
  ],
  calculated: atSave.map(({ key, description, amount }) => ({ key, description, amount })),
};

const now = [L("acct-1", 110), L("acct-2", 250), L("acct-3", 300), L("onceoff-13-1", 999)];
const merged = mergeDraft(now, saved);
const byKey = new Map(merged.map((l) => [l.key, l]));

assert.equal(byKey.get("acct-1")?.amount, 150, "an edited line keeps the edit");
assert.equal(byKey.get("acct-1")?.change, undefined);
assert.equal(byKey.get("acct-2")?.amount, 250, "an untouched line follows the calculation");
assert.equal(byKey.get("acct-2")?.change, "updated");
assert.equal(byKey.has("acct-3"), false, "a line deleted on purpose stays deleted");
assert.equal(byKey.get("manual-1-1")?.amount, 50, "a hand-added line is kept");
assert.equal(byKey.get("onceoff-13-1")?.change, "added", "a cost added after the save comes in");
assert.equal(byKey.get("onceoff-13-1")?.amount, 999);

// The calculation dropped a line the draft still has: kept, flagged, never silently removed.
const gone = mergeDraft([L("acct-1", 110)], saved);
assert.equal(gone.find((l) => l.key === "acct-2")?.change, "gone");
assert.equal(gone.find((l) => l.key === "manual-1-1")?.change, undefined, "hand-added lines are never 'gone'");

// A draft saved before `calculated` existed: anything missing counts as new.
const legacy = mergeDraft(now, { companyId: 1, lines: [L("acct-1", 150)] });
assert.deepEqual(legacy.map((l) => [l.key, l.change]), [
  ["acct-1", undefined],
  ["acct-2", "added"],
  ["acct-3", "added"],
  ["onceoff-13-1", "added"],
]);

// No saved draft: the calculation, untouched.
assert.deepEqual(mergeDraft(now, undefined), now);

console.log("OK mergeDraft: 14 checks");
