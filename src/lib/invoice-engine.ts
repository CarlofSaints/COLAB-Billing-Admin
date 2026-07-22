import "server-only";
import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  commonSpaces,
  commonSpaceSplits,
  companies,
  companyAllocations,
  expenseAccountMappings,
  fixedLineAllocations,
  fixedLineItems,
  staff,
  supplierSplits,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { computeEffectiveAreas, rentShare } from "./billing-calc";
import { RENT_AMOUNT_KEY, TOTAL_SQM_KEY } from "./controls";
import { fetchExpenseAccounts } from "./xero";
import { getMonthCosts } from "./month-costs";
import { periodLabel } from "./periods";
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

type Basis = {
  /** Effective floor area per company, and the building total. */
  area: Record<number, number>;
  totalSqm: number;
  headcount: Record<number, number>;
  totalHeadcount: number;
  companyIds: number[];
};

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

/** Everything the split maths needs, loaded once per preview. */
async function loadBasis(): Promise<{
  basis: Basis;
  companyRows: { id: number; name: string; xeroContactId: string | null; xeroContactName: string | null }[];
  totalSqm: number;
  rentAmount: number;
}> {
  const companyRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      xeroContactId: companies.xeroContactId,
      xeroContactName: companies.xeroContactName,
    })
    .from(companies)
    .where(and(eq(companies.type, "sub"), eq(companies.active, true)))
    .orderBy(asc(companies.name));

  const allocs = await db.select().from(companyAllocations);
  const settings = await db.select().from(appSettings);
  const setting = (key: string) => {
    const row = settings.find((s) => s.key === key);
    return row?.value ? Number(row.value) : 0;
  };
  const totalSqm = setting(TOTAL_SQM_KEY);
  const rentAmount = setting(RENT_AMOUNT_KEY);

  const spaceRows = await db.select().from(commonSpaces).where(eq(commonSpaces.active, true));
  const splitRows = await db.select().from(commonSpaceSplits);

  const { effective } = computeEffectiveAreas(
    companyRows,
    Object.fromEntries(
      companyRows.map((c) => [
        c.id,
        Number(allocs.find((a) => a.companyId === c.id)?.squareMetres ?? 0),
      ]),
    ),
    spaceRows.map((s) => ({
      sqm: Number(s.squareMetres),
      splitMethod: s.splitMethod as "occupancy" | "custom",
      splits: splitRows
        .filter((sp) => sp.commonSpaceId === s.id)
        .map((sp) => ({ companyId: sp.companyId, percent: Number(sp.percent) })),
    })),
    totalSqm,
  );

  // Only people flagged "Include in Billing" count towards the split.
  const counts = await db
    .select({ companyId: staff.companyId, count: sql<number>`count(*)::int` })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.includeInBilling, true)))
    .groupBy(staff.companyId);

  const headcount: Record<number, number> = {};
  for (const c of companyRows) {
    const override = allocs.find((a) => a.companyId === c.id)?.headcountOverride;
    headcount[c.id] = override ?? counts.find((x) => x.companyId === c.id)?.count ?? 0;
  }

  return {
    basis: {
      area: effective,
      totalSqm,
      headcount,
      totalHeadcount: Object.values(headcount).reduce((s, n) => s + n, 0),
      companyIds: companyRows.map((c) => c.id),
    },
    companyRows,
    totalSqm,
    rentAmount,
  };
}

/**
 * Builds the invoice preview for a month. Nothing is written and nothing is
 * sent — this is purely what the invoices *would* say.
 */
export async function buildPreview(period: string, runType: RunType): Promise<InvoicePreview> {
  const { basis, companyRows, totalSqm, rentAmount } = await loadBasis();
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

    for (const item of items) {
      const unit = Number(item.unitAmount);
      for (const alloc of allocations.filter((a) => a.fixedLineItemId === item.id)) {
        const qty = Number(alloc.quantity);
        const amount = round2(qty * unit);
        if (amount <= 0) continue;
        push(alloc.companyId, {
          key: `fixed-${item.id}-${alloc.companyId}`,
          description: `${item.name} — ${label}`,
          amount,
          detail: [`${qty} × R${unit.toFixed(2)}`],
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

    const [thisMonth, earlier, accountMappings] = await Promise.all([
      db.select().from(supplierSplits).where(eq(supplierSplits.period, period)),
      db
        .select()
        .from(supplierSplits)
        .where(lt(supplierSplits.period, period))
        .orderBy(asc(supplierSplits.period)),
      db.select().from(expenseAccountMappings),
    ]);

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
    const recoveredByItem = new Map<number, number>();
    for (const item of fixedItemRows) {
      const unit = Number(item.unitAmount);
      recoveredByItem.set(
        item.id,
        fixedAllocRows
          .filter((a) => a.fixedLineItemId === item.id)
          .reduce((s, a) => s + Number(a.quantity) * unit, 0),
      );
    }

    let unsplitCount = 0;
    let unsplitValue = 0;
    let fallbackCount = 0;
    let recoveredElsewhere = 0;
    let unsplitBalance = 0;
    let billedFromControls = 0;
    const unsplitBalanceSuppliers: string[] = [];

    for (const row of costs.rows) {
      const own = explicit.get(row.key);
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
        // The fixed line item recovers a set amount on the recurring invoice;
        // only what it leaves behind belongs on this invoice.
        const recovered = winner.fixedLineItemId
          ? (recoveredByItem.get(winner.fixedLineItemId) ?? 0)
          : 0;
        recoveredElsewhere += Math.min(recovered, row.amount);
        const balance = round2(row.amount - recovered);
        if (balance <= 0.005) continue;

        const balanceMethod = ("balanceMethod" in winner ? winner.balanceMethod : null) as
          | AccountMethod
          | null;
        if (!balanceMethod || balanceMethod === "fixed") {
          unsplitBalance += balance;
          unsplitBalanceSuppliers.push(`${row.supplierName} (${formatRand(balance)})`);
          continue;
        }
        splitAmount = balance;
        splitMethod = balanceMethod;
        splitCompanyId = "balanceCompanyId" in winner ? winner.balanceCompanyId : null;
        splitPercentages = ("balancePercentages" in winner ? winner.balancePercentages : null) ?? null;
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
