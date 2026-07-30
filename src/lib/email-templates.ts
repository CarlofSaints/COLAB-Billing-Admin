/**
 * The email templates — pure functions returning { subject, html, text }.
 *
 * Deliberately free of `server-only` and any request-scoped API so they can be
 * rendered outside a Next request: `npx tsx scripts/preview-emails.ts` writes
 * every one of them to a single page for eyeballing before a change ships.
 * Sending lives in `mailer.ts`; this file only decides what a message says.
 */
import {
  button,
  codeValue,
  detailTable,
  emailShell,
  escapeHtml,
  link,
  note,
  p,
  quote,
} from "./email-layout";

/**
 * The credential handover email â€” sent when an admin creates a user (or resets
 * a password) and asks for the details to be emailed.
 */
export function credentialsEmail(input: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
  mustChangePassword: boolean;
  isReset: boolean;
}) {
  const { name, email, password, loginUrl, mustChangePassword, isReset } = input;
  const subject = isReset
    ? "Your COLAB password has been reset"
    : "Your COLAB sign-in details";

  const intro = isReset
    ? "Your password for the COLAB hub has been reset. Use the temporary password below to sign in."
    : "An account has been created for you on the COLAB hub. Use the details below to sign in.";

  const closing = mustChangePassword
    ? "You'll be asked to choose your own password the first time you sign in."
    : "You can change your password at any time from the Account page.";

  const html = emailShell({
    preheader: isReset
      ? "Your temporary password is inside."
      : "Your sign-in details for the COLAB hub.",
    eyebrow: isReset ? "Password reset" : "Account created",
    heading: `Hi ${name},`,
    content: [
      p(intro),
      detailTable([
        ["Sign in at", link(loginUrl)],
        ["Email", escapeHtml(email)],
        ["Temporary password", codeValue(password)],
      ]),
      button(loginUrl, "Sign in"),
      p(closing),
      note("If you weren't expecting this email, please let the COLAB office know."),
    ].join(""),
  });

  const text = [
    `Hi ${name},`,
    "",
    isReset
      ? "Your password for the COLAB Billing & Admin portal has been reset."
      : "An account has been created for you on the COLAB Billing & Admin portal.",
    "",
    `Sign in at: ${loginUrl}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    "",
    closing,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Welcome email when a team member is turned into a hub user â€” carries their
 * sign-in details and points them straight at their profile to fill in.
 */
export function hubInviteEmail(input: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
  profileUrl: string;
}) {
  const { name, email, password, loginUrl, profileUrl } = input;
  const subject = "You're on the COLAB Team Hub â€” set up your profile";

  const html = emailShell({
    preheader: "Your sign-in details, and a profile waiting to be filled in.",
    eyebrow: "Welcome",
    heading: `Hi ${name}, welcome to the Team Hub`,
    content: [
      p(
        "You've been added to the COLAB Team Hub. Sign in with the details below, then tell everyone a bit about yourself â€” what you do, your birthday, hobbies and more.",
      ),
      detailTable([
        ["Sign in at", link(loginUrl)],
        ["Email", escapeHtml(email)],
        ["Temporary password", codeValue(password)],
      ]),
      button(profileUrl, "Set up my profile"),
      p("You'll be asked to choose your own password the first time you sign in."),
      note("If you weren't expecting this email, please let the COLAB office know."),
    ].join(""),
  });

  const text = [
    `Hi ${name},`,
    "",
    "You've been added to the COLAB Team Hub. Sign in and set up your profile:",
    "",
    `Sign in at: ${loginUrl}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    "",
    `Set up your profile: ${profileUrl}`,
    "",
    "You'll be asked to choose your own password the first time you sign in.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Notifies a super admin that someone used the public join form, with a link
 * to review (approve / decline) the request in the app.
 */
export function signupNotifyEmail(input: {
  applicantName: string;
  applicantEmail: string;
  companyName: string;
  reviewUrl: string;
}) {
  const { applicantName, applicantEmail, companyName, reviewUrl } = input;
  const subject = `New hub sign-up: ${applicantName}`;

  const html = emailShell({
    preheader: `${applicantName} (${companyName}) is waiting for approval.`,
    eyebrow: "Sign-up request",
    heading: "Someone has asked to join the Team Hub",
    content: [
      p("Nothing has been created yet â€” it's waiting for your approval."),
      detailTable([
        ["Name", escapeHtml(applicantName)],
        ["Email", escapeHtml(applicantEmail)],
        ["Company", escapeHtml(companyName)],
      ]),
      button(reviewUrl, "Review request"),
    ].join(""),
  });

  const text = [
    "Someone has asked to join the COLAB Team Hub. It's waiting for your approval.",
    "",
    `Name: ${applicantName}`,
    `Email: ${applicantEmail}`,
    `Company: ${companyName}`,
    "",
    `Review it here: ${reviewUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Sent to the assignee when a task is created for them (or as a reminder). */
export function taskAssignedEmail(input: {
  assigneeName: string;
  taskName: string;
  description?: string | null;
  dueDate?: string | null;
  priorityLabel: string;
  recurrenceLabel: string;
  assignedByName: string;
  tasksUrl: string;
  isReminder?: boolean;
}) {
  const {
    assigneeName,
    taskName,
    description,
    dueDate,
    priorityLabel,
    recurrenceLabel,
    assignedByName,
    tasksUrl,
    isReminder,
  } = input;
  const subject = isReminder
    ? `Reminder: ${taskName}`
    : `New task for you: ${taskName}`;

  const lead = isReminder
    ? `A quick reminder about a task assigned to you${assignedByName ? ` by ${escapeHtml(assignedByName)}` : ""}:`
    : `${escapeHtml(assignedByName)} has assigned you a task on the COLAB hub:`;

  const rows: [string, string][] = [["Task", escapeHtml(taskName)]];
  if (description) rows.push(["Details", escapeHtml(description)]);
  if (dueDate) rows.push(["Due", escapeHtml(dueDate)]);
  rows.push(["Priority", escapeHtml(priorityLabel)]);
  rows.push(["Repeats", escapeHtml(recurrenceLabel)]);

  const html = emailShell({
    preheader: dueDate ? `${taskName} â€” due ${dueDate}.` : taskName,
    eyebrow: isReminder ? "Reminder" : "New task",
    heading: `Hi ${assigneeName},`,
    content: [p(lead), detailTable(rows), button(tasksUrl, "View my tasks")].join(""),
  });

  const text = [
    `Hi ${assigneeName},`,
    "",
    isReminder ? `Reminder â€” task: ${taskName}` : `${assignedByName} assigned you a task: ${taskName}`,
    description ? `Details: ${description}` : "",
    dueDate ? `Due: ${dueDate}` : "",
    `Priority: ${priorityLabel}`,
    `Repeats: ${recurrenceLabel}`,
    "",
    `View your tasks: ${tasksUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/** Sent to directors + admins when someone reports an office issue. */
export function issueReportedEmail(input: {
  category: string;
  detail: string;
  reporterName: string;
  issuesUrl: string;
}) {
  const { category, detail, reporterName, issuesUrl } = input;
  const subject = `Office issue reported: ${category}`;

  const html = emailShell({
    preheader: `${reporterName} reported a ${category} issue.`,
    eyebrow: "Issue reported",
    heading: `${category} â€” reported by ${reporterName}`,
    content: [quote(detail), button(issuesUrl, "View & manage issues")].join(""),
  });

  const text = [
    `${reporterName} reported a ${category} issue:`,
    "",
    detail,
    "",
    `View & manage: ${issuesUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Confirmation to the creator that their task was scheduled. */
export function taskCreatedEmail(input: {
  creatorName: string;
  taskName: string;
  assigneeName: string;
  dueDate?: string | null;
  tasksUrl: string;
}) {
  const { creatorName, taskName, assigneeName, dueDate, tasksUrl } = input;
  const subject = `Task scheduled: ${taskName}`;

  const rows: [string, string][] = [
    ["Task", escapeHtml(taskName)],
    ["Assigned to", escapeHtml(assigneeName)],
  ];
  if (dueDate) rows.push(["Due", escapeHtml(dueDate)]);

  const html = emailShell({
    preheader: `${assigneeName} has been notified about "${taskName}".`,
    eyebrow: "Task scheduled",
    heading: `Hi ${creatorName},`,
    content: [
      p(`Your task has been scheduled and ${escapeHtml(assigneeName)} has been notified.`),
      detailTable(rows),
      button(tasksUrl, "Open admin tasks"),
    ].join(""),
  });

  const text = [
    `Hi ${creatorName},`,
    "",
    `Your task "${taskName}" has been scheduled and ${assigneeName} has been notified.`,
    dueDate ? `Due: ${dueDate}` : "",
    "",
    `Open admin tasks: ${tasksUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/* Reception rota — "you're on the desk shortly"                       */
/* ------------------------------------------------------------------ */

/**
 * The nudge that goes out shortly before someone's turn on the front desk.
 *
 * `minutesUntil` is the real gap at send time rather than a fixed "in 10
 * minutes", because a cron tick can land a little late and telling someone the
 * wrong time is worse than telling them no time at all. A run of back-to-back
 * slots is one shift to the person standing there, so the range covers the
 * whole stretch and only one email goes out for it.
 */
export function receptionDutyReminderEmail(input: {
  name: string;
  dateLabel: string;
  timeLabel: string;
  minutesUntil: number;
  /** True when this covers several back-to-back slots merged into one shift. */
  merged: boolean;
  rotaUrl: string;
  /**
   * Set while the feature is being tested: the message is going to a test
   * address instead of the person on the rota, and says so in the clearest
   * terms available so a forwarded copy can't be mistaken for the real thing.
   */
  testFor?: { name: string; email: string | null } | null;
}) {
  const when =
    input.minutesUntil <= 0
      ? "now"
      : `in ${input.minutesUntil} minute${input.minutesUntil === 1 ? "" : "s"}`;

  const baseSubject =
    input.minutesUntil <= 0
      ? `You're on the front desk now — ${input.timeLabel}`
      : `You're on the front desk in ${input.minutesUntil} minutes — ${input.timeLabel}`;

  const subject = input.testFor ? `[TEST → ${input.testFor.name}] ${baseSubject}` : baseSubject;

  const testBanner = input.testFor
    ? quote(
        `TEST COPY — nobody on the rota received this.\n` +
          `In normal running it would have gone to ${input.testFor.name} ` +
          `<${input.testFor.email ?? "no email address on file"}>.\n` +
          `Unset RECEPTION_REMINDER_TEST_TO in Vercel to send for real.`,
      )
    : "";

  const html = emailShell({
    preheader: input.testFor
      ? `TEST COPY of the nudge for ${input.testFor.name} — ${input.timeLabel}.`
      : `Your reception shift starts ${when} (${input.timeLabel}).`,
    eyebrow: input.testFor ? "Reception rota (test)" : "Reception rota",
    heading: `Hi ${escapeHtml(input.name)},`,
    content: [
      testBanner,
      p(`Your turn on the front desk starts <strong>${escapeHtml(when)}</strong>.`),
      detailTable([
        ["When", escapeHtml(`${input.dateLabel}, ${input.timeLabel}`)],
        ["Where", "The front desk"],
      ]),
      p("Please head over and take over from whoever is there."),
      button(input.rotaUrl, "See the rota"),
      note(
        input.merged
          ? "This covers your whole stretch at the desk, so you won't get another reminder until your next shift. If you can't make it, ask someone to swap on the rota."
          : "If you can't make it, ask someone to swap on the rota.",
      ),
    ].join(""),
  });

  const text = [
    ...(input.testFor
      ? [
          "TEST COPY — nobody on the rota received this.",
          `In normal running it would have gone to ${input.testFor.name} <${
            input.testFor.email ?? "no email address on file"
          }>.`,
          "",
        ]
      : []),
    `Hi ${input.name},`,
    "",
    `Your turn on the front desk starts ${when}.`,
    "",
    `When: ${input.dateLabel}, ${input.timeLabel}`,
    "Where: the front desk",
    "",
    "Please head over and take over from whoever is there.",
    "",
    `Rota: ${input.rotaUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/* Reception rota — shift swaps                                        */
/* ------------------------------------------------------------------ */

/** "Can you take my Tuesday?" — to the person being asked. */
export function receptionSwapRequestEmail(input: {
  targetName: string;
  requesterName: string;
  theirSlot: string;
  yourSlot: string;
  message?: string | null;
  approveUrl: string;
  declineUrl: string;
}) {
  const subject = `${input.requesterName} wants to swap reception shifts`;

  const html = emailShell({
    preheader: `${input.requesterName} would like to swap their ${input.theirSlot} for your ${input.yourSlot}.`,
    eyebrow: "Reception swap",
    heading: `Hi ${input.targetName},`,
    content: [
      p(
        `${escapeHtml(input.requesterName)} would like to swap reception shifts with you. Nothing changes on the rota unless you agree.`,
      ),
      detailTable([
        ["They'd take", escapeHtml(input.yourSlot)],
        ["You'd take", escapeHtml(input.theirSlot)],
      ]),
      ...(input.message ? [p("They said:"), quote(input.message)] : []),
      button(input.approveUrl, "Agree to the swap"),
      p(link(input.declineUrl, "Or decline, and say why")),
    ].join(""),
  });

  const text = [
    `Hi ${input.targetName},`,
    "",
    `${input.requesterName} would like to swap reception shifts with you. Nothing changes unless you agree.`,
    "",
    `They'd take: ${input.yourSlot}`,
    `You'd take: ${input.theirSlot}`,
    ...(input.message ? ["", "They said:", input.message] : []),
    "",
    `Agree: ${input.approveUrl}`,
    `Decline: ${input.declineUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** The answer, back to whoever asked. */
export function receptionSwapOutcomeEmail(input: {
  requesterName: string;
  targetName: string;
  approved: boolean;
  /** After a swap, this is what the requester now has. */
  yourSlot: string;
  theirSlot: string;
  reason?: string | null;
  rotaUrl: string;
}) {
  const subject = input.approved
    ? `${input.targetName} agreed to swap reception shifts`
    : `${input.targetName} can't swap reception shifts`;

  const html = emailShell({
    preheader: input.approved
      ? `You're now on ${input.yourSlot}.`
      : `Your swap request was declined.`,
    eyebrow: input.approved ? "Swap agreed" : "Swap declined",
    heading: `Hi ${input.requesterName},`,
    content: input.approved
      ? [
          p(
            `${escapeHtml(input.targetName)} agreed to the swap and the rota has been updated.`,
          ),
          detailTable([
            ["You're now on", escapeHtml(input.yourSlot)],
            [`${escapeHtml(input.targetName)} takes`, escapeHtml(input.theirSlot)],
          ]),
          button(input.rotaUrl, "View the rota"),
        ].join("")
      : [
          p(
            `${escapeHtml(input.targetName)} can't swap, so the rota is unchanged and you're still on ${escapeHtml(input.theirSlot)}.`,
          ),
          ...(input.reason ? [p("They said:"), quote(input.reason)] : []),
          button(input.rotaUrl, "View the rota"),
        ].join(""),
  });

  const text = input.approved
    ? [
        `Hi ${input.requesterName},`,
        "",
        `${input.targetName} agreed to the swap and the rota has been updated.`,
        "",
        `You're now on: ${input.yourSlot}`,
        `${input.targetName} takes: ${input.theirSlot}`,
        "",
        `View the rota: ${input.rotaUrl}`,
      ].join("\n")
    : [
        `Hi ${input.requesterName},`,
        "",
        `${input.targetName} can't swap, so the rota is unchanged and you're still on ${input.theirSlot}.`,
        ...(input.reason ? ["", "They said:", input.reason] : []),
        "",
        `View the rota: ${input.rotaUrl}`,
      ].join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/* Meeting rooms                                                       */
/* ------------------------------------------------------------------ */

type BookingDetails = {
  roomName: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  attendeeCount: number;
  clientName?: string | null;
  attendees?: string[];
  recurrenceLabel?: string | null;
  occurrences?: number;
  /** Set when someone booked on another person's behalf. */
  bookedForName?: string | null;
  bookedByName?: string | null;
};

function bookingRows(b: BookingDetails): [string, string][] {
  const rows: [string, string][] = [
    ["Room", escapeHtml(b.roomName)],
    ["Meeting", escapeHtml(b.title)],
    ["When", escapeHtml(`${b.dateLabel}, ${b.timeLabel}`)],
    ["Attendees", escapeHtml(String(b.attendeeCount))],
  ];
  if (b.bookedForName) {
    rows.push(["Booked for", escapeHtml(b.bookedForName)]);
    if (b.bookedByName) rows.push(["Booked by", escapeHtml(b.bookedByName)]);
  }
  if (b.clientName) rows.push(["Client", escapeHtml(b.clientName)]);
  if (b.attendees && b.attendees.length > 0) {
    rows.push(["Internal attendees", escapeHtml(b.attendees.join(", "))]);
  }
  if (b.recurrenceLabel) {
    rows.push([
      "Repeats",
      escapeHtml(
        b.occurrences && b.occurrences > 1
          ? `${b.recurrenceLabel} (${b.occurrences} bookings)`
          : b.recurrenceLabel,
      ),
    ]);
  }
  return rows;
}

function bookingTextLines(b: BookingDetails): string[] {
  return [
    `Room: ${b.roomName}`,
    `Meeting: ${b.title}`,
    `When: ${b.dateLabel}, ${b.timeLabel}`,
    `Attendees: ${b.attendeeCount}`,
    b.bookedForName ? `Booked for: ${b.bookedForName}` : "",
    b.bookedForName && b.bookedByName ? `Booked by: ${b.bookedByName}` : "",
    b.clientName ? `Client: ${b.clientName}` : "",
    b.attendees && b.attendees.length ? `Internal attendees: ${b.attendees.join(", ")}` : "",
    b.recurrenceLabel ? `Repeats: ${b.recurrenceLabel}` : "",
  ].filter(Boolean);
}

/** Confirmation to whoever booked the room. */
export function bookingConfirmedEmail(
  input: BookingDetails & { bookerName: string; bookingsUrl: string },
) {
  const subject = `Room booked: ${input.roomName} — ${input.dateLabel}`;

  const html = emailShell({
    preheader: `${input.roomName} is yours on ${input.dateLabel} at ${input.timeLabel}.`,
    eyebrow: "Booking confirmed",
    heading: `Hi ${input.bookerName},`,
    content: [
      p("Your meeting room is booked. Here are the details:"),
      detailTable(bookingRows(input)),
      button(input.bookingsUrl, "View the room calendar"),
      note(
        "If someone else needs the room they can Steal This Room from the calendar — you'll get an email and nothing changes unless you approve it.",
      ),
    ].join(""),
  });

  const text = [
    `Hi ${input.bookerName},`,
    "",
    "Your meeting room is booked.",
    "",
    ...bookingTextLines(input),
    "",
    `Room calendar: ${input.bookingsUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** The day-before nudge. */
export function bookingReminderEmail(
  input: BookingDetails & { bookerName: string; bookingsUrl: string },
) {
  const subject = `Tomorrow: ${input.roomName} — ${input.title}`;

  const html = emailShell({
    preheader: `A reminder that you have ${input.roomName} tomorrow at ${input.timeLabel}.`,
    eyebrow: "Room booking tomorrow",
    heading: `Hi ${input.bookerName},`,
    content: [
      p("A reminder that you have a meeting room booked tomorrow."),
      detailTable(bookingRows(input)),
      button(input.bookingsUrl, "View the room calendar"),
      note("If you no longer need it, please cancel so someone else can use the room."),
    ].join(""),
  });

  const text = [
    `Hi ${input.bookerName},`,
    "",
    "A reminder that you have a meeting room booked tomorrow.",
    "",
    ...bookingTextLines(input),
    "",
    `Room calendar: ${input.bookingsUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * "Please can I have the room?" — to the current holder, with the two
 * outcomes. Both links land on the same page; declining asks for a reason
 * there rather than trying to collect one from an email.
 */
export function roomStealRequestEmail(input: {
  holderName: string;
  requesterName: string;
  requesterMeeting: string;
  message: string;
  roomName: string;
  dateLabel: string;
  timeLabel: string;
  yourMeeting: string;
  approveUrl: string;
  declineUrl: string;
}) {
  const subject = `${input.requesterName} wants to steal ${input.roomName} — ${input.dateLabel}`;

  const html = emailShell({
    preheader: `${input.requesterName} wants to steal your ${input.timeLabel} slot in ${input.roomName}.`,
    eyebrow: "Steal This Room",
    heading: `Hi ${input.holderName},`,
    content: [
      p(
        `${escapeHtml(input.requesterName)} wants to steal the room you have booked. Nothing changes unless you say yes.`,
      ),
      detailTable([
        ["Your booking", escapeHtml(input.yourMeeting)],
        ["Room", escapeHtml(input.roomName)],
        ["When", escapeHtml(`${input.dateLabel}, ${input.timeLabel}`)],
        ["They need it for", escapeHtml(input.requesterMeeting)],
      ]),
      p("Their reason:"),
      quote(input.message),
      button(input.approveUrl, "Let them steal it"),
      p(link(input.declineUrl, "Or decline, and say why")),
    ].join(""),
  });

  const text = [
    `Hi ${input.holderName},`,
    "",
    `${input.requesterName} wants to steal the room you have booked. Nothing changes unless you say yes.`,
    "",
    `Your booking: ${input.yourMeeting}`,
    `Room: ${input.roomName}`,
    `When: ${input.dateLabel}, ${input.timeLabel}`,
    `They need it for: ${input.requesterMeeting}`,
    "",
    "Their reason:",
    input.message,
    "",
    `Approve: ${input.approveUrl}`,
    `Decline: ${input.declineUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Outcome to the requester — approved, so the slot is now theirs. */
export function roomStealApprovedEmail(input: {
  requesterName: string;
  holderName: string;
  roomName: string;
  dateLabel: string;
  timeLabel: string;
  title: string;
  bookingsUrl: string;
}) {
  const subject = `You have ${input.roomName} — ${input.dateLabel}`;

  const html = emailShell({
    preheader: `${input.holderName} gave you the room.`,
    eyebrow: "Request approved",
    heading: `Hi ${input.requesterName},`,
    content: [
      p(
        `${escapeHtml(input.holderName)} has given you the room. It is booked in your name — nothing further to do.`,
      ),
      detailTable([
        ["Room", escapeHtml(input.roomName)],
        ["Meeting", escapeHtml(input.title)],
        ["When", escapeHtml(`${input.dateLabel}, ${input.timeLabel}`)],
      ]),
      button(input.bookingsUrl, "View the room calendar"),
      note("Worth thanking them — they gave up their slot."),
    ].join(""),
  });

  const text = [
    `Hi ${input.requesterName},`,
    "",
    `${input.holderName} has given you the room. It is booked in your name.`,
    "",
    `Room: ${input.roomName}`,
    `Meeting: ${input.title}`,
    `When: ${input.dateLabel}, ${input.timeLabel}`,
    "",
    `Room calendar: ${input.bookingsUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Outcome to the requester — declined, with the holder's reason. */
export function roomStealDeclinedEmail(input: {
  requesterName: string;
  holderName: string;
  roomName: string;
  dateLabel: string;
  timeLabel: string;
  reason: string;
  bookingsUrl: string;
}) {
  const subject = `${input.holderName} is keeping ${input.roomName} — ${input.dateLabel}`;

  const html = emailShell({
    preheader: `Your request for ${input.roomName} was declined.`,
    eyebrow: "Request declined",
    heading: `Hi ${input.requesterName},`,
    content: [
      p(
        `${escapeHtml(input.holderName)} is keeping the ${escapeHtml(input.roomName)} booking on ${escapeHtml(input.dateLabel)} at ${escapeHtml(input.timeLabel)}.`,
      ),
      p("Their reason:"),
      quote(input.reason),
      button(input.bookingsUrl, "Find another slot"),
    ].join(""),
  });

  const text = [
    `Hi ${input.requesterName},`,
    "",
    `${input.holderName} is keeping the ${input.roomName} booking on ${input.dateLabel} at ${input.timeLabel}.`,
    "",
    "Their reason:",
    input.reason,
    "",
    `Find another slot: ${input.bookingsUrl}`,
  ].join("\n");

  return { subject, html, text };
}
