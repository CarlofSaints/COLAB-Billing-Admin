/**
 * Round-trips once-off bills against the live database: creates a draft and a
 * submitted bill, proves the draft reaches no invoice and the submitted one
 * does, checks the split maths matches what the page would show, then deletes
 * both. Nothing is left behind and no email is sent.
 *
 * Read-mostly: the only writes are the two test bills, which are removed at
 * the end (and on failure, via the finally block).
 *
 *   npx tsx scripts/check-once-off-bills.ts
 *
 * ⚠️ `server-only` is not an installed package — Next aliases it at build
 * time — so importing src/lib from tsx needs a two-line stub in
 * node_modules/server-only. Create it, run this, then DELETE it: a stale stub
 * would mask a genuinely missing dependency.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { onceOffBillAllocations, onceOffBills } from "@/db/schema";
import {
  billQuantity,
  billTotal,
  billableCompanies,
  loadOnceOffBill,
  loadOnceOffBills,
  onceOffInvoiceLines,
  resolveBillLines,
} from "@/lib/once-off-bills";
import { loadSplitBasis } from "@/lib/split-basis";
import { fixedSplitModeLabel } from "@/lib/billing-calc";

const PERIOD = "2099-01"; // far future, so it can never collide with a real run
const created: number[] = [];

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function makeBill(input: {
  description: string;
  splitMode: "quantity" | "headcount";
  unitAmount: number;
  status: "draft" | "submitted";
  allocations: { companyId: number; quantity: number }[];
}) {
  const [row] = await db
    .insert(onceOffBills)
    .values({
      description: input.description,
      period: PERIOD,
      splitMode: input.splitMode,
      unitAmount: input.unitAmount.toFixed(2),
      status: input.status,
      createdByName: "check-once-off-bills",
      createdByEmail: "nobody@example.invalid",
    })
    .returning();
  created.push(row.id);
  await db.insert(onceOffBillAllocations).values(
    input.allocations.map((a) => ({
      onceOffBillId: row.id,
      companyId: a.companyId,
      quantity: a.quantity.toFixed(2),
    })),
  );
  return row.id;
}

async function main() {
  const { basis } = await loadSplitBasis();
  const companies = await billableCompanies();
  console.log(
    `Sub-companies: ${companies.map((c) => `${c.name}(#${c.id})`).join(", ")}\n` +
      `Headcount: ${companies.map((c) => `${c.name} ${basis.headcount[c.id] ?? 0}`).join(", ")} ` +
      `(total ${basis.totalHeadcount})\n`,
  );
  if (companies.length < 2) throw new Error("Need at least two sub-companies to test a split.");

  /* ---- 1. Quantity mode ------------------------------------------- */
  console.log("1. Quantity split (40 chairs at R1 250, 25 / 15)");
  const qtyId = await makeBill({
    description: "TEST chairs",
    splitMode: "quantity",
    unitAmount: 1250,
    status: "draft",
    allocations: [
      { companyId: companies[0].id, quantity: 25 },
      { companyId: companies[1].id, quantity: 15 },
    ],
  });
  const qtyBill = (await loadOnceOffBill(qtyId))!;
  const qtyLines = resolveBillLines(qtyBill, basis);
  check("total is 40 × R1 250 = R50 000", billTotal(qtyBill, basis) === 50000, `got ${billTotal(qtyBill, basis)}`);
  check("quantity totals 40", billQuantity(qtyBill) === 40, `got ${billQuantity(qtyBill)}`);
  check(
    "first company pays 25 × 1250 = R31 250",
    qtyLines.find((l) => l.companyId === companies[0].id)?.amount === 31250,
  );
  check(
    "second company pays 15 × 1250 = R18 750",
    qtyLines.find((l) => l.companyId === companies[1].id)?.amount === 18750,
  );

  /* ---- 2. A draft reaches NO invoice ------------------------------ */
  console.log("\n2. A draft must not reach the invoice run");
  const draftLines = await onceOffInvoiceLines(PERIOD, basis);
  check("no invoice lines while it is a draft", draftLines.length === 0, `got ${draftLines.length}`);

  /* ---- 3. Submitting puts it on the run --------------------------- */
  console.log("\n3. Submitted bills DO reach the invoice run");
  await db
    .update(onceOffBills)
    .set({ status: "submitted", submittedAt: new Date(), submittedByName: "check script" })
    .where(eq(onceOffBills.id, qtyId));
  const submittedLines = await onceOffInvoiceLines(PERIOD, basis);
  check("two invoice lines appear", submittedLines.length === 2, `got ${submittedLines.length}`);
  check(
    "they total R50 000",
    Math.round(submittedLines.reduce((s, l) => s + l.amount, 0) * 100) / 100 === 50000,
  );
  check(
    "the description carries the month",
    submittedLines[0]?.description === "TEST chairs — January 2099",
    submittedLines[0]?.description,
  );

  /* ---- 4. A derived split re-splits itself ------------------------ */
  console.log("\n4. Per-head split is derived from today's headcount, not stored");
  const headId = await makeBill({
    description: "TEST team lunch",
    splitMode: "headcount",
    unitAmount: 10000,
    status: "submitted",
    // Every company ticked; the stored quantity is 0 for a derived mode.
    allocations: companies.map((c) => ({ companyId: c.id, quantity: 0 })),
  });
  const headBill = (await loadOnceOffBill(headId))!;
  const headLines = resolveBillLines(headBill, basis);
  const headTotal = billTotal(headBill, basis);
  for (const l of headLines) {
    const name = companies.find((c) => c.id === l.companyId)?.name;
    console.log(
      `     ${name}: ${basis.headcount[l.companyId] ?? 0} heads → ${l.share.toFixed(2)}% → R${l.amount.toFixed(2)}`,
    );
  }
  check("every stored quantity was 0", headBill.allocations.every((a) => a.quantity === 0));
  check("shares are non-zero", headLines.every((l) => l.share > 0));
  check("quantity is reported as n/a on a percentage-shaped split", billQuantity(headBill) === null);
  check("the parts add back to R10 000 (±1c rounding)", Math.abs(headTotal - 10000) < 0.02, `got ${headTotal}`);

  /* ---- 5. Both are on the run, and only for their month ----------- */
  console.log("\n5. Period scoping");
  const both = await onceOffInvoiceLines(PERIOD, basis);
  check("both bills produce lines", both.length === 2 + headLines.length, `got ${both.length}`);
  const otherMonth = await onceOffInvoiceLines("2099-02", basis);
  check("a different month sees none of them", otherMonth.length === 0, `got ${otherMonth.length}`);

  /* ---- 6. The list the page renders ------------------------------- */
  console.log("\n6. What the page loads");
  const listed = await loadOnceOffBills({ period: PERIOD });
  check("both bills are listed", listed.length === 2, `got ${listed.length}`);
  for (const b of listed) {
    console.log(
      `     ${b.description}: ${fixedSplitModeLabel(b.splitMode)}, ${b.status}, R${billTotal(b, basis).toFixed(2)}`,
    );
  }
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    failures++;
  })
  .finally(async () => {
    if (created.length > 0) {
      await db.delete(onceOffBills).where(inArray(onceOffBills.id, created));
      const left = await loadOnceOffBills({ period: PERIOD });
      console.log(
        `\nCleaned up ${created.length} test bill(s). ${left.length} left behind${left.length ? " ⚠️" : "."}`,
      );
      if (left.length > 0) failures++;
    }
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
