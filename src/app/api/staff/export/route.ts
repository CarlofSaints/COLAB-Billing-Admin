import { asc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { companies, staff, staffTags, tags, users } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { effectiveDateOfBirth } from "@/lib/staff-profile";

/**
 * The full team-member list as a spreadsheet.
 *
 * Every tag becomes its own column carrying 1 or 0, rather than one "Tags"
 * cell of comma-separated text — that way the sheet filters, sorts and
 * pivots on tags, and SUM gives a headcount per tag straight away.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "staff.view")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      companyName: companies.name,
      position: staff.position,
      email: staff.email,
      cellNumber: staff.cellNumber,
      gender: staff.gender,
      includeInBilling: staff.includeInBilling,
      active: staff.active,
      dateOfBirth: staff.dateOfBirth,
      dateOfBirthAdmin: staff.dateOfBirthAdmin,
      bio: staff.bio,
      favouriteColour: staff.favouriteColour,
      hobbies: staff.hobbies,
      photoUrl: staff.photoUrl,
      profileCompletedAt: staff.profileCompletedAt,
      userId: staff.userId,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .orderBy(asc(companies.name), asc(staff.name));

  // Which login each team member has, so the export says more than "yes".
  const userRows = await db
    .select({ id: users.id, email: users.email, active: users.active })
    .from(users);
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const tagRows = await db
    .select({ id: tags.id, name: tags.name, cost: tags.costPerPerson })
    .from(tags)
    .orderBy(asc(tags.name));

  const links = await db
    .select({ staffId: staffTags.staffId, tagId: staffTags.tagId })
    .from(staffTags);
  const tagsByStaff = new Map<number, Set<number>>();
  for (const l of links) {
    if (!tagsByStaff.has(l.staffId)) tagsByStaff.set(l.staffId, new Set());
    tagsByStaff.get(l.staffId)!.add(l.tagId);
  }

  const yesNo = (v: boolean) => (v ? "Yes" : "No");
  const isoDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  const header = [
    "ID",
    "Name",
    "Company",
    "Position",
    "Email",
    "Cell Number",
    "Gender",
    "Include in Billing",
    "Active",
    "Date of Birth",
    "Date of Birth Source",
    "Date of Birth (self)",
    "Date of Birth (admin)",
    "Bio",
    "Favourite Colour",
    "Hobbies",
    "Has Photo",
    "Profile Completed",
    "Has Hub Login",
    "Login Email",
    "Login Active",
    "Created",
    "Last Updated",
    // A column per tag, 1 or 0. Costed tags say what they're worth in the
    // header so the sheet is readable without cross-referencing the app.
    ...tagRows.map((t) => (t.cost === null ? t.name : `${t.name} (R${Number(t.cost)})`)),
  ];

  const body = rows.map((s) => {
    const mine = tagsByStaff.get(s.id) ?? new Set<number>();
    const login = s.userId != null ? userById.get(s.userId) : undefined;
    return [
      s.id,
      s.name,
      s.companyName,
      s.position ?? "",
      s.email ?? "",
      s.cellNumber ?? "",
      s.gender ?? "",
      yesNo(s.includeInBilling),
      yesNo(s.active),
      effectiveDateOfBirth(s) ?? "",
      s.dateOfBirth ? "Self" : s.dateOfBirthAdmin ? "Admin" : "",
      s.dateOfBirth ?? "",
      s.dateOfBirthAdmin ?? "",
      s.bio ?? "",
      s.favouriteColour ?? "",
      Array.isArray(s.hobbies) ? s.hobbies.join(", ") : "",
      yesNo(!!s.photoUrl),
      isoDate(s.profileCompletedAt),
      yesNo(s.userId != null),
      login?.email ?? "",
      login ? yesNo(login.active) : "",
      isoDate(s.createdAt),
      isoDate(s.updatedAt),
      ...tagRows.map((t) => (mine.has(t.id) ? 1 : 0)),
    ];
  });

  // A totals row under the tag columns — how many people carry each.
  const tagColStart = header.length - tagRows.length;
  const totals = [
    "",
    `${rows.length} team members`,
    ...Array(Math.max(0, tagColStart - 2)).fill(""),
    ...tagRows.map((_, i) => body.reduce((sum, r) => sum + Number(r[tagColStart + i] ?? 0), 0)),
  ];

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, [], totals]);
  ws["!cols"] = header.map((h, i) => ({
    wch: i < tagColStart ? Math.max(10, Math.min(30, h.length + 4)) : Math.max(8, h.length + 2),
  }));
  ws["!freeze"] = { xSplit: 2, ySplit: 1 };
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: body.length, c: header.length - 1 },
    }),
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Team Members");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="COLAB-team-members-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
