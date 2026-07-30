import "server-only";
import { randomBytes } from "node:crypto";
import { put } from "@vercel/blob";

/**
 * Storing the optional photo attached to an issue report.
 *
 * Uploads go to the PRIVATE Blob store and are served only through
 * `/api/issue-photo/[id]`, which checks the viewer is signed in. That matters
 * more here than for profile photos: the public sticker page can write to this
 * store without anyone logging in, so a leaked pathname must not be a
 * readable URL.
 *
 * Kept deliberately strict, because that same public page means anyone with a
 * camera can put bytes in the store:
 *   - images only, checked by declared type AND by magic bytes, since a
 *     Content-Type header is whatever the client says it is;
 *   - 6 MB, comfortably inside the 10 MB server-action body limit alongside
 *     the rest of the form.
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
 * Validates and stores the photo. A missing/empty file is not an error — the
 * question is optional — and comes back with a null pathname.
 */
export async function storeIssuePhoto(file: FormDataEntryValue | null): Promise<PhotoResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: true, pathname: null, contentType: null };
  }

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "That photo is too large — 6 MB maximum." };
  }

  const declared = (file.type || "").toLowerCase();
  if (!ALLOWED[declared]) {
    return { ok: false, error: "Please attach a photo (JPG, PNG, WEBP, GIF or HEIC)." };
  }

  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!looksLikeImage(head, declared)) {
    return { ok: false, error: "That file doesn't look like an image." };
  }

  try {
    const blob = await put(
      `issues/${randomBytes(10).toString("hex")}.${ALLOWED[declared].ext}`,
      file,
      { access: "private", contentType: declared, addRandomSuffix: false },
    );
    return { ok: true, pathname: blob.pathname, contentType: declared };
  } catch {
    return { ok: false, error: "The photo couldn't be uploaded. Try again, or report without it." };
  }
}
