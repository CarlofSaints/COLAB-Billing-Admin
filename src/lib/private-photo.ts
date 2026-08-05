import "server-only";
import { randomBytes } from "node:crypto";
import { put } from "@vercel/blob";

/**
 * Storing a photo somebody attached to something, in the PRIVATE Blob store.
 *
 * Every caller here serves its images back through an authenticated route of
 * its own, never by handing out the Blob URL: the issue-report page can be
 * written to by anyone who scans a sticker, so a leaked pathname must not be a
 * readable URL, and a fuel receipt can have a card number on it.
 *
 * Kept deliberately strict:
 *   - images only, checked by declared type AND by magic bytes, since a
 *     Content-Type header is whatever the client says it is;
 *   - 6 MB, comfortably inside the server-action body limit alongside the rest
 *     of the form.
 *
 * One table of signatures, one size limit, one upload path — the checks are the
 * kind that rot quietly if a second copy is made and only one of them is fixed.
 */

const MAX_BYTES = 6 * 1024 * 1024;

const ALLOWED: Record<string, { ext: string; magic: number[][] }> = {
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/webp": { ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] }, // "RIFF"
  "image/gif": { ext: "gif", magic: [[0x47, 0x49, 0x46, 0x38]] },
  // HEIC comes off iPhones; the marker sits at offset 4 ("ftyp"), so it's
  // matched separately below rather than from byte 0.
  "image/heic": { ext: "heic", magic: [] },
  "image/heif": { ext: "heif", magic: [] },
};

export type PhotoResult =
  | { ok: true; pathname: string; contentType: string }
  | { ok: false; error: string }
  | { ok: true; pathname: null; contentType: null };

function looksLikeImage(bytes: Uint8Array, declared: string): boolean {
  const spec = ALLOWED[declared];
  if (!spec) return false;
  if (spec.magic.length === 0) {
    // HEIC/HEIF: "ftyp" box at offset 4.
    return (
      bytes.length > 8 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    );
  }
  return spec.magic.some((sig) => sig.every((b, i) => bytes[i] === b));
}

/**
 * Validates and stores the photo under `folder/`. A missing or empty file is not
 * an error — every caller's photo question is optional — and comes back with a
 * null pathname.
 */
export async function storePrivatePhoto(
  folder: string,
  file: FormDataEntryValue | null,
  /** What the thing is called, so the error reads like the form it came from. */
  noun = "photo",
): Promise<PhotoResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, pathname: null, contentType: null };
  }

  if (file.size > MAX_BYTES) {
    return { ok: false, error: `That ${noun} is too large — 6 MB maximum.` };
  }

  const declared = (file.type || "").toLowerCase();
  if (!ALLOWED[declared]) {
    return { ok: false, error: `Please attach a ${noun} (JPG, PNG, WEBP, GIF or HEIC).` };
  }

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!looksLikeImage(head, declared)) {
    return { ok: false, error: "That file doesn't look like an image." };
  }

  try {
    const blob = await put(
      `${folder}/${randomBytes(10).toString("hex")}.${ALLOWED[declared].ext}`,
      file,
      { access: "private", contentType: declared, addRandomSuffix: false },
    );
    return { ok: true, pathname: blob.pathname, contentType: declared };
  } catch {
    return {
      ok: false,
      error: `The ${noun} couldn't be uploaded. Try again, or save without it.`,
    };
  }
}
