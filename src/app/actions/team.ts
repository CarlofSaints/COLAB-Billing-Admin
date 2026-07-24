"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { staff, users, roles, companies, signupRequests } from "@/db/schema";
import { requirePermission, hashPassword } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  mailConfigured,
  sendMail,
  hubInviteEmail,
  signupNotifyEmail,
} from "@/lib/mailer";

export type InviteState = {
  error?: string;
  ok?: boolean;
  tempPassword?: string;
  emailed?: boolean;
  emailError?: string;
  emailTo?: string;
};

function tempPassword(): string {
  return "COLAB-" + randomBytes(4).toString("hex");
}

/**
 * Creates a team_member login for an existing staff row, links the two, and
 * emails a welcome with sign-in details + a link to their profile. Internal —
 * callers must have already checked no user exists for this email.
 */
async function createLoginForStaff(person: {
  id: number;
  name: string;
  email: string;
}): Promise<Omit<InviteState, "error">> {
  const email = person.email.trim().toLowerCase();

  const [teamRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "team_member"))
    .limit(1);
  if (!teamRole) {
    return { ok: false, emailError: "The Team Member role is missing — run the seed." };
  }

  const pw = tempPassword();
  const passwordHash = await hashPassword(pw);
  const [row] = await db
    .insert(users)
    .values({
      name: person.name,
      email,
      roleId: teamRole.id,
      passwordHash,
      mustChangePassword: true,
    })
    .returning();

  await db.update(staff).set({ userId: row.id, updatedAt: new Date() }).where(eq(staff.id, person.id));

  let emailed = false;
  let emailError: string | undefined;
  if (mailConfigured()) {
    const base = await appBaseUrl();
    const { subject, html, text } = hubInviteEmail({
      name: person.name,
      email,
      password: pw,
      loginUrl: `${base}/login`,
      profileUrl: `${base}/profile`,
    });
    const res = await sendMail({ to: email, subject, html, text });
    emailed = res.ok;
    if (!res.ok) emailError = res.error;
  } else {
    emailError = "Email isn't configured — share the temporary password manually.";
  }

  return { ok: true, tempPassword: pw, emailed, emailError, emailTo: email };
}

/* ------------------------------------------------------------------ */
/* Phase 3 — turn an existing team member into a hub user             */
/* ------------------------------------------------------------------ */

export async function inviteTeamMember(staffId: number): Promise<InviteState> {
  const actor = await requirePermission("team.invite");

  const [person] = await db
    .select({ id: staff.id, name: staff.name, email: staff.email, userId: staff.userId })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);
  if (!person) return { error: "That team member no longer exists." };
  if (!person.email) return { error: "Add an email address for this person first." };

  const email = person.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing || person.userId) {
    // Make sure the link is set even if the account was created another way.
    if (existing && !person.userId) {
      await db.update(staff).set({ userId: existing.id }).where(eq(staff.id, person.id));
    }
    return { error: "This person already has a hub account." };
  }

  const res = await createLoginForStaff({ id: person.id, name: person.name, email });
  if (!res.ok) return { error: res.emailError };

  await logEvent({
    action: "team.invite",
    summary: `Invited ${person.name} (${email}) to the hub`,
    actor,
    entityType: "user",
    metadata: { emailed: res.emailed },
  });

  revalidatePath("/staff");
  return res;
}

/* ------------------------------------------------------------------ */
/* Phase 4 — public self-signup, gated by super-admin approval        */
/* ------------------------------------------------------------------ */

export type SignupState = { error?: string; ok?: boolean };

const signupSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name"),
  email: z.string().trim().email("Enter a valid email"),
  companyId: z.coerce.number().int().positive("Choose your company"),
});

/**
 * PUBLIC — no auth. Records a pending join request and notifies super admins.
 * Deliberately returns the same success either way so it can't be used to
 * probe which emails already have accounts.
 */
export async function submitSignupRequest(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    companyId: formData.get("companyId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = parsed.data.email.toLowerCase();

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.id, parsed.data.companyId), eq(companies.active, true)))
    .limit(1);
  if (!company) return { error: "Please choose your company from the list." };

  // Already a user, or already a pending request? Quietly no-op — same success.
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const [pending] = await db
    .select({ id: signupRequests.id })
    .from(signupRequests)
    .where(and(sql`lower(${signupRequests.email}) = ${email}`, eq(signupRequests.status, "pending")))
    .limit(1);

  if (existingUser || pending) {
    await logEvent({
      action: "signup.duplicate",
      summary: `Repeat join request from ${email} ignored`,
      actorType: "api",
      actorLabel: email,
      entityType: "signup_request",
    });
    return { ok: true };
  }

  const [req] = await db
    .insert(signupRequests)
    .values({ name: parsed.data.name, email, companyId: company.id })
    .returning();

  await logEvent({
    action: "signup.request",
    summary: `New hub join request from ${parsed.data.name} (${email}) — ${company.name}`,
    actorType: "api",
    actorLabel: email,
    entityType: "signup_request",
    entityId: req.id,
  });

  // Notify super admins (the approvers).
  if (mailConfigured()) {
    const admins = await db
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(roles.key, "super_admin"), eq(users.active, true)));
    if (admins.length > 0) {
      const base = await appBaseUrl();
      const { subject, html, text } = signupNotifyEmail({
        applicantName: parsed.data.name,
        applicantEmail: email,
        companyName: company.name,
        reviewUrl: `${base}/signup-requests`,
      });
      await Promise.all(admins.map((a) => sendMail({ to: a.email, subject, html, text })));
    }
  }

  return { ok: true };
}

export async function approveSignup(id: number): Promise<InviteState> {
  const actor = await requirePermission("team.invite");

  const [req] = await db.select().from(signupRequests).where(eq(signupRequests.id, id)).limit(1);
  if (!req) return { error: "That request no longer exists." };
  if (req.status !== "pending") return { error: "That request has already been dealt with." };

  const email = req.email.trim().toLowerCase();

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    await db
      .update(signupRequests)
      .set({ status: "approved", decidedByName: actor.name, decidedAt: new Date() })
      .where(eq(signupRequests.id, id));
    return { error: "Someone with that email already has an account — marked as approved." };
  }

  // Reuse an existing staff row for this email, or create one.
  const [existingStaff] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(sql`lower(${staff.email}) = ${email}`)
    .limit(1);

  let person: { id: number; name: string; email: string };
  if (existingStaff) {
    person = { id: existingStaff.id, name: existingStaff.name, email };
  } else {
    const [created] = await db
      .insert(staff)
      .values({ name: req.name, email, companyId: req.companyId })
      .returning({ id: staff.id, name: staff.name });
    person = { id: created.id, name: created.name, email };
  }

  const res = await createLoginForStaff(person);
  if (!res.ok) return { error: res.emailError };

  await db
    .update(signupRequests)
    .set({ status: "approved", decidedByName: actor.name, decidedAt: new Date() })
    .where(eq(signupRequests.id, id));

  await logEvent({
    action: "signup.approve",
    summary: `Approved hub sign-up for ${req.name} (${email})`,
    actor,
    entityType: "signup_request",
    entityId: id,
    metadata: { emailed: res.emailed },
  });

  revalidatePath("/signup-requests");
  revalidatePath("/staff");
  return res;
}

export async function declineSignup(id: number): Promise<SignupState> {
  const actor = await requirePermission("team.invite");
  const [req] = await db.select().from(signupRequests).where(eq(signupRequests.id, id)).limit(1);
  if (!req) return { error: "That request no longer exists." };
  if (req.status !== "pending") return { error: "That request has already been dealt with." };

  await db
    .update(signupRequests)
    .set({ status: "declined", decidedByName: actor.name, decidedAt: new Date() })
    .where(eq(signupRequests.id, id));

  await logEvent({
    action: "signup.decline",
    summary: `Declined hub sign-up for ${req.name} (${req.email})`,
    actor,
    entityType: "signup_request",
    entityId: id,
  });

  revalidatePath("/signup-requests");
  return { ok: true };
}
