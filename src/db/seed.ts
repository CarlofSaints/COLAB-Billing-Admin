/**
 * Idempotent seed script.  Run with:  npm run db:seed
 *
 * Seeds: permissions, roles, the default permission grid, the COLAB parent
 * entity + the four sub-companies, and the initial Super Admin (Carl).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import {
  PERMISSIONS,
  ROLES,
  DEFAULT_ROLE_PERMISSIONS,
} from "../lib/permissions";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local first.");
  process.exit(1);
}

const db = drizzle(neon(url), { schema });

const SUPER_ADMIN_EMAIL = "carl@outerjoin.co.za";
const SUPER_ADMIN_NAME = "Carl Dos Santos";

const SUB_COMPANIES = [
  "OuterJoin",
  "Atomic Marketing",
  "Atomic Digital",
  "iRam",
];

async function main() {
  console.log("Seeding COLAB Billing & Admin…\n");

  /* 1. Permissions -------------------------------------------------- */
  for (const p of PERMISSIONS) {
    await db
      .insert(schema.permissions)
      .values({ key: p.key, label: p.label, category: p.category, sort: p.sort })
      .onConflictDoUpdate({
        target: schema.permissions.key,
        set: { label: p.label, category: p.category, sort: p.sort },
      });
  }
  console.log(`✓ ${PERMISSIONS.length} permissions`);

  /* 2. Roles -------------------------------------------------------- */
  for (const r of ROLES) {
    await db
      .insert(schema.roles)
      .values({
        key: r.key,
        name: r.name,
        description: r.description,
        rank: r.rank,
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: schema.roles.key,
        set: { name: r.name, description: r.description, rank: r.rank },
      });
  }
  console.log(`✓ ${ROLES.length} roles`);

  /* 3. Default permission grid (only for roles with none yet) ------- */
  const allPerms = await db.select().from(schema.permissions);
  const permIdByKey = new Map(allPerms.map((p) => [p.key, p.id]));
  const allRoles = await db.select().from(schema.roles);

  for (const role of allRoles) {
    const existing = await db
      .select({ roleId: schema.rolePermissions.roleId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id))
      .limit(1);
    if (existing.length > 0) continue; // don't clobber grid edits

    const keys = DEFAULT_ROLE_PERMISSIONS[role.key] ?? [];
    for (const key of keys) {
      const pid = permIdByKey.get(key);
      if (!pid) continue;
      await db
        .insert(schema.rolePermissions)
        .values({ roleId: role.id, permissionId: pid })
        .onConflictDoNothing();
    }
  }
  console.log("✓ default permission grid");

  /* 4. Companies ---------------------------------------------------- */
  async function ensureCompany(name: string, type: "colab" | "sub") {
    const found = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.name, name))
      .limit(1);
    if (found[0]) return found[0];
    const [row] = await db
      .insert(schema.companies)
      .values({ name, type })
      .returning();
    return row;
  }

  await ensureCompany("COLAB", "colab");
  for (const name of SUB_COMPANIES) {
    const c = await ensureCompany(name, "sub");
    // Ensure an allocation row exists for each sub-company.
    await db
      .insert(schema.companyAllocations)
      .values({ companyId: c.id })
      .onConflictDoNothing();
  }
  console.log(`✓ COLAB + ${SUB_COMPANIES.length} sub-companies`);

  /* 5. Super Admin -------------------------------------------------- */
  const superRole = allRoles.find((r) => r.key === "super_admin")!;
  const existingUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, SUPER_ADMIN_EMAIL))
    .limit(1);

  if (existingUser[0]) {
    console.log(`• Super Admin already exists (${SUPER_ADMIN_EMAIL}) — left unchanged`);
  } else {
    const tempPassword = process.env.SEED_SUPERADMIN_PASSWORD || "ChangeMe!2026";
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await db.insert(schema.users).values({
      email: SUPER_ADMIN_EMAIL,
      name: SUPER_ADMIN_NAME,
      passwordHash,
      roleId: superRole.id,
      mustChangePassword: true,
    });
    console.log(`✓ Super Admin created`);
    console.log(`\n  ──────────────────────────────────────────`);
    console.log(`   Login:    ${SUPER_ADMIN_EMAIL}`);
    console.log(`   Password: ${tempPassword}`);
    console.log(`   (You'll be asked to change it on first login.)`);
    console.log(`  ──────────────────────────────────────────\n`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
