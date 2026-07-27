/**
 * Renders every email template to a single HTML page for eyeballing.
 *
 *   npx tsx scripts/preview-emails.ts [outfile]
 *
 * Purely a development aid — it sends nothing and touches no database.
 */
import { writeFileSync } from "node:fs";
import {
  credentialsEmail,
  hubInviteEmail,
  signupNotifyEmail,
  taskAssignedEmail,
  taskCreatedEmail,
  issueReportedEmail,
} from "../src/lib/email-templates";
import { emailShell, plainBodyHtml } from "../src/lib/email-layout";

const BASE = "https://hub.colab2.co.za";

const samples: { label: string; mail: { subject: string; html: string } }[] = [
  {
    label: "User created — credentials",
    mail: credentialsEmail({
      name: "Sky Roos",
      email: "sky@colab2.co.za",
      password: "Trq7-Vane-92xK",
      loginUrl: `${BASE}/login`,
      mustChangePassword: true,
      isReset: false,
    }),
  },
  {
    label: "Password reset",
    mail: credentialsEmail({
      name: "Sky Roos",
      email: "sky@colab2.co.za",
      password: "Nb4z-Miro-58pQ",
      loginUrl: `${BASE}/login`,
      mustChangePassword: true,
      isReset: true,
    }),
  },
  {
    label: "Hub invite",
    mail: hubInviteEmail({
      name: "Dudu Nkosi",
      email: "dudu@atomicmarketing.co.za",
      password: "Kp9w-Lark-31vD",
      loginUrl: `${BASE}/login`,
      profileUrl: `${BASE}/profile`,
    }),
  },
  {
    label: "Sign-up request",
    mail: signupNotifyEmail({
      applicantName: "Sarah Mbeki",
      applicantEmail: "sarah@atomicdigital.co.za",
      companyName: "Atomic Digital",
      reviewUrl: `${BASE}/signup-requests`,
    }),
  },
  {
    label: "Task assigned",
    mail: taskAssignedEmail({
      assigneeName: "Sky Roos",
      taskName: "Submit VAT return",
      description: "Two-monthly VAT submission for the COLAB entity.",
      dueDate: "31 July 2026",
      priorityLabel: "High",
      recurrenceLabel: "Monthly",
      assignedByName: "Carl Dos Santos",
      tasksUrl: `${BASE}/admin-tasks`,
    }),
  },
  {
    label: "Task reminder",
    mail: taskAssignedEmail({
      assigneeName: "Sky Roos",
      taskName: "Submit VAT return",
      dueDate: "31 July 2026",
      priorityLabel: "High",
      recurrenceLabel: "Monthly",
      assignedByName: "Carl Dos Santos",
      tasksUrl: `${BASE}/admin-tasks`,
      isReminder: true,
    }),
  },
  {
    label: "Task scheduled (creator copy)",
    mail: taskCreatedEmail({
      creatorName: "Carl Dos Santos",
      taskName: "Submit VAT return",
      assigneeName: "Sky Roos",
      dueDate: "31 July 2026",
      tasksUrl: `${BASE}/admin-tasks`,
    }),
  },
  {
    label: "Office issue reported",
    mail: issueReportedEmail({
      category: "Electrical",
      detail:
        "The plug points in the LAB room keep tripping when the kettle and microwave run together.\n\nHappened three times this week.",
      reporterName: "Dudu Nkosi",
      issuesUrl: `${BASE}/issues`,
    }),
  },
  {
    label: "Announcement / scheduled reminder",
    mail: {
      subject: "Month-end costs are due",
      html: emailShell({
        preheader: "Please get your July invoices in by Friday.",
        eyebrow: "Announcement",
        heading: "Month-end costs are due",
        content: plainBodyHtml(
          "Hi team,\n\nPlease make sure all July supplier invoices are captured by Friday so the recharge run can go out on time.\n\nYou can check what's already in at https://hub.colab2.co.za/invoices\n\nThanks!",
          { linkify: true },
        ),
      }),
    },
  },
];

const page = `<!doctype html><html><head><meta charset="utf-8">
<title>COLAB email templates</title>
<style>
  body{margin:0;background:#e2e8f0;font-family:-apple-system,'Segoe UI',sans-serif}
  h2{margin:0;padding:14px 20px;background:#111;color:#fff;font-size:13px;font-weight:600;letter-spacing:.4px}
  .subj{padding:10px 20px;background:#fff;border-bottom:1px solid #cbd5e1;font-size:13px;color:#475569}
  .subj b{color:#0f172a}
  section{margin:0 0 34px}
</style></head><body>
${samples
  .map(
    (s) => `<section>
  <h2>${s.label}</h2>
  <div class="subj">Subject: <b>${s.mail.subject.replace(/</g, "&lt;")}</b></div>
  ${s.mail.html}
</section>`,
  )
  .join("\n")}
</body></html>`;

const out = process.argv[2] ?? "email-preview.html";
writeFileSync(out, page, "utf8");
console.log(`Wrote ${samples.length} templates to ${out}`);
