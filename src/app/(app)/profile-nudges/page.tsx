import { requirePermission } from "@/lib/auth";
import { mailStatus } from "@/lib/mailer";
import {
  NUDGE_COOLDOWN_DAYS,
  loadNudgeCandidates,
  nudgeAutoEnabled,
} from "@/lib/profile-nudges";
import { PageHeader } from "@/components/ui/page";
import { ProfileNudgesClient } from "./profile-nudges-client";

export const metadata = { title: "Profile Nudges — COLAB" };

export default async function ProfileNudgesPage() {
  await requirePermission("team.invite");

  const [candidates, autoOn, mail] = await Promise.all([
    loadNudgeCandidates(),
    nudgeAutoEnabled(),
    Promise.resolve(mailStatus()),
  ]);

  // Dates cross to the client as ISO strings; the component only ever renders
  // them, so there's nothing to gain from rehydrating them into Date objects.
  const serialise = (list: typeof candidates.neverSignedIn) =>
    list.map((t) => ({ ...t, lastNudgeAt: t.lastNudgeAt?.toISOString() ?? null }));

  return (
    <div>
      <PageHeader
        title="Profile Nudges"
        description="Who hasn't signed in yet, and whose profile is still half empty — and a reminder email for each."
      />
      <ProfileNudgesClient
        neverSignedIn={serialise(candidates.neverSignedIn)}
        incompleteProfile={serialise(candidates.incompleteProfile)}
        untagged={candidates.untagged}
        autoOn={autoOn}
        cooldownDays={NUDGE_COOLDOWN_DAYS}
        mailConfigured={mail.configured}
      />
    </div>
  );
}
