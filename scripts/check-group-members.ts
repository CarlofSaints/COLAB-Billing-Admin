/**
 * Prints what every email group currently resolves to.
 *
 * Worth running after any change to group membership: the resolver replaced
 * six separate joins, so a regression here would show up as an announcement
 * quietly reaching the wrong people rather than as an error.
 *
 * For a static group this must match the rows in `email_group_members`
 * (minus anyone inactive). For a live rule it's whoever matches right now.
 *
 *   npx tsx scripts/check-group-members.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { matchesRule, parseRule, describeRule } from "../src/lib/group-rules";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  const groups = (await sql.query(
    `select id, name, rule from email_groups order by name`,
  )) as { id: number; name: string; rule: unknown }[];

  const people = (await sql.query(
    `select s.id, s.name, s.email, s.gender, s.position, s.company_id, c.name as company_name,
            s.include_in_billing, s.active
       from staff s join companies c on c.id = s.company_id`,
  )) as Record<string, never>[];

  const tagRows = (await sql.query(
    `select st.staff_id, t.id, t.name from staff_tags st join tags t on t.id = st.tag_id`,
  )) as { staff_id: number; id: number; name: string }[];

  const tagsByStaff = new Map<number, { id: number; name: string }[]>();
  for (const t of tagRows) {
    if (!tagsByStaff.has(t.staff_id)) tagsByStaff.set(t.staff_id, []);
    tagsByStaff.get(t.staff_id)!.push({ id: t.id, name: t.name });
  }

  const companies = new Map<number, string>();
  const tagNames = new Map<number, string>();
  for (const t of tagRows) tagNames.set(t.id, t.name);

  const rulePeople = people.map((p: Record<string, unknown>) => {
    companies.set(p.company_id as number, p.company_name as string);
    return {
      id: p.id as number,
      name: p.name as string,
      email: (p.email as string) ?? null,
      gender: (p.gender as string) ?? null,
      position: (p.position as string) ?? null,
      companyId: p.company_id as number,
      companyName: (p.company_name as string) ?? null,
      includeInBilling: p.include_in_billing as boolean,
      active: p.active as boolean,
      tags: tagsByStaff.get(p.id as number) ?? [],
    };
  });

  for (const g of groups) {
    const rule = parseRule(g.rule);
    console.log(`\n${g.name}`);

    if (rule) {
      console.log(
        `  LIVE RULE — ${describeRule(rule, {
          companyName: (id) => companies.get(id),
          tagName: (id) => tagNames.get(id),
        })}`,
      );
      const matched = rulePeople.filter((p) => matchesRule(p, rule));
      for (const m of matched) {
        console.log(`    ${m.name.padEnd(28)} ${m.email ?? "⚠ no email address"}`);
      }
      const reachable = matched.filter((m) => (m.email ?? "").includes("@")).length;
      console.log(`    → ${reachable} reachable of ${matched.length} matched`);
      continue;
    }

    const members = (await sql.query(
      `select s.name, s.email, s.active
         from email_group_members m join staff s on s.id = m.staff_id
        where m.group_id = $1 order by s.name`,
      [g.id],
    )) as { name: string; email: string | null; active: boolean }[];

    console.log(`  PICKED LIST — ${members.length} row(s)`);
    for (const m of members) {
      const flag = !m.active ? " (inactive — dropped at send time)" : "";
      console.log(`    ${m.name.padEnd(28)} ${m.email ?? "⚠ no email address"}${flag}`);
    }
    const reachable = members.filter(
      (m) => m.active && (m.email ?? "").includes("@"),
    ).length;
    console.log(`    → ${reachable} reachable`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
