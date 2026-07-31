/**
 * Fails if any page under src/app/(app) renders without an auth guard.
 *
 * This repo has no middleware/proxy.ts — every page guards itself. That works
 * right up until someone adds a page and forgets, and the failure is silent:
 * the page simply serves to everyone who is signed in. A team member reached
 * the billing dashboard exactly this way (the guard was there, but written so
 * it failed open), so the rule is now checked rather than remembered.
 *
 * Run with:  npm run check:guards
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "src", "app", "(app)");

/**
 * Pages that legitimately need only a signed-in user, with the reason. Anything
 * not listed here must call requirePermission(). Adding to this list is a
 * deliberate act; forgetting a guard is not.
 */
const USER_ONLY: Record<string, string> = {
  "page.tsx": "the billing dashboard — guards on companies.view and redirects, see the file",
  "account/page.tsx": "your own account",
  "account/password/page.tsx": "your own password",
  "profile/page.tsx": "a bare redirect to /account, renders nothing",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

const problems: string[] = [];

for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const src = readFileSync(file, "utf8");

  const hasPermissionGuard = /requirePermission\(\s*["']/.test(src);
  const hasUserGuard = /requireUser\(\s*\)/.test(src);
  const isRedirectOnly = /export default function \w+\(\)\s*\{\s*redirect\(/.test(src);

  if (hasPermissionGuard) continue;
  if (rel in USER_ONLY && (hasUserGuard || isRedirectOnly)) continue;

  problems.push(
    hasUserGuard
      ? `${rel} — only requireUser(); it needs requirePermission(), or an entry in USER_ONLY saying why not`
      : `${rel} — NO auth guard at all`,
  );
}

if (problems.length > 0) {
  console.error("Pages without a proper guard:\n");
  for (const p of problems) console.error("  ✗ " + p);
  console.error(
    "\nEvery page under (app) must call requirePermission(), or be listed in\n" +
      "USER_ONLY in scripts/check-page-guards.ts with the reason it is safe.\n",
  );
  process.exit(1);
}

console.log("✓ every page under (app) is guarded");
