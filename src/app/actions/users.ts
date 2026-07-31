"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, roles, staff } from "@/db/schema";
import { requirePermission, hashPassword } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { appBaseUrl, credentialsEmail, mailConfigured, sendMail } from "@/lib/mailer";

export type UserActionState = {
  error?: string;
  ok?: boolean;
  tempPassword?: string;
  /** Set when the credentials email was requested: did it actually go out? */
  emailed?: boolean;
  emailError?: string;
  emailTo?: string;
  /** What happened about the team list, when the tickbox was used. */
  teamNote?: string;
};

function tempPassword(): string {
  // Readable-ish temporary password.
  return "COLAB-" + randomBytes(4).toString("hex");
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  roleId: z.coerce.number().int().positive("Choose a role"),
});

export async function createUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = parsed.data.email.toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return { error: "A user with that email already exists." };

  // Both default on: the admin ticks them off deliberately.
  const sendCredentials = formData.get("sendCredentials") != null;
  const mustChangePassword = formData.get("mustChangePassword") != null;

  const pw = tempPassword();
  const passwordHash = await hashPassword(pw);
  const [row] = await db
    .insert(users)
    .values({
      name: parsed.data.name,
      email,
      roleId: parsed.data.roleId,
      passwordHash,
      mustChangePassword,
    })
    .returning();

  // A login and a place on the team list are separate things: a role decides
  // what someone may do, the team list is who works here. Without this, an
  // Admin or Director has hub access but no profile, never appears in the
  // birthday panel, and can't be tagged — so no reception rota, no costed tags.
  const addToTeam = formData.get("addToTeamList") != null;
  const teamCompanyId = Number(formData.get("teamCompanyId") || 0);
  let teamNote: string | null = null;

  if (addToTeam) {
    const [existingStaff] = await db
      .select({ id: staff.id, name: staff.name, userId: staff.userId })
      .from(staff)
      .where(sql`lower(${staff.email}) = ${email}`)
      .limit(1);

    if (existingStaff) {
      // Already on the list — link the login rather than create a duplicate.
      await db
        .update(staff)
        .set({ userId: row.id, updatedAt: new Date() })
        .where(eq(staff.id, existingStaff.id));
      teamNote = `Linked to the existing team member ${existingStaff.name}.`;
    } else if (teamCompanyId > 0) {
      await db.insert(staff).values({
        name: row.name,
        email: row.email,
        companyId: teamCompanyId,
        userId: row.id,
        // A login being created for someone doesn't say whether their company
        // should be billed for them — that's a deliberate billing decision, so
        // it starts off and an admin turns it on.
        includeInBilling: false,
      });
      teamNote = "Added to the team list. They're excluded from billing headcount until you say otherwise.";
    } else {
      teamNote = "Not added to the team list — no company was chosen.";
    }
  }

  await logEvent({
    action: "user.create",
    summary:
      `Created user ${row.name} (${row.email})` + (addToTeam && teamNote ? ` — ${teamNote}` : ""),
    actor,
    entityType: "user",
    entityId: row.id,
    metadata: { sendCredentials, mustChangePassword, addToTeam },
  });

  const mail = sendCredentials
    ? await mailCredentials({
        name: row.name,
        email: row.email,
        password: pw,
        mustChangePassword,
        isReset: false,
        actorId: row.id,
      })
    : null;

  revalidatePath("/users");
  revalidatePath("/staff");
  return {
    ok: true,
    tempPassword: pw,
    ...(teamNote ? { teamNote } : {}),
    ...(mail ?? {}),
  };
}

/**
 * Emails a user their sign-in details and records the outcome. Never throws —
 * a failed send must not undo the account it belongs to.
 */
async function mailCredentials(input: {
  name: string;
  email: string;
  password: string;
  mustChangePassword: boolean;
  isReset: boolean;
  actorId: number;
}): Promise<{ emailed: boolean; emailError?: string; emailTo: string }> {
  if (!mailConfigured()) {
    const error =
      "Email isn't configured yet — add the GRAPH_* variables (or RESEND_API_KEY and MAIL_FROM) in Vercel.";
    await logEvent({
      action: "user.credentials_email_blocked",
      summary: `Could not email sign-in details to ${input.email} — email not configured`,
      entityType: "user",
      entityId: input.actorId,
    });
    return { emailed: false, emailError: error, emailTo: input.email };
  }

  const loginUrl = `${await appBaseUrl()}/login`;
  const { subject, html, text } = credentialsEmail({ ...input, loginUrl });
  const res = await sendMail({ to: input.email, subject, html, text });

  await logEvent({
    action: res.ok ? "user.credentials_emailed" : "user.credentials_email_failed",
    // Naming the transport matters: a send that quietly failed over to Resend
    // looks identical to a healthy one from the recipient's end, right up until
    // you go hunting for why nothing arrived.
    summary: res.ok
      ? `Emailed sign-in details to ${input.email} (via ${res.provider})`
      : `Failed to email sign-in details to ${input.email}: ${res.error}`,
    entityType: "user",
    entityId: input.actorId,
  });

  return res.ok
    ? { emailed: true, emailTo: input.email }
    : { emailed: false, emailError: res.error, emailTo: input.email };
}

const editSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
});

/**
 * Edit a user's name and email.
 *
 * The catch worth knowing about: **the user↔team-member link is made by EMAIL**
 * in five places — My Account, the three profile actions and chat — not by the
 * `staff.userId` foreign key. So changing a login's address without moving the
 * team-member record with it would silently detach that person from their own
 * profile: My Account would offer to create a second one, their photo would
 * drop out of chat, and their birthday would go missing. The two are therefore
 * renamed together, in one go, or not at all.
 */
export async function updateUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { id, name } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const [before] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!before) return { error: "That user no longer exists." };

  const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (clash[0] && clash[0].id !== id) {
    return { error: "Another user already has that email address." };
  }

  const emailChanged = before.email.toLowerCase() !== email;

  // Find their team-member record the same two ways the rest of the app does:
  // the FK if it's set, otherwise the OLD address.
  const [linked] = await db
    .select({ id: staff.id, name: staff.name, email: staff.email })
    .from(staff)
    .where(
      sql`${staff.userId} = ${id} or lower(${staff.email}) = ${before.email.toLowerCase()}`,
    )
    .limit(1);

  // staff.email is uniquely indexed, so a collision here has to be reported
  // rather than thrown — someone else is already using the new address.
  if (linked && emailChanged) {
    const [taken] = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(sql`lower(${staff.email}) = ${email} and ${staff.id} <> ${linked.id}`)
      .limit(1);
    if (taken) {
      return {
        error: `The team member ${taken.name} already uses that email address. Sort that out on the Team Members page first.`,
      };
    }
  }

  await db.update(users).set({ name, email, updatedAt: new Date() }).where(eq(users.id, id));

  let teamNote: string | null = null;
  if (linked) {
    await db
      .update(staff)
      .set({
        email,
        // The team list is the record of the person, so their name follows the
        // login. Nothing else on their profile is touched.
        name,
        userId: id,
        updatedAt: new Date(),
      })
      .where(eq(staff.id, linked.id));
    if (emailChanged) {
      teamNote = `Their team-member record was moved to the new address too, so their profile, photo and birthday stay attached.`;
    }
  }

  await logEvent({
    action: "user.update",
    summary:
      `Updated user ${name}` +
      (emailChanged ? ` — email changed from ${before.email} to ${email}` : "") +
      (linked && emailChanged ? " (team-member record moved with it)" : ""),
    actor,
    entityType: "user",
    entityId: id,
    metadata: { emailChanged, linkedStaffId: linked?.id ?? null },
  });

  revalidatePath("/users");
  revalidatePath("/staff");
  revalidatePath("/meet-the-team");
  return { ok: true, ...(teamNote ? { teamNote } : {}) };
}

/**
 * Put an existing user on the team list.
 *
 * Until now this was only possible at the moment a login was created, so
 * somebody like Mark — a user, never a team member — could not be added to an
 * email group, tagged, put on the reception rota or shown on Meet Your Team,
 * and there was no screen anywhere that would fix it. Changing their ROLE to
 * "Team Member" doesn't do it either: a role says what someone may do, the
 * team list is who works here.
 */
export async function addUserToTeamList(
  userId: number,
  companyId: number,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { error: "That user no longer exists." };
  if (!Number.isInteger(companyId) || companyId <= 0) return { error: "Choose a company." };

  const email = user.email.toLowerCase();
  const [existing] = await db
    .select({ id: staff.id, name: staff.name, userId: staff.userId })
    .from(staff)
    .where(sql`${staff.userId} = ${userId} or lower(${staff.email}) = ${email}`)
    .limit(1);

  if (existing) {
    // Already on the list under this address — link the login rather than
    // create a duplicate person.
    await db
      .update(staff)
      .set({ userId, updatedAt: new Date() })
      .where(eq(staff.id, existing.id));
    await logEvent({
      action: "user.linked_to_team",
      summary: `Linked user ${user.name} to the existing team member ${existing.name}`,
      actor,
      entityType: "user",
      entityId: userId,
    });
    revalidatePath("/users");
    revalidatePath("/staff");
    return { ok: true, teamNote: `Linked to the existing team member ${existing.name}.` };
  }

  await db.insert(staff).values({
    name: user.name,
    email: user.email,
    companyId,
    userId,
    // Same call as at user creation: putting someone on the team list says
    // nothing about whether their company should be billed for them.
    includeInBilling: false,
  });

  await logEvent({
    action: "user.added_to_team",
    summary: `Added user ${user.name} to the team list`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { companyId },
  });

  revalidatePath("/users");
  revalidatePath("/staff");
  revalidatePath("/meet-the-team");
  revalidatePath("/email-groups");
  return {
    ok: true,
    teamNote:
      "Added to the team list, excluded from the billing headcount until you say otherwise.",
  };
}

export async function updateUserRole(userId: number, roleId: number) {
  const actor = await requirePermission("users.manage");
  await db.update(users).set({ roleId, updatedAt: new Date() }).where(eq(users.id, userId));
  await logEvent({
    action: "user.role_change",
    summary: `Changed a user's role`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { roleId },
  });
  revalidatePath("/users");
}

export async function setUserActive(userId: number, active: boolean) {
  const actor = await requirePermission("users.manage");
  // Never let someone deactivate themselves and lock the door behind them.
  if (actor.id === userId && !active) return;
  await db.update(users).set({ active, updatedAt: new Date() }).where(eq(users.id, userId));
  await logEvent({
    action: "user.set_active",
    summary: `${active ? "Activated" : "Deactivated"} a user`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { active },
  });
  revalidatePath("/users");
}

/**
 * Permanently removes a user. Their activity-log entries survive — the log
 * stores actorId without a foreign key precisely so history isn't rewritten.
 */
export async function deleteUser(userId: number): Promise<{ error?: string; ok?: boolean }> {
  const actor = await requirePermission("users.manage");
  if (actor.id === userId) return { error: "You can't delete your own account." };

  const [target] = await db
    .select({ id: users.id, name: users.name, email: users.email, roleKey: roles.key })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { error: "That user no longer exists." };

  // Never let the last super admin be deleted — that would lock everyone out
  // of users, roles and integrations for good.
  if (target.roleKey === "super_admin") {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(roles.key, "super_admin"), eq(users.active, true)));
    if (admins.length <= 1) {
      return { error: "This is the only Super Admin — create another one before deleting this." };
    }
  }

  await db.delete(users).where(eq(users.id, userId));

  await logEvent({
    action: "user.delete",
    summary: `Deleted user ${target.name} (${target.email})`,
    actor,
    entityType: "user",
    entityId: userId,
    metadata: { role: target.roleKey },
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function resetUserPassword(userId: number): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const pw = tempPassword();
  const passwordHash = await hashPassword(pw);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logEvent({
    action: "user.password_reset",
    summary: `Reset a user's password`,
    actor,
    entityType: "user",
    entityId: userId,
  });
  revalidatePath("/users");
  return { ok: true, tempPassword: pw };
}

export async function listRoles() {
  await requirePermission("users.view");
  return db.select().from(roles).orderBy(roles.rank);
}
