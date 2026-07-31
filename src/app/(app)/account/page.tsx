import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, staff, users } from "@/db/schema";
import { requireUser, hasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password/password-form";
import { HubProfileForm } from "../profile/profile-form";
import { PhotoUploader } from "../profile/photo-uploader";

export const metadata = { title: "My Account — COLAB" };

/**
 * Everything about you, in the one place the avatar in the corner points at.
 *
 * The sign-in details live on `users` and the hub profile on `staff`, but that
 * split is ours, not the reader's — having it as two separate pages meant two
 * different answers to "where do I change my details".
 */
export default async function AccountPage() {
  const user = await requireUser();
  const [record] = await db
    .select({ lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // The team-member record is matched on email, the same UID the hub uses.
  const canEditProfile = hasPermission(user, "profile.edit");
  const [teamMember] = canEditProfile
    ? await db
        .select({
          id: staff.id,
          name: staff.name,
          cellNumber: staff.cellNumber,
          gender: staff.gender,
          position: staff.position,
          photoUrl: staff.photoUrl,
          bio: staff.bio,
          dateOfBirth: staff.dateOfBirth,
          favouriteColour: staff.favouriteColour,
          hobbies: staff.hobbies,
          companyName: companies.name,
        })
        .from(staff)
        .leftJoin(companies, sql`${staff.companyId} = ${companies.id}`)
        .where(sql`lower(${staff.email}) = ${user.email.toLowerCase()}`)
        .limit(1)
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="My Account"
        description="Your sign-in details, your password, and the profile the rest of COLAB sees."
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sign-in details</CardTitle>
            <CardDescription>Your name and the email address you sign in with.</CardDescription>
          </div>
          <Badge tone={user.roleKey === "super_admin" ? "slate" : "brand"}>{user.roleName}</Badge>
        </CardHeader>
        <CardContent>
          <ProfileForm name={user.name} email={user.email} />
        </CardContent>
      </Card>

      {canEditProfile && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Your team member profile</CardTitle>
              <CardDescription>
                {teamMember
                  ? "Your own entry on the team list — your details, your photo and what the rest of COLAB sees on the hub. Only you can edit this."
                  : "Shown on the team hub, once you're on the team list."}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {teamMember ? (
              <>
                <PhotoUploader
                  staffId={teamMember.id}
                  name={teamMember.name}
                  hasPhoto={!!teamMember.photoUrl}
                  favouriteColour={teamMember.favouriteColour}
                />
                <HubProfileForm
                  name={teamMember.name}
                  cellNumber={teamMember.cellNumber}
                  gender={teamMember.gender}
                  position={teamMember.position}
                  companyName={teamMember.companyName}
                  bio={teamMember.bio}
                  dateOfBirth={teamMember.dateOfBirth}
                  favouriteColour={teamMember.favouriteColour}
                  hobbies={teamMember.hobbies}
                />
              </>
            ) : (
              <p className="text-sm text-muted">
                We couldn&apos;t match {user.email} to anyone on the team list, so there&apos;s no
                profile to fill in yet. Ask an admin to add you and this section will open up.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              At least 12 characters. You&apos;ll need your current one to change it.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PasswordForm firstTime={false} stayOnPage name={user.name} email={user.email} />
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
