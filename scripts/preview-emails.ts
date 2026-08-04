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
  bookingConfirmedEmail,
  bookingHandedOverEmail,
  bookingTakenOverEmail,
  receptionSwapRequestEmail,
  receptionSwapOutcomeEmail,
  receptionDutyReminderEmail,
  bookingReminderEmail,
  roomStealRequestEmail,
  roomStealApprovedEmail,
  roomStealDeclinedEmail,
  vehicleReturnOtpEmail,
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
    label: "Reception swap requested",
    mail: receptionSwapRequestEmail({
      targetName: "Dudu Nkosi",
      requesterName: "Sky Roos",
      theirSlot: "Tue 4 Aug, 08:00–08:30",
      yourSlot: "Thu 6 Aug, 12:00–12:30",
      message: "I have a dentist appointment on Tuesday morning — sorry for the short notice!",
      approveUrl: `${BASE}/reception/swap/abc123?action=approve`,
      declineUrl: `${BASE}/reception/swap/abc123?action=decline`,
    }),
  },
  {
    label: "Reception swap agreed",
    mail: receptionSwapOutcomeEmail({
      requesterName: "Sky Roos",
      targetName: "Dudu Nkosi",
      approved: true,
      yourSlot: "Thu 6 Aug, 12:00–12:30",
      theirSlot: "Tue 4 Aug, 08:00–08:30",
      rotaUrl: `${BASE}/reception`,
    }),
  },
  {
    label: "Reception swap declined",
    mail: receptionSwapOutcomeEmail({
      requesterName: "Sky Roos",
      targetName: "Dudu Nkosi",
      approved: false,
      yourSlot: "Thu 6 Aug, 12:00–12:30",
      theirSlot: "Tue 4 Aug, 08:00–08:30",
      reason: "I'm out of the office on Tuesday, otherwise I would have.",
      rotaUrl: `${BASE}/reception`,
    }),
  },
  {
    label: "Reception duty (10 minutes before)",
    mail: receptionDutyReminderEmail({
      name: "Meya",
      dateLabel: "Thu 6 Aug",
      timeLabel: "10:00 – 11:00",
      minutesUntil: 10,
      merged: true,
      rotaUrl: `${BASE}/reception`,
    }),
  },
  {
    label: "Reception duty (tick ran late — starting now)",
    mail: receptionDutyReminderEmail({
      name: "Sue Pillay",
      dateLabel: "Thu 6 Aug",
      timeLabel: "14:30 – 15:00",
      minutesUntil: 0,
      merged: false,
      rotaUrl: `${BASE}/reception`,
    }),
  },
  {
    label: "Room booked (confirmation)",
    mail: bookingConfirmedEmail({
      bookerName: "Carl Dos Santos",
      roomName: "The Boardroom",
      title: "Q3 planning",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      attendeeCount: 6,
      clientName: "Snomaster",
      attendees: ["Sky Roos", "Dudu Nkosi"],
      companies: ["Atomic Marketing", "OuterJoin"],
      recurrenceLabel: "Every week on Wed",
      occurrences: 8,
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Room reminder (day before, booked on behalf)",
    mail: bookingReminderEmail({
      bookerName: "Sky Roos",
      roomName: "The Lab",
      title: "Client pitch",
      dateLabel: "Thu 6 Aug 2026",
      timeLabel: "14:00 – 14:20 (20 min)",
      attendeeCount: 3,
      clientName: null,
      attendees: [],
      recurrenceLabel: null,
      bookedForName: "Sky Roos",
      bookedByName: "Dudu Nkosi",
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Room now booked for you (handover, to the new holder)",
    mail: bookingHandedOverEmail({
      holderName: "Sky Roos",
      previousHolderName: "Grant Marais",
      changedByName: "Carl Dos Santos",
      roomName: "The Boardroom",
      title: "Q3 planning",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      attendeeCount: 6,
      clientName: "Snomaster",
      attendees: ["Dudu Nkosi"],
      recurrenceLabel: null,
      bookedForName: "Sky Roos",
      bookedByName: "Dudu Nkosi",
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Room no longer booked for you (handover, to the previous holder)",
    mail: bookingTakenOverEmail({
      previousHolderName: "Grant Marais",
      newHolderName: "Sky Roos",
      changedByName: "Carl Dos Santos",
      roomName: "The Boardroom",
      title: "Q3 planning",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      attendeeCount: 6,
      clientName: "Snomaster",
      attendees: ["Dudu Nkosi"],
      recurrenceLabel: null,
      bookedForName: "Sky Roos",
      bookedByName: "Dudu Nkosi",
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Room no longer booked for you (handover, but they booked it themselves)",
    mail: bookingTakenOverEmail({
      previousHolderName: "Grant Marais",
      newHolderName: "Sky Roos",
      changedByName: "Carl Dos Santos",
      stillHolderAsBooker: true,
      roomName: "The Boardroom",
      title: "Q3 planning",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      attendeeCount: 6,
      clientName: null,
      attendees: [],
      recurrenceLabel: null,
      bookedForName: "Sky Roos",
      bookedByName: "Grant Marais",
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Someone wants your room",
    mail: roomStealRequestEmail({
      holderName: "Carl Dos Santos",
      requesterName: "Sky Roos",
      requesterMeeting: "Snomaster contract signing",
      message:
        "The client is flying in and this is the only slot they can do. I know it's short notice — I'll buy the coffees.",
      roomName: "The Boardroom",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      yourMeeting: "Q3 planning",
      approveUrl: `${BASE}/bookings/request/abc123?action=approve`,
      declineUrl: `${BASE}/bookings/request/abc123?action=decline`,
    }),
  },
  {
    label: "Room request approved",
    mail: roomStealApprovedEmail({
      requesterName: "Sky Roos",
      holderName: "Carl Dos Santos",
      roomName: "The Boardroom",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      title: "Snomaster contract signing",
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Room request declined",
    mail: roomStealDeclinedEmail({
      requesterName: "Sky Roos",
      holderName: "Carl Dos Santos",
      roomName: "The Boardroom",
      dateLabel: "Wed 5 Aug 2026",
      timeLabel: "09:00 – 10:00 (60 min)",
      reason: "Sorry — the auditors are already booked in and they've flown down for it.",
      bookingsUrl: `${BASE}/bookings`,
    }),
  },
  {
    label: "Vehicle sign-in code",
    mail: vehicleReturnOtpEmail({
      name: "Sky Roos",
      code: "418 302",
      vehicleName: "Toyota Corolla 1.6",
      vehicleReg: "CA 123-456",
      closingMileage: 84_312,
      closingFuelLabel: "Quarter",
      distanceLabel: "137 km",
      minutesValid: 10,
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
