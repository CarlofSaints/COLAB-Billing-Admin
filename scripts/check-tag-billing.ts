/**
 * Read-only sanity check: what every fixed line item resolves to right now.
 * Manual items must be unchanged by the costed-tag work; tagged ones should
 * show counts. Nothing is written.
 *
 *   npx tsx scripts/check-tag-billing.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { companies, fixedLineAllocations, fixedLineItems, tags } = await import("../src/db/schema");
  const { loadFixedAllocations } = await import("../src/lib/tag-billing");
  const { fixedAllocationAmount } = await import("../src/lib/billing-calc");

  const companyRows = await db.select().from(companies);
  const name = (id: number) => companyRows.find((c) => c.id === id)?.name ?? `#${id}`;

  const tagRows = await db.select().from(tags);
  console.log("TAGS");
  for (const t of tagRows) {
    console.log(`  ${t.name.padEnd(20)} ${t.costPerPerson ? `R${t.costPerPerson} each` : "label only"}`);
  }

  const items = await db.select().from(fixedLineItems);
  const allocs = await db.select().from(fixedLineAllocations);
  const resolved = await loadFixedAllocations(items, allocs);

  console.log("\nFIXED LINE ITEMS");
  for (const item of items) {
    const spec = { splitMode: item.splitMode, unitAmount: Number(item.unitAmount) };
    const mine = resolved.get(item.id) ?? [];
    const total = mine.reduce((s, a) => s + fixedAllocationAmount(spec, a.quantity), 0);
    const source = item.tagId === null ? "manual" : "tag";
    console.log(
      `  ${item.name} — R${spec.unitAmount} ${spec.splitMode} · ${source}` +
        `${item.active ? "" : " · INACTIVE"} · total R${total.toFixed(2)}`,
    );
    for (const a of mine) {
      console.log(
        `      ${name(a.companyId).padEnd(22)} ×${a.quantity} = R${fixedAllocationAmount(spec, a.quantity).toFixed(2)}`,
      );
    }
    if (mine.length === 0) console.log("      (no companies)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
