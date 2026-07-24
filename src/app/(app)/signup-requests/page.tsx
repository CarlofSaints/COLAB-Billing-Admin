import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { signupRequests, companies } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { appBaseUrl } from "@/lib/mailer";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import { SignupRequestsClient } from "./signup-requests-client";

export const metadata = { title: "Sign-up Requests — COLAB" };

export default async function SignupRequestsPage() {
  await requirePermission("team.invite");
  const joinUrl = `${await appBaseUrl()}/join`;

  const rows = await db
    .select({
      id: signupRequests.id,
      name: signupRequests.name,
      email: signupRequests.email,
      status: signupRequests.status,
      companyName: companies.name,
      createdAt: signupRequests.createdAt,
      decidedByName: signupRequests.decidedByName,
      decidedAt: signupRequests.decidedAt,
    })
    .from(signupRequests)
    .leftJoin(companies, eq(signupRequests.companyId, companies.id))
    .orderBy(desc(signupRequests.createdAt))
    .limit(100);

  const pending = rows
    .filter((r) => r.status === "pending")
    .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  const decided = rows
    .filter((r) => r.status !== "pending")
    .map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    }));

  return (
    <div>
      <PageHeader
        title="Sign-up Requests"
        description="People who used the public join form. Approving creates their team-member profile and hub login."
      />
      <Card className="mb-4 flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <Link2 className="h-4 w-4 text-brand-700" />
        <span className="text-muted">Share this link with new joiners:</span>
        <a href={joinUrl} className="font-medium text-brand-700 hover:text-brand-800">
          {joinUrl}
        </a>
      </Card>
      <SignupRequestsClient pending={pending} decided={decided} />
    </div>
  );
}
