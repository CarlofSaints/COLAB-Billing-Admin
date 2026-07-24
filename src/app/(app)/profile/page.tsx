import { sql } from "drizzle-orm";
import { db } from "@/db";
import { staff, companies } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { UserRound } from "lucide-react";
import { ProfileForm } from "./profile-form";
import { PhotoUploader } from "./photo-uploader";

export const metadata = { title: "My Profile — COLAB" };

export default async function ProfilePage() {
  const user = await requirePermission("profile.edit");

  const [record] = await db
    .select({
      id: staff.id,
      name: staff.name,
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
    .limit(1);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="My Profile"
        description="Tell the rest of COLAB a bit about yourself. This shows up on the team hub."
      />

      {!record ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState
              icon={<UserRound className="h-8 w-8" />}
              title="No team-member record linked to your email"
              description={`We couldn't match ${user.email} to anyone on the team list. Ask an admin to add you first, then this page will let you fill in your profile.`}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{record.name}</CardTitle>
              <CardDescription>
                {[record.position, record.companyName].filter(Boolean).join(" · ") ||
                  "Your details"}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <PhotoUploader
              staffId={record.id}
              name={record.name}
              hasPhoto={!!record.photoUrl}
              favouriteColour={record.favouriteColour}
            />
            <ProfileForm
              bio={record.bio}
              dateOfBirth={record.dateOfBirth}
              favouriteColour={record.favouriteColour}
              hobbies={record.hobbies}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
