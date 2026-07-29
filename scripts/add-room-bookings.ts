/**
 * Creates the meeting-room and booking tables. Additive only — new enums,
 * new tables, new indexes; nothing existing is touched.
 *
 *   npx tsx scripts/add-room-bookings.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const statements: [string, string][] = [
  [
    "booking_status enum",
    `do $$ begin
       create type "booking_status" as enum ('confirmed', 'cancelled');
     exception when duplicate_object then null; end $$`,
  ],
  [
    "steal_status enum",
    `do $$ begin
       create type "steal_status" as enum ('pending', 'approved', 'declined', 'withdrawn');
     exception when duplicate_object then null; end $$`,
  ],
  [
    "rooms",
    `create table if not exists "rooms" (
       "id" serial primary key,
       "name" text not null,
       "capacity" integer not null default 1,
       "color" text,
       "notes" text,
       "active" boolean not null default true,
       "created_at" timestamptz not null default now(),
       "updated_at" timestamptz not null default now()
     )`,
  ],
  [
    "rooms_name_unique",
    `create unique index if not exists "rooms_name_unique" on "rooms" (lower("name"))`,
  ],
  [
    "room_bookings",
    `create table if not exists "room_bookings" (
       "id" serial primary key,
       "room_id" integer not null references "rooms"("id") on delete cascade,
       "title" text not null,
       "date" date not null,
       "start_minute" integer not null,
       "end_minute" integer not null,
       "booked_by_user_id" integer references "users"("id") on delete set null,
       "booked_by_name" text not null,
       "booked_by_email" text not null,
       "client_name" text,
       "attendee_count" integer not null default 1,
       "series_id" text,
       "recurrence_label" text,
       "status" "booking_status" not null default 'confirmed',
       "cancel_reason" text,
       "reminder_sent_at" timestamptz,
       "created_at" timestamptz not null default now(),
       "updated_at" timestamptz not null default now()
     )`,
  ],
  [
    "room_bookings indexes",
    `create index if not exists "room_bookings_room_date_idx" on "room_bookings" ("room_id", "date");
     create index if not exists "room_bookings_date_idx" on "room_bookings" ("date");
     create index if not exists "room_bookings_series_idx" on "room_bookings" ("series_id")`,
  ],
  [
    "room_booking_attendees",
    `create table if not exists "room_booking_attendees" (
       "booking_id" integer not null references "room_bookings"("id") on delete cascade,
       "user_id" integer not null references "users"("id") on delete cascade,
       primary key ("booking_id", "user_id")
     )`,
  ],
  [
    "room_steal_requests",
    `create table if not exists "room_steal_requests" (
       "id" serial primary key,
       "booking_id" integer not null references "room_bookings"("id") on delete cascade,
       "requester_user_id" integer references "users"("id") on delete set null,
       "requester_name" text not null,
       "requester_email" text not null,
       "message" text not null,
       "title" text not null,
       "client_name" text,
       "attendee_count" integer not null default 1,
       "status" "steal_status" not null default 'pending',
       "decline_reason" text,
       "token" text not null,
       "responded_at" timestamptz,
       "created_at" timestamptz not null default now()
     )`,
  ],
  [
    "steal indexes",
    `create unique index if not exists "steal_token_unique" on "room_steal_requests" ("token");
     create index if not exists "steal_booking_idx" on "room_steal_requests" ("booking_id")`,
  ],
];

async function main() {
  for (const [label, statement] of statements) {
    // Some entries carry more than one statement; neon's http driver takes one
    // at a time, so split on the boundary we control.
    for (const part of statement.split(/;\s*\n\s*(?=create)/)) {
      await sql.query(part);
    }
    console.log(`✓ ${label}`);
  }

  const rows = (await sql.query(
    `select table_name from information_schema.tables
      where table_name in ('rooms','room_bookings','room_booking_attendees','room_steal_requests')
      order by table_name`,
  )) as { table_name: string }[];
  console.log(`\n✓ Tables present: ${rows.map((r) => r.table_name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
