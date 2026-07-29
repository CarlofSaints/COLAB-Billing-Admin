/**
 * Adds the reception shift-swap table, and grants the new `reception.view`
 * permission to every existing role.
 *
 * The seed only fills a role's grid when it's empty, so an added permission
 * never reaches roles that already exist — it has to be granted once by hand.
 * Viewing the rota is for everyone: it's the office noticeboard.
 *
 *   npx tsx scripts/add-reception-swaps.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `do $$ begin
       create type "swap_status" as enum ('pending', 'approved', 'declined', 'withdrawn');
     exception when duplicate_object then null; end $$`,
  );
  console.log("OK swap_status enum");

  await sql.query(
    `create table if not exists "reception_swap_requests" (
       "id" serial primary key,
       "from_slot_id" integer not null references "reception_slots"("id") on delete cascade,
       "to_slot_id" integer not null references "reception_slots"("id") on delete cascade,
       "requester_staff_id" integer not null references "staff"("id") on delete cascade,
       "target_staff_id" integer not null references "staff"("id") on delete cascade,
       "message" text,
       "status" "swap_status" not null default 'pending',
       "decline_reason" text,
       "token" text not null,
       "responded_at" timestamptz,
       "created_at" timestamptz not null default now()
     )`,
  );
  await sql.query(
    `create unique index if not exists "reception_swap_token_unique"
       on "reception_swap_requests" ("token")`,
  );
  await sql.query(
    `create index if not exists "reception_swap_from_idx"
       on "reception_swap_requests" ("from_slot_id")`,
  );
  console.log("OK reception_swap_requests");

  // Every role gets reception.view. Super Admin is covered by a code bypass but
  // is included anyway so the roles grid reads honestly.
  const granted = (await sql.query(
    `insert into role_permissions (role_id, permission_id)
     select r.id, p.id from roles r cross join permissions p
      where p.key = 'reception.view'
     on conflict do nothing
     returning role_id`,
  )) as { role_id: number }[];
  console.log(`OK granted reception.view to ${granted.length} role(s)`);

  const rows = (await sql.query(
    `select r.key as role from role_permissions rp
       join roles r on r.id = rp.role_id
       join permissions p on p.id = rp.permission_id
      where p.key = 'reception.view' order by r.key`,
  )) as { role: string }[];
  console.log(`reception.view: ${rows.map((r) => r.role).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
