import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

function init(): DB {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.",
    );
  }
  return drizzle(neon(connectionString), { schema });
}

/**
 * Lazily-initialised Drizzle client. Connecting is deferred to the first query
 * so that `next build` (which imports modules but shouldn't need a live DB)
 * doesn't fail when DATABASE_URL is absent.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    if (!_db) _db = init();
    const value = Reflect.get(_db as object, prop, receiver);
    return typeof value === "function" ? value.bind(_db) : value;
  },
});
