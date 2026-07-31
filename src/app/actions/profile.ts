"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { put, del } from "@vercel/blob";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { normaliseGender } from "@/lib/staff-profile";

export type ProfileState = { error?: string; ok?: boolean };
export type PhotoState = { error?: string; ok?: boolean };

// Accepted image types → file extension.
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * What someone may change on their OWN team-member record.
 *
 * The line is drawn at "facts about me" versus "decisions about me". Your cell
 * number and job title are yours to correct; which sub-company you belong to,
 * which tags you carry, whether you're billed for and whether you're still
 * active are all decisions someone else makes — and two of them move money
 * (costed tags, include-in-billing), so they stay with `staff.manage`.
 *
 * Email is admin-only for a different reason: it is the key linking a login to
 * a team-member row. Letting someone edit it here would let them point their
 * profile at a different person's record, or orphan their own.
 */
const profileSchema = z.object({
  name: z.string().trim().min(1, "Your name can't be blank").max(120),
  cellNumber: z.string().trim().max(40).optional(),
  gender: z.string().trim().max(40).optional(),
  position: z.string().trim().max(120).optional(),
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
    name: formData.get("name") ?? "",
    cellNumber: formData.get("cellNumber") || undefined,
    gender: formData.get("gender") || undefined,
    position: formData.get("position") || undefined,
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

  // Only the fields above are written. `companyId`, tags, `includeInBilling`,
  // `active` and `email` are absent on purpose — not merely omitted from the
  // form, but unreachable from this action, so adding a hidden input to the
  // page can't reach them either.
  await db
    .update(staff)
    .set({
      name: parsed.data.name,
      cellNumber: parsed.data.cellNumber || null,
      gender: normaliseGender(parsed.data.gender),
      position: parsed.data.position || null,
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

  revalidatePath("/account");
  return { ok: true };
}

/**
 * Uploads a profile photo to a PRIVATE Blob store. We keep only the blob
 * pathname on the staff row; the image itself is served through the
 * authenticated /api/photo/[id] route, never a public URL.
 */
export async function uploadProfilePhoto(
  _prev: PhotoState,
  formData: FormData,
): Promise<PhotoState> {
  const user = await requirePermission("profile.edit");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { error: "Please use a JPG, PNG, WebP or GIF image." };
  if (file.size > MAX_PHOTO_BYTES) return { error: "Image must be 5 MB or smaller." };

  const [record] = await db
    .select({ id: staff.id, photoUrl: staff.photoUrl, profileCompletedAt: staff.profileCompletedAt })
    .from(staff)
    .where(sql`lower(${staff.email}) = ${user.email.toLowerCase()}`)
    .limit(1);
  if (!record) {
    return { error: "No team-member record is linked to your email — ask an admin to add you." };
  }

  let pathname: string;
  try {
    const blob = await put(`profiles/${record.id}-${randomBytes(6).toString("hex")}.${ext}`, file, {
      access: "private",
      contentType: file.type,
      addRandomSuffix: false,
    });
    pathname = blob.pathname;
  } catch {
    return { error: "Upload failed — please try again." };
  }

  // Remove the previous photo so the private store doesn't accumulate orphans.
  if (record.photoUrl) {
    try {
      await del(record.photoUrl);
    } catch {
      /* best effort */
    }
  }

  await db
    .update(staff)
    .set({
      photoUrl: pathname,
      profileCompletedAt: record.profileCompletedAt ?? new Date(),
      userId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(staff.id, record.id));

  await logEvent({
    action: "profile.photo",
    summary: `${user.name} updated their profile photo`,
    actor: user,
    entityType: "staff",
    entityId: record.id,
  });

  revalidatePath("/account");
  revalidatePath("/hub");
  return { ok: true };
}

export async function removeProfilePhoto(): Promise<PhotoState> {
  const user = await requirePermission("profile.edit");
  const [record] = await db
    .select({ id: staff.id, photoUrl: staff.photoUrl })
    .from(staff)
    .where(sql`lower(${staff.email}) = ${user.email.toLowerCase()}`)
    .limit(1);
  if (!record?.photoUrl) return { ok: true };

  try {
    await del(record.photoUrl);
  } catch {
    /* best effort */
  }
  await db.update(staff).set({ photoUrl: null, updatedAt: new Date() }).where(eq(staff.id, record.id));

  await logEvent({
    action: "profile.photo_remove",
    summary: `${user.name} removed their profile photo`,
    actor: user,
    entityType: "staff",
    entityId: record.id,
  });

  revalidatePath("/account");
  revalidatePath("/hub");
  return { ok: true };
}
