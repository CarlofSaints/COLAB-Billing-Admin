import "server-only";
import { storePrivatePhoto, type PhotoResult } from "@/lib/private-photo";

/**
 * The optional photo attached to an issue report.
 *
 * The validation and the upload itself live in `private-photo.ts`, shared with
 * the fuel receipt on a vehicle return. This is the folder and the wording.
 * Served only through `/api/issue-photo/[id]`, which checks the viewer is
 * signed in — the public sticker page can write here without any login, so a
 * leaked pathname must not be a readable URL.
 */
export type { PhotoResult };

export async function storeIssuePhoto(file: FormDataEntryValue | null): Promise<PhotoResult> {
  return storePrivatePhoto("issues", file);
}
