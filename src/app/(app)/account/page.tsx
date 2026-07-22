import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password/password-form";

export const metadata = { title: "My Account — COLAB" };

export default async function AccountPage() {
  const user = await requireUser();
  const [record] = await db
    .select({ lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="My Account" description="Your sign-in details and password." />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your name and the email address you sign in with.</CardDescription>
          </div>
          <Badge tone={user.roleKey === "super_admin" ? "slate" : "brand"}>{user.roleName}</Badge>
        </CardHeader>
        <CardContent>
          <ProfileForm name={user.name} email={user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              At least 8 characters. You&apos;ll need your current one to change it.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PasswordForm firstTime={false} stayOnPage />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Access</CardTitle>
            <CardDescription>
              What your role allows. Only a Super Admin can change this.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted">Role</span>
            <span className="font-medium text-slate-800">{user.roleName}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">Last sign-in</span>
            <span className="font-medium text-slate-800">
              {record?.lastLoginAt ? formatDateTime(record.lastLoginAt) : "This is your first"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">Account created</span>
            <span className="font-medium text-slate-800">
              {record?.createdAt ? formatDateTime(record.createdAt) : "—"}
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <span className="text-muted">Permissions</span>
            <span className="max-w-md text-right font-medium text-slate-800">
              {user.roleKey === "super_admin"
                ? "Everything"
                : user.permissions.length > 0
                  ? `${user.permissions.length} granted`
                  : "None"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
