import * as XLSX from "xlsx";
import { getCurrentUser, hasPermission } from "@/lib/auth";

/**
 * Downloads a blank staff-import template with the exact column headers the
 * importer expects, plus a couple of example rows.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "staff.view")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rows = [
    ["Sub Company", "Name", "Gender", "Email", "Cell Number", "Include in Billing"],
    ["OuterJoin", "Jane Doe", "Female", "jane@outerjoin.co.za", "082 123 4567", "Yes"],
    ["COLAB", "John Smith", "Male", "john@colab2.co.za", "083 987 6543", "No"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 },
    { wch: 22 },
    { wch: 12 },
    { wch: 28 },
    { wch: 16 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Staff");

  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="COLAB-staff-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
