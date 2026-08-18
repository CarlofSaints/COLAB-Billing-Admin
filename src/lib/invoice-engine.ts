import "server-only";
import { asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  creditorLinks,
  expenseAccountMappings,
  fixedLineAllocations,
  fixedLineItems,
  supplierSplits,
} from "@/db/schema";
import {
  fixedAllocationAmount,
  fixedItemTotal,
  fixedSplitModeLabel,
  isPercentShaped,
  rentShare,
} from "./billing-calc";
import { loadSplitBasis } from "./split-basis";
import type { SplitBasis } from "./split-basis";
import { fetchExpenseAccounts } from "./xero";
import { getMonthCosts } from "./month-costs";
import { periodLabel } from "./periods";
import { loadFixedAllocations } from "./tag-billing";
import { METHOD_BY_KEY } from "./expense-accounts";
import type { AccountMethod, PercentEntry } from "./expense-accounts";

export type RunType = "recurring" | "month_end";

export type PreviewLine = {
  /** Stable id so the editor can track a line across re-renders. */
  key: string;
  description: string;
  amount: number;
  /** What produced this line, for the drill-down. */
  detail: string[];
};

export type PreviewCompany = {
  companyId: number;
  name: string;
  xeroContactId: string | null;
  xeroContactName: string | null;
  lines: PreviewLine[];
  total: number;
};

export type PreviewWarning = {
  level: "warn" | "info";
  message: string;
  /** Optional in-app link to where it gets fixed. */
  href?: string;
  linkLabel?: string;
};

export type InvoicePreview = {
  period: string;
  runType: RunType;
  companies: PreviewCompany[];
  warnings: PreviewWarning[];
  grandTotal: number;
};

type Basis = SplitBasis;

/** Splits one amount across companies according to a resolved method. */
function allocate(
  amount: number,
  method: AccountMethod,
  basis: Basis,
  opts: { companyId?: number | null; percentages?: PercentEntry[] | null },
): Record<number, number> {
  const out: Record<number, number> = {};
  const totalArea = basis.companyIds.reduce((s, id) => s + (basis.area[id] ?? 0), 0);

  switch (method) {
    case "per_sqm": {
      if (totalArea <= 0) return out;
      for (const id of basis.companyIds) out[id] = (basis.area[id] / totalArea) * amount;
      return out;
    }
    case "headcount": {
      if (basis.totalHeadcount <= 0) return out;
      for (const id of basis.companyIds)
        out[id] = ((basis.headcount[id] ?? 0) / basis.totalHeadcount) * amount;
      return out;
    }
    case "equal": {
      if (basis.companyIds.length === 0) return out;
      const share = amount / basis.companyIds.length;
      for (const id of basis.companyIds) out[id] = share;
      return out;
    }
    case "percent": {
      for (const p of opts.percentages ?? []) out[p.companyId] = (p.percent / 100) * amount;
      return out;
    }
    case "direct": {
      if (opts.companyId) out[opts.companyId] = amount;
      return out;
    }
    // "fixed" is recovered by a fixed line item on the recurring run,
    // "controls" is billed from Controls, and "exclude" is never recharged —
    // none of them produce a month-end line.
    case "fixed":
    case "controls":
    case "exclude":
    default:
      return out;
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function formatRand(n: number) {
  return `R${n.toFixed(2)}`;
}

/**
 * Builds the invoice preview for a month. Nothing is written and nothing is
 * sent — this is purely what the invoices *would* say.
 */
export async function buildPreview(period: string, runType: RunType): Promise<InvoicePreview> {
  const { basis, companyRows, totalSqm, rentAmount } = await loadSplitBasis();
  const warnings: PreviewWarning[] = [];
  const linesByCompany = new Map<number, PreviewLine[]>();
  companyRows.forEach((c) => linesByCompany.set(c.id, []));

  const push = (companyId: number, line: PreviewLine) => {
    const list = linesByCompany.get(companyId);
    if (list) list.push(line);
  };

  const label = periodLabel(period);

  if (runType === "recurring") {
    // ---- Rent, on the effective floor-space share -------------------
    if (rentAmount > 0 && totalSqm > 0) {
      for (const c of companyRows) {
        const amount = round2(rentShare(basis.area[c.id] ?? 0, totalSqm, rentAmount));
        if (amount <= 0) continue;
        const area = basis.area[c.id] ?? 0;
        push(c.id, {
          key: `rent-${c.id}`,
          description: `Rent — ${label}`,
          amount,
          detail: [
            `${area.toFixed(1)} m² of ${totalSqm.toLocaleString()} m² (${((area / totalSqm) * 100).toFixed(1)}%)`,
            `Monthly rent R${rentAmount.toLocaleString()}`,
          ],
        });
      }
    } else {
      warnings.push({
        level: "warn",
        message:
          "No monthly rent or total building area is set, so no rent line was produced. Set both under Controls.",
        href: "/controls",
        linkLabel: "Open Controls",
      });
    }

    // ---- Fixed line items ------------------------------------------
    const items = await db
      .select()
      .from(fixedLineItems)
      .where(eq(fixedLineItems.active, true))
      .orderBy(asc(fixedLineItems.name));
    const allocations = await db.select().from(fixedLineAllocations);
    // Tag-driven items count their quantities from who carries the tag.
    const resolved = await loadFixedAllocations(items, allocations, basis);

    for (const item of items) {
      const spec = { splitMode: item.splitMode, unitAmount: Number(item.unitAmount) };
      for (const alloc of resolved.get(item.id) ?? []) {
        const share = alloc.quantity;
        const amount = fixedAllocationAmount(spec, share);
        if (amount <= 0) continue;
        push(alloc.companyId, {
          key: `fixed-${item.id}-${alloc.companyId}`,
          description: `${item.name} — ${label}`,
          amount,
          detail: [
            isPercentShaped(spec.splitMode)
              ? `${Math.round(share * 10) / 10}% of ${formatRand(spec.unitAmount)}` +
                (alloc.derived ? ` (${fixedSplitModeLabel(spec.splitMode).toLowerCase()})` : "")
              : alloc.fromTag
                ? `${share} × ${formatRand(spec.unitAmount)} (tagged team members)`
                : `${share} × ${formatRand(spec.unitAmount)}`,
          ],
        });
      }
    }
  } else {
    // ---- Month-end: the Xero actuals, split by the mappings ---------
    const [costs, accountList] = await Promise.all([
      getMonthCosts(period),
      fetchExpenseAccounts(),
    ]);

    if (!costs.ok) {
      warnings.push({
        level: "warn",
        message: `Couldn't read ${label} from Xero: ${costs.error}`,
      });
      return {
        period,
        runType,
        companies: companyRows.map((c) => ({
          companyId: c.id,
          name: c.name,
          xeroContactId: c.xeroContactId,
          xeroContactName: c.xeroContactName,
          lines: [],
          total: 0,
        })),
        warnings,
        grandTotal: 0,
      };
    }

    const accounts = accountList.ok ? accountList.accounts : [];
    const accountNameByCode = new Map(accounts.map((a) => [a.code ?? "", a.name]));

    if (!costs.reconciled) {
      warnings.push({
        level: "warn",
        message:
          "The P&L couldn't be read, so these figures are from supplier documents alone — anything posted by journal (such as payroll from Sage) is missing.",
      });
    }

    const [thisMonth, earlier, accountMappings, creditorLinkRows] = await Promise.all([
      db.select().from(supplierSplits).where(eq(supplierSplits.period, period)),
      db
        .select()
        .from(supplierSplits)
        .where(lt(supplierSplits.period, period))
        .orderBy(asc(supplierSplits.period)),
      db.select().from(expenseAccountMappings),
      db.select().from(creditorLinks),
    ]);
    const linkByContact = new Map(creditorLinkRows.map((l) => [l.xeroContactId, l]));

    const explicit = new Map(thisMonth.map((r) => [`${r.accountCode}|${r.xeroContactId}`, r]));
    const inherited = new Map<string, (typeof earlier)[number]>();
    for (const r of earlier) inherited.set(`${r.accountCode}|${r.xeroContactId}`, r);
    const byAccountCode = new Map(
      accountMappings.filter((m) => m.accountCode).map((m) => [m.accountCode!, m]),
    );

    // account code -> company -> { amount, contributors }
    const perAccount = new Map<
      string,
      { company: Record<number, number>; contributors: string[]; total: number }
    >();

    // What each fixed line item recovers from the companies each month.
    const fixedItemRows = await db.select().from(fixedLineItems);
    const fixedAllocRows = await db.select().from(fixedLineAllocations);
    // Same resolution as the recurring run above — otherwise a tagged item
    // would recover a different amount here than it billed, and the balance
    // would be wrong by exactly that difference.
    const resolvedRecovery = await loadFixedAllocations(fixedItemRows, fixedAllocRows, basis);
    const recoveredByItem = new Map<number, number>();
    for (const item of fixedItemRows) {
      // An inactive item never went out on the recurring invoice, so it
      // recovers nothing — deducting it here would under-recharge silently.
      if (!item.active) continue;
      recoveredByItem.set(
        item.id,
        fixedItemTotal(
          { splitMode: item.splitMode, unitAmount: Number(item.unitAmount) },
          (resolvedRecovery.get(item.id) ?? []).map((a) => a.quantity),
        ),
      );
    }

    let unsplitCount = 0;
    let unsplitValue = 0;
    let fallbackCount = 0;
    let recoveredElsewhere = 0;
    let unsplitBalance = 0;
    let billedFromControls = 0;
    const unsplitBalanceSuppliers: string[] = [];
    const creditedItems = new Set<number>();
    const duplicateItemUse = new Set<number>();
    // Costs from creditors linked to a recurring fixed item — pooled here and
    // reconciled after the loop instead of being split normally.
    const creditorPool = new Map<string, { name: string; total: number; contributors: string[] }>();

    /**
     * A fixed line item set on the *account* covers the account as a whole,
     * not each supplier line on it. Salary lines arrive as a new Xero contact
     * every month, so a per-line rule could never persist — the account rule
     * has to recover the item once and split what's left.
     */
    const accountFixed = new Map<
      string,
      {
        total: number;
        itemId: number | null;
        balanceMethod: AccountMethod | null;
        balanceCompanyId: number | null;
        balancePercentages: PercentEntry[] | null;
        contributors: string[];
      }
    >();

    for (const row of costs.rows) {
      const own = explicit.get(row.key);

      // Linked creditor (e.g. the landlord) — already billed on the recurring
      // invoice. Pool it for reconciliation and don't split it here. A manual
      // this-month split still wins, as an escape hatch.
      const link = linkByContact.get(row.contactId);
      if (link && !own) {
        const entry =
          creditorPool.get(row.contactId) ??
          { name: row.supplierName, total: 0, contributors: [] as string[] };
        entry.total += row.amount;
        entry.contributors.push(
          `${accountNameByCode.get(row.accountCode) ?? row.accountCode}: ${formatRand(row.amount)}`,
        );
        creditorPool.set(row.contactId, entry);
        continue;
      }

      const prior = inherited.get(row.key);
      const accountDefault = byAccountCode.get(row.accountCode);
      const winner = own ?? prior ?? accountDefault ?? null;

      if (!winner) {
        unsplitCount += 1;
        unsplitValue += row.amount;
        continue;
      }
      if (!own && !prior && accountDefault) fallbackCount += 1;

      const method = winner.method as AccountMethod;
      if (method === "exclude") continue;
      if (method === "controls") {
        billedFromControls += row.amount;
        continue;
      }

      let splitAmount = row.amount;
      let splitMethod: AccountMethod = method;
      let splitCompanyId: number | null = winner.companyId;
      let splitPercentages: PercentEntry[] | null = winner.percentages ?? null;

      if (method === "fixed") {
        const balanceMethod = (winner.balanceMethod ?? null) as AccountMethod | null;

        // Rule from the account: pool the whole account, recover the item once.
        if (!own && !prior) {
          const entry = accountFixed.get(row.accountCode) ?? {
            total: 0,
            itemId: winner.fixedLineItemId,
            balanceMethod,
            balanceCompanyId: winner.balanceCompanyId,
            balancePercentages: winner.percentages ? null : (winner.balancePercentages ?? null),
            contributors: [] as string[],
          };
          entry.total += row.amount;
          entry.contributors.push(`${row.supplierName} — ${formatRand(row.amount)}`);
          accountFixed.set(row.accountCode, entry);
          continue;
        }

        // Rule set against this specific supplier line: it covers that line
        // only, and the item can still only be credited once.
        const itemId = winner.fixedLineItemId;
        const alreadyCredited = itemId != null && creditedItems.has(itemId);
        if (itemId != null) {
          if (alreadyCredited) duplicateItemUse.add(itemId);
          creditedItems.add(itemId);
        }
        const recovered =
          itemId != null && !alreadyCredited ? (recoveredByItem.get(itemId) ?? 0) : 0;
        recoveredElsewhere += Math.min(recovered, row.amount);
        const balance = round2(row.amount - recovered);
        if (balance <= 0.005) continue;

        if (!balanceMethod || balanceMethod === "fixed") {
          unsplitBalance += balance;
          unsplitBalanceSuppliers.push(`${row.supplierName} (${formatRand(balance)})`);
          continue;
        }
        splitAmount = balance;
        splitMethod = balanceMethod;
        splitCompanyId = winner.balanceCompanyId;
        splitPercentages = winner.balancePercentages ?? null;
      }

      const shares = allocate(splitAmount, splitMethod, basis, {
        companyId: splitCompanyId,
        percentages: splitPercentages,
      });

      const entry =
        perAccount.get(row.accountCode) ??
        { company: {} as Record<number, number>, contributors: [] as string[], total: 0 };
      for (const [idStr, value] of Object.entries(shares)) {
        const id = Number(idStr);
        entry.company[id] = (entry.company[id] ?? 0) + value;
      }
      entry.total += splitAmount;
      entry.contributors.push(
        method === "fixed"
          ? `${row.supplierName} — balance ${formatRand(splitAmount)} of ${formatRand(row.amount)} (rest on the recurring invoice)`
          : `${row.supplierName} — ${formatRand(splitAmount)}`,
      );
      perAccount.set(row.accountCode, entry);
    }

    // Accounts whose rule is a fixed line item: recover the item once against
    // the account's whole cost, then split the remainder.
    for (const [code, pooled] of accountFixed) {
      const recovered = pooled.itemId != null ? (recoveredByItem.get(pooled.itemId) ?? 0) : 0;
      const credited = Math.min(recovered, pooled.total);
      recoveredElsewhere += credited;
      const balance = round2(pooled.total - credited);
      if (balance <= 0.005) continue;

      if (!pooled.balanceMethod || pooled.balanceMethod === "fixed") {
        unsplitBalance += balance;
        unsplitBalanceSuppliers.push(
          `${accountNameByCode.get(code) ?? code} (${formatRand(balance)})`,
        );
        continue;
      }

      const shares = allocate(balance, pooled.balanceMethod, basis, {
        companyId: pooled.balanceCompanyId,
        percentages: pooled.balancePercentages,
      });
      const entry =
        perAccount.get(code) ??
        { company: {} as Record<number, number>, contributors: [] as string[], total: 0 };
      for (const [idStr, value] of Object.entries(shares)) {
        const id = Number(idStr);
        entry.company[id] = (entry.company[id] ?? 0) + value;
      }
      entry.total += balance;
      const itemName = fixedItemRows.find((i) => i.id === pooled.itemId)?.name ?? "a fixed item";
      entry.contributors.push(
        `${formatRand(pooled.total)} on this account, less ${formatRand(credited)} recovered by ${itemName} on the recurring invoice`,
        ...pooled.contributors,
      );
      perAccount.set(code, entry);
    }

    // ---- Linked creditors: reconcile actual (Xero) vs recurring -----
    for (const [contactId, pool] of creditorPool) {
      const link = linkByContact.get(contactId)!;
      const itemName = fixedItemRows.find((i) => i.id === link.fixedLineItemId)?.name ?? "the recurring item";
      const recovered = round2(recoveredByItem.get(link.fixedLineItemId) ?? 0);
      const actual = round2(pool.total);
      const variance = round2(actual - recovered);
      recoveredElsewhere += Math.min(recovered, actual);

      if (recovered <= 0) {
        warnings.push({
          level: "warn",
          message: `${pool.name} is linked to "${itemName}", but that item bills nothing on the recurring invoice — check its allocations. Its R${actual.toFixed(2)} in Xero was NOT billed here.`,
          href: "/controls",
          linkLabel: "Open Controls",
        });
        continue;
      }
      if (Math.abs(variance) < 0.01) {
        warnings.push({
          level: "info",
          message: `${pool.name}: R${actual.toFixed(2)} in Xero matches "${itemName}" on the recurring invoice — reconciled, not billed again.`,
        });
        continue;
      }
      if (variance < 0) {
        warnings.push({
          level: "warn",
          message: `${pool.name}: R${recovered.toFixed(2)} billed on the recurring invoice for "${itemName}", but only R${actual.toFixed(2)} in Xero — R${Math.abs(variance).toFixed(2)} over-recovered. Review whether to credit it.`,
        });
        continue;
      }

      // Overage — split by the link's balance rule.
      const bm = (link.balanceMethod ?? null) as AccountMethod | null;
      if (!bm || bm === "fixed" || bm === "controls" || bm === "exclude") {
        warnings.push({
          level: "warn",
          message: `${pool.name}: R${actual.toFixed(2)} in Xero vs R${recovered.toFixed(2)} on the recurring invoice — R${variance.toFixed(2)} over, but the link has no split rule, so it is NOT billed. Set one.`,
          href: "/creditor-links",
          linkLabel: "Set the rule",
        });
        continue;
      }
      const shares = allocate(variance, bm, basis, {
        companyId: link.balanceCompanyId,
        percentages: link.balancePercentages ?? null,
      });
      for (const c of companyRows) {
        const amt = round2(shares[c.id] ?? 0);
        if (Math.abs(amt) < 0.005) continue;
        push(c.id, {
          key: `creditor-${contactId}-${c.id}`,
          description: `${pool.name} — over recurring — ${label}`,
          amount: amt,
          detail: [
            `Actual R${actual.toFixed(2)} vs R${recovered.toFixed(2)} billed on the recurring invoice; R${variance.toFixed(2)} over, split by ${METHOD_BY_KEY[bm].short}`,
            ...pool.contributors,
          ],
        });
      }
      warnings.push({
        level: "info",
        message: `${pool.name}: R${variance.toFixed(2)} over the recurring invoice is billed here (actual R${actual.toFixed(2)} vs R${recovered.toFixed(2)}).`,
      });
    }

    const sortedAccounts = [...perAccount.entries()].sort(
      (a, b) => b[1].total - a[1].total,
    );
    for (const [code, entry] of sortedAccounts) {
      const name = accountNameByCode.get(code) ?? code;
      for (const c of companyRows) {
        const amount = round2(entry.company[c.id] ?? 0);
        if (Math.abs(amount) < 0.005) continue;
        push(c.id, {
          key: `acct-${code}-${c.id}`,
          description: `${name} — ${label}`,
          amount,
          detail: [
            `Account ${code}; total for the month R${entry.total.toFixed(2)}`,
            ...entry.contributors,
          ],
        });
      }
    }

    // ---- Month-end warnings ----------------------------------------
    warnings.push({
      level: "info",
      message:
        "Ensure all supplier invoices have been properly split. Any invoice not split will default to the expense account into which it falls.",
      href: `/supplier-splits?period=${period}`,
      linkLabel: "Review supplier splits",
    });

    if (fallbackCount > 0) {
      warnings.push({
        level: "info",
        message: `${fallbackCount} supplier line${fallbackCount === 1 ? "" : "s"} had no split of ${fallbackCount === 1 ? "its" : "their"} own and fell back to the expense account's method.`,
        href: `/supplier-splits?period=${period}`,
        linkLabel: "Split them individually",
      });
    }

    if (unsplitCount > 0) {
      warnings.push({
        level: "warn",
        message: `${unsplitCount} supplier line${unsplitCount === 1 ? "" : "s"} worth R${unsplitValue.toFixed(2)} has no split and no account default, so it is NOT on any invoice.`,
        href: `/supplier-splits?period=${period}`,
        linkLabel: "Split them now",
      });
    }

    if (recoveredElsewhere > 0) {
      warnings.push({
        level: "info",
        message: `${formatRand(recoveredElsewhere)} is recovered by fixed line items and is billed on the recurring invoice instead, not here.`,
      });
    }

    // A fixed line item always goes out on the recurring invoice. If nothing
    // deducts it from the account its cost actually sits in, that account's
    // split bills it a second time.
    const referencedItems = new Set<number>([
      ...accountMappings.map((m) => m.fixedLineItemId).filter((id): id is number => id != null),
      ...thisMonth.map((s) => s.fixedLineItemId).filter((id): id is number => id != null),
      ...earlier.map((s) => s.fixedLineItemId).filter((id): id is number => id != null),
      ...creditorLinkRows.map((l) => l.fixedLineItemId),
    ]);
    const unreferenced = fixedItemRows.filter(
      (i) => i.active && !referencedItems.has(i.id) && (recoveredByItem.get(i.id) ?? 0) > 0,
    );
    if (unreferenced.length > 0) {
      warnings.push({
        level: "warn",
        message: `${unreferenced.map((i) => i.name).join(", ")} ${unreferenced.length === 1 ? "is" : "are"} billed on the recurring invoice, but no expense account is set to "Fixed line item" to deduct ${unreferenced.length === 1 ? "it" : "them"}. If that cost also sits in an account being split here, it will be charged twice.`,
        href: "/expense-accounts",
        linkLabel: "Check the account rules",
      });
    }

    if (duplicateItemUse.size > 0) {
      const names = [...duplicateItemUse]
        .map((id) => fixedItemRows.find((i) => i.id === id)?.name ?? `item ${id}`)
        .join(", ");
      warnings.push({
        level: "warn",
        message: `More than one supplier line is linked to the same fixed line item (${names}). The item only recovers its amount once, so the extra lines have been billed in full here — link each item to the single line it covers.`,
        href: `/supplier-splits?period=${period}`,
        linkLabel: "Fix the links",
      });
    }

    if (billedFromControls > 0) {
      warnings.push({
        level: "info",
        message: `${formatRand(billedFromControls)} is marked "Ignore — split in Controls" and is billed on the recurring invoice instead.`,
      });
    }

    if (unsplitBalance > 0) {
      warnings.push({
        level: "warn",
        message: `${formatRand(unsplitBalance)} is left over after fixed line items and has no balance split, so it is NOT on any invoice — ${unsplitBalanceSuppliers.join(", ")}.`,
        href: `/supplier-splits?period=${period}`,
        linkLabel: "Split the balance",
      });
    }

    // Rent is billed from Controls on the recurring run, so seeing it again
    // here means it would go out twice.
    if (rentAmount > 0) {
      const rentish = sortedAccounts.find(([code]) =>
        (accountNameByCode.get(code) ?? "").toLowerCase().includes("rent"),
      );
      if (rentish) {
        warnings.push({
          level: "warn",
          message: `Account ${rentish[0]} (${accountNameByCode.get(rentish[0])}) is being split here, but rent is also billed on the recurring invoice from Controls — that would charge it twice. Mark the account "Not recharged" if the recurring invoice already covers it.`,
          href: "/expense-accounts",
          linkLabel: "Open Expense Accounts",
        });
      }
    }
  }

  // ---- Assemble ----------------------------------------------------
  const previewCompanies: PreviewCompany[] = companyRows.map((c) => {
    const lines = linesByCompany.get(c.id) ?? [];
    return {
      companyId: c.id,
      name: c.name,
      xeroContactId: c.xeroContactId,
      xeroContactName: c.xeroContactName,
      lines,
      total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    };
  });

  const missingContact = previewCompanies.filter((c) => c.total > 0 && !c.xeroContactId);
  if (missingContact.length > 0) {
    warnings.push({
      level: "warn",
      message: `${missingContact.map((c) => c.name).join(", ")} ${missingContact.length === 1 ? "has" : "have"} no Xero contact linked, so no invoice can be created.`,
      href: "/companies",
      linkLabel: "Link Xero contacts",
    });
  }

  return {
    period,
    runType,
    companies: previewCompanies,
    warnings,
    grandTotal: round2(previewCompanies.reduce((s, c) => s + c.total, 0)),
  };
}
