import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { Building2, Users, Mails, SlidersHorizontal, ArrowRight } from "lucide-react";
import { db } from "@/db";
import { companies, staff, emailGroups, users } from "@/db/schema";
import { requireUser, hasPermission } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { SubCompanyCard } from "@/components/sub-company-card";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser();
  const { denied } = await searchParams;

  const [companyCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(companies)
    .where(eq(companies.type, "sub"));
  const [staffCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(staff)
    .where(eq(staff.active, true));
  const [groupCount] = await db.select({ n: sql<number>`count(*)::int` }).from(emailGroups);
  const [userCount] = await db.select({ n: sql<number>`count(*)::int` }).from(users);

  const subCompanies = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.type, "sub"))
    .orderBy(asc(companies.name));
  const staffCounts = await db
    .select({ companyId: staff.companyId, n: sql<number>`count(*)::int` })
    .from(staff)
    .where(eq(staff.active, true))
    .groupBy(staff.companyId);
  const staffByCompany = new Map(staffCounts.map((r) => [r.companyId, r.n]));
  const canSeeCompanies = hasPermission(user, "companies.view");

  const stats = [
    { label: "Sub-Companies", value: companyCount?.n ?? 0, icon: Building2, href: "/companies", perm: "companies.view" },
    { label: "Active Staff", value: staffCount?.n ?? 0, icon: Users, href: "/staff", perm: "staff.view" },
    { label: "Email Groups", value: groupCount?.n ?? 0, icon: Mails, href: "/email-groups", perm: "groups.view" },
    { label: "Users", value: userCount?.n ?? 0, icon: SlidersHorizontal, href: "/users", perm: "users.view" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted">
          COLAB Billing &amp; Admin control centre — {user.roleName}.
        </p>
      </div>

      {denied && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have permission to access that page ({denied}). Ask a Super Admin if you
          need it.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats
          .filter((s) => hasPermission(user, s.perm))
          .map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.label} href={s.href}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-slate-900">{s.value}</div>
                      <div className="text-sm text-muted">{s.label}</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
      </div>

      {subCompanies.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              The sub-companies
            </h2>
            {canSeeCompanies && (
              <Link
                href="/companies"
                className="text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                Manage
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {subCompanies.map((c) => (
              <SubCompanyCard
                key={c.id}
                name={c.name}
                href={canSeeCompanies ? "/companies" : undefined}
                staffCount={staffByCompany.get(c.id) ?? 0}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent>
            <h3 className="font-semibold text-slate-900">Month-end billing</h3>
            <p className="mt-1 text-sm text-muted">
              Configure how shared expenses split across the sub-companies — by floor space,
              headcount, or fixed line items.
            </p>
            {hasPermission(user, "controls.view") && (
              <Link
                href="/controls"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                Open controls <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h3 className="font-semibold text-slate-900">Coming next</h3>
            <p className="mt-1 text-sm text-muted">
              Xero &amp; Dext integration and automatic monthly invoice generation. The controls you
              set here feed straight into that.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
