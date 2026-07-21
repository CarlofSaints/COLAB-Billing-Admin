import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password — COLAB" };

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  await requireUser();
  const { first } = await searchParams;

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Change password"
        description={
          first
            ? "Welcome! Please set a new password before you continue."
            : "Update the password you use to sign in."
        }
      />
      <Card>
        <CardContent>
          <PasswordForm firstTime={Boolean(first)} />
        </CardContent>
      </Card>
    </div>
  );
}
