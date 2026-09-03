/**
 * Once-off bills: a one-month charge that isn't a Static fixed line item and
 * isn't a Xero supplier line either — the office buys 40 chairs, splits them
 * by headcount, and it goes on THIS month's Variable invoice and no other.
 *
 * Two tables, deliberately mirroring `fixed_line_items` /
 * `fixed_line_allocations` field for field (same `fixed_split_mode` enum, same
 * "quantity or percentage" allocation row). That means the split maths in
 * `billing-calc.ts` is reused rather than reimplemented — a second copy of
 * "how do I divide this by headcount" would drift from the invoice run and
 * nobody would notice until a bill disagreed with its own preview.
 *
 * The one thing fixed items don't have is a `period` and a `status`: a fixed
 * item bills every month forever, a once-off bill names its month and only
 * reaches an invoice once somebody submits it.
 *
 * Idempotent: safe to run twice. Dry-run by default.
 *
 *   npx tsx scripts/add-once-off-bills.ts          # show what would change
 *   npx tsx scripts/add-once-off-bills.ts --apply  # do it
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);
const apply = process.argv.includes("--apply");

async function tableExists(name: string): Promise<boolean> {
  const rows = (await sql.query(`select to_regclass($1) as reg`, [`public.${name}`])) as {
    reg: string | null;
  }[];
  return rows[0]?.reg != null;
}

async function main() {
  console.log(apply ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  for (const t of ["once_off_bills", "once_off_bill_allocations"]) {
    console.log(`${t}: ${(await tableExists(t)) ? "already present" : "MISSING — will be created"}`);
  }

  if (!apply) {
    console.log("\nNothing written. Re-run with --apply.");
    return;
  }

  // `create type` has no `if not exists`, so a re-run would throw on the enum
  // and abort before the tables. The `fixed_split_mode` enum is NOT recreated —
  // once-off bills share it with fixed line items on purpose.
  await sql.query(`
    do $$ begin
      create type once_off_bill_status as enum ('draft', 'submitted');
    exception when duplicate_object then null;
    end $$;
  `);
  console.log("\n✓ once_off_bill_status enum present");

  await sql.query(`
    create table if not exists once_off_bills (
      id serial primary key,
      description text not null,
      -- The billing month this lands on, "YYYY-MM". A copy for next month is a
      -- new row with a new period, never an edit of this one.
      period text not null,
      split_mode fixed_split_mode not null default 'quantity',
      -- A price each in "quantity" mode; the whole cost in every other mode.
      unit_amount numeric(12,2) not null default 0,
      notes text,
      status once_off_bill_status not null default 'draft',
      created_by_user_id integer,
      created_by_name text,
      -- Snapshotted so "email whoever created it" still works if the user row
      -- is later deactivated. The live address wins when the user still exists.
      created_by_email text,
      submitted_at timestamptz,
      submitted_by_name text,
      -- Which bill this was copied from, so a monthly repeat is traceable.
      copied_from_id integer references once_off_bills(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await sql.query(
    `create index if not exists once_off_bill_period_idx on once_off_bills (period, status)`,
  );
  console.log("✓ once_off_bills");

  await sql.query(`
    create table if not exists once_off_bill_allocations (
      id serial primary key,
      once_off_bill_id integer not null references once_off_bills(id) on delete cascade,
      company_id integer not null references companies(id) on delete cascade,
      -- Units in "quantity" mode, a percentage in "percent" mode, and 0 for the
      -- derived modes (per m², per head, equal, direct) where the share is
      -- worked out at read time rather than stored.
      quantity numeric(12,2) not null default 1
    )
  `);
  await sql.query(
    `create unique index if not exists once_off_alloc_unique
       on once_off_bill_allocations (once_off_bill_id, company_id)`,
  );
  console.log("✓ once_off_bill_allocations");

  const counts = (await sql.query(`
    select
      (select count(*)::int from once_off_bills) as bills,
      (select count(*)::int from once_off_bill_allocations) as allocs
  `)) as { bills: number; allocs: number }[];
  console.log(`\n--- state --- ${counts[0].bills} bill(s), ${counts[0].allocs} allocation(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
