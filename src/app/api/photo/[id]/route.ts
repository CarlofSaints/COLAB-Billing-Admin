import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staff } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

/**
 * Serves a team member's profile photo from the PRIVATE Blob store. The image
 * is fetched server-side with the store token and streamed back, so the raw
 * blob URL is never exposed — only signed-in users can load a photo.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const staffId = Number(id);
  if (!Number.isInteger(staffId)) return new Response("Bad request", { status: 400 });

  const [row] = await db
    .select({ photoUrl: staff.photoUrl })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);
  if (!row?.photoUrl) return new Response("Not found", { status: 404 });

  const res = await get(row.photoUrl, { access: "private" });
  if (!res || res.statusCode !== 200) return new Response("Not found", { status: 404 });

  return new Response(res.stream, {
    headers: {
      "Content-Type": res.blob.contentType || "application/octet-stream",
      // Private: browser may cache briefly, shared caches must not.
      "Cache-Control": "private, max-age=300",
    },
  });
}
