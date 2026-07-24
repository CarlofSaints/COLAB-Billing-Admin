"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type ProfileState = { error?: string; ok?: boolean };

const HEX = /^#[0-9a-fA-F]{6}$/;

const profileSchema = z.object({
  bio: z.string().trim().max(2000).optional(),
  // An empty date field posts "" — treat that as "cleared".
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
    .refine((v) => !v || v <= new Date().toISOString().slice(0, 10), "Date of birth can't be in the future"),
  favouriteColour: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || HEX.test(v), "Pick a colour"),
  // Comma-separated in the form; stored as a string[].
  hobbies: z.string().optional(),
});

/**
 * The signed-in user maintains their own team-member profile. The profile
 * lives on the `staff` row whose email matches the user's (email is the UID);
 * the first save also links the row to the user and stamps completion.
 */
export async function updateMyProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await requirePermission("profile.edit");

  const [record] = await db
    .select({ id: staff.id, profileCompletedAt: staff.profileCompletedAt })
    .from(staff)
    .where(sql`lower(${staff.email}) = ${user.email.toLowerCase()}`)
    .limit(1);

  if (!record) {
    return {
      error:
        "We couldn't find a team-member record linked to your email. Ask an admin to add you to the team list first.",
    };
  }

  const parsed = profileSchema.safeParse({
    bio: formData.get("bio") || undefined,
    dateOfBirth: formData.get("dateOfBirth") || undefined,
    favouriteColour: formData.get("favouriteColour") || undefined,
    hobbies: formData.get("hobbies") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const hobbies = (parsed.data.hobbies ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  await db
    .update(staff)
    .set({
      bio: parsed.data.bio || null,
      dateOfBirth: parsed.data.dateOfBirth || null,
      favouriteColour: parsed.data.favouriteColour || null,
      hobbies: hobbies.length ? hobbies : null,
      userId: user.id,
      profileCompletedAt: record.profileCompletedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(staff.id, record.id));

  // Keep the email↔user link clean: if any *other* staff row was previously
  // linked to this user (e.g. after an email change), unlink it.
  await db
    .update(staff)
    .set({ userId: null })
    .where(and(eq(staff.userId, user.id), ne(staff.id, record.id)));

  await logEvent({
    action: "profile.update",
    summary: `${user.name} updated their team profile`,
    actor: user,
    entityType: "staff",
    entityId: record.id,
  });

  revalidatePath("/profile");
  return { ok: true };
}
