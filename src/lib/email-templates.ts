/**
 * The email templates — pure functions returning { subject, html, text }.
 *
 * Deliberately free of `server-only` and any request-scoped API so they can be
 * rendered outside a Next request: `npx tsx scripts/preview-emails.ts` writes
 * every one of them to a single page for eyeballing before a change ships.
 * Sending lives in `mailer.ts`; this file only decides what a message says.
 */
import {
  bulletList,
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
 * The credential handover email — sent when an admin creates a user (or resets
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
 * The "I forgot my password" link, sent from the public login screen.
 *
 * ⚠️ Deliberately carries NO password — unlike `credentialsEmail`, nothing here
 * is a live secret until the person clicks through and chooses one, so an email
 * sitting unread in an inbox isn't a working key to the account. It also names
 * the address the request was made for, because the one person who must be able
 * to act on an unrequested reset is whoever's account it is.
 */
export function passwordResetEmail(input: {
  name: string;
  email: string;
  resetUrl: string;
  minutesValid: number;
}) {
  const { name, email, resetUrl, minutesValid } = input;
  const subject = "Reset your COLAB password";

  const validity = `The link works once and expires in ${minutesValid} minutes.`;

  const html = emailShell({
    preheader: "Choose a new password for the COLAB hub.",
    eyebrow: "Password reset",
    heading: `Hi ${name},`,
    content: [
      p(
        `Someone asked to reset the COLAB hub password for ${escapeHtml(email)}. Click below to choose a new one.`,
      ),
      button(resetUrl, "Choose a new password"),
      p(validity),
      p(`If the button doesn't work, paste this into your browser:<br>${link(resetUrl)}`),
      note(
        "If this wasn't you, you can ignore this email — your password hasn't changed and nobody can " +
          "use this link without opening it. If you keep getting these, tell the COLAB office.",
      ),
    ].join(""),
  });

  const text = [
    `Hi ${name},`,
    "",
    `Someone asked to reset the COLAB hub password for ${email}.`,
    "",
    "Choose a new password here:",
    resetUrl,
    "",
    validity,
    "",
    "If this wasn't you, you can ignore this email — your password hasn't changed.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Welcome email when a team member is turned into a hub user — carries their
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
  const subject = "You're on the COLAB Team Hub — set up your profile";

  const html = emailShell({
    preheader: "Your sign-in details, and a profile waiting to be filled in.",
    eyebrow: "Welcome",
    heading: `Hi ${name}, welcome to the Team Hub`,
    content: [
      p(
        "You've been added to the COLAB Team Hub. Sign in with the details below, then tell everyone a bit about yourself — what you do, your birthday, hobbies and more.",
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
      p("Nothing has been created yet — it's waiting for your approval."),
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
    preheader: dueDate ? `${taskName} — due ${dueDate}.` : taskName,
    eyebrow: isReminder ? "Reminder" : "New task",
    heading: `Hi ${assigneeName},`,
    content: [p(lead), detailTable(rows), button(tasksUrl, "View my tasks")].join(""),
  });

  const text = [
    `Hi ${assigneeName},`,
    "",
    isReminder ? `Reminder — task: ${taskName}` : `${assignedByName} assigned you a task: ${taskName}`,
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
  /**
   * Came in from the public QR-code page, where nobody signed in. The name is
   * whatever the reporter chose, so the email has to say so — an admin acting
   * on "reported by Sue" must not assume it was Sue.
   */
  unverified?: boolean;
  /** Optional location picked from the managed Places list. */
  place?: string | null;
  hasPhoto?: boolean;
}) {
  const { category, detail, reporterName, issuesUrl, unverified, place, hasPhoto } = input;
  const subject = place
    ? `Office issue reported: ${category} — ${place}`
    : `Office issue reported: ${category}`;

  const html = emailShell({
    preheader: `${reporterName} reported a ${category} issue${place ? ` at ${place}` : ""}.`,
    eyebrow: unverified ? "Issue reported (via QR code)" : "Issue reported",
    heading: `${category} — reported by ${reporterName}`,
    content: [
      place ? detailTable([["Where", escapeHtml(place)]]) : "",
      quote(detail),
      // The photo itself is private and needs a login, so the email says one
      // exists rather than trying to show it.
      hasPhoto ? p("<strong>A photo was attached</strong> — open the issue to see it.") : "",
      unverified
        ? note(
            "Reported from the public sticker page, so nobody was signed in — treat the name as unconfirmed.",
          )
        : "",
      button(issuesUrl, "View & manage issues"),
    ].join(""),
  });

  const text = [
    `${reporterName} reported a ${category} issue:`,
    ...(place ? ["", `Where: ${place}`] : []),
    "",
    detail,
    "",
    ...(hasPhoto ? ["A photo was attached — open the issue to see it.", ""] : []),
    ...(unverified
      ? ["(Reported from the public sticker page — the name is unconfirmed.)", ""]
      : []),
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
  /** The sub-companies the meeting is for. */
  companies?: string[];
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
  if (b.companies && b.companies.length > 0) {
    rows.push(["Sub-companies", escapeHtml(b.companies.join(", "))]);
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
    b.companies && b.companies.length ? `Sub-companies: ${b.companies.join(", ")}` : "",
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
 * Someone edited a booking and changed who the room is for.
 *
 * Deliberately not the ordinary confirmation: the person receiving this didn't
 * ask for the room and may know nothing about the meeting, so the first line has
 * to say what changed and who it was for before, not just "here's your booking".
 */
export function bookingHandedOverEmail(
  input: BookingDetails & {
    /** The new holder — the person being written to. */
    holderName: string;
    /** Who it was for until now. */
    previousHolderName: string;
    /** Whoever made the change. */
    changedByName: string;
    bookingsUrl: string;
  },
) {
  const subject = `${input.roomName} is now booked for you — ${input.dateLabel}`;

  const html = emailShell({
    preheader:
      `This meeting was for ${input.previousHolderName} — ` +
      `${input.roomName} on ${input.dateLabel} is now yours.`,
    eyebrow: "Booking changed hands",
    heading: `Hi ${input.holderName},`,
    content: [
      p(
        `${escapeHtml(input.changedByName)} has changed who this meeting room is for. ` +
          `It was for <strong>${escapeHtml(input.previousHolderName)}</strong> — it's now for you.`,
      ),
      detailTable(bookingRows(input)),
      button(input.bookingsUrl, "View the room calendar"),
      note(
        "You'll get the reminder the day before, and any request for the room comes to you. " +
          "If this isn't right, speak to whoever made the change — or cancel it from the calendar.",
      ),
    ].join(""),
  });

  const text = [
    `Hi ${input.holderName},`,
    "",
    `${input.changedByName} has changed who this meeting room is for.`,
    `It was for ${input.previousHolderName} — it's now for you.`,
    "",
    ...bookingTextLines(input),
    "",
    `Room calendar: ${input.bookingsUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Where the person stands after losing the booking, which depends entirely on
 * whether they also booked it. The booker stays a holder no matter who the room
 * is for, so the two cases are the opposite of each other and can't share a
 * line of copy.
 */
function standingNote(newHolder: string, stillHolderAsBooker?: boolean): string {
  if (stillHolderAsBooker) {
    return (
      "You booked this room, so you're still on it — you'll get the reminder the day " +
      "before as usual, and any request for the room still comes to you as well as to " +
      `${newHolder}. It's simply no longer being held in your name.`
    );
  }
  return (
    "The booking itself still stands, as shown above — it's just no longer in your name. " +
    `You won't get the reminder for it, and requests for the room will go to ${newHolder} ` +
    "instead. If you still need the room, you can ask for it back from the calendar."
  );
}

/**
 * The other half of the handover — to the person the room is no longer for, so
 * a booking never disappears from under someone without a word.
 */
export function bookingTakenOverEmail(
  input: BookingDetails & {
    /** The person losing the booking — who this is written to. */
    previousHolderName: string;
    /** Who it's for now. */
    newHolderName: string;
    changedByName: string;
    /**
     * True when this person also MADE the booking, which keeps them a holder:
     * they still get the reminder and still field requests for the room. Telling
     * them otherwise would be plainly wrong, and they'd find out when the
     * reminder they were promised wouldn't come turns up anyway.
     */
    stillHolderAsBooker?: boolean;
    bookingsUrl: string;
  },
) {
  const subject = `${input.roomName} on ${input.dateLabel} is no longer booked for you`;

  const html = emailShell({
    preheader:
      `${input.roomName} on ${input.dateLabel} is now for ${input.newHolderName}.`,
    eyebrow: "Booking changed hands",
    heading: `Hi ${input.previousHolderName},`,
    content: [
      p(
        `${escapeHtml(input.changedByName)} has changed who this meeting room is for. ` +
          `It was for you — it's now for <strong>${escapeHtml(input.newHolderName)}</strong>.`,
      ),
      detailTable(bookingRows(input)),
      button(input.bookingsUrl, "View the room calendar"),
      note(standingNote(escapeHtml(input.newHolderName), input.stillHolderAsBooker)),
    ].join(""),
  });

  const text = [
    `Hi ${input.previousHolderName},`,
    "",
    `${input.changedByName} has changed who this meeting room is for.`,
    `It was for you — it's now for ${input.newHolderName}.`,
    "",
    ...bookingTextLines(input),
    "",
    standingNote(input.newHolderName, input.stillHolderAsBooker),
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


/* ------------------------------------------------------------------ */
/* Vehicle bookings                                                   */
/* ------------------------------------------------------------------ */

/**
 * Everything a vehicle email says about which trip it's about.
 *
 * Shared by all three, because the booking confirmation, the overdue nudge and
 * the return confirmation are read as a set — the same trip described three
 * different ways would make them hard to match up in an inbox.
 */
type VehicleTrip = {
  vehicleName: string;
  vehicleReg: string;
  vehicleNickname?: string | null;
  /** Who is actually taking it. The booker, unless it was booked for someone. */
  driverName: string;
  bookedByName: string;
  takenOnLabel: string;
  expectedReturnLabel: string;
  bookingsUrl: string;
  /**
   * Straight to THIS booking rather than the list. What an organiser needs from
   * the confirmation email is to open the one trip and act on it, and hunting
   * for it in a grid is where that intention goes to die.
   */
  bookingUrl?: string;
};

function tripTitle(trip: VehicleTrip): string {
  return `${trip.vehicleName}${trip.vehicleNickname ? ` “${trip.vehicleNickname}”` : ""} (${trip.vehicleReg})`;
}

/** The rows every vehicle email leads with, in the order they'd be said aloud. */
function tripRows(trip: VehicleTrip): [string, string][] {
  return [
    ["Vehicle", escapeHtml(tripTitle(trip))],
    ["Driver", escapeHtml(trip.driverName)],
    // Only worth a row when it's news: "booked by Jane, driven by Jane" is noise.
    ...(trip.bookedByName !== trip.driverName
      ? ([["Booked by", escapeHtml(trip.bookedByName)]] as [string, string][])
      : []),
    ["Taken on", escapeHtml(trip.takenOnLabel)],
    ["Due back", escapeHtml(trip.expectedReturnLabel)],
  ];
}

function tripLines(trip: VehicleTrip): string[] {
  return [
    `Vehicle: ${tripTitle(trip)}`,
    `Driver: ${trip.driverName}`,
    ...(trip.bookedByName !== trip.driverName ? [`Booked by: ${trip.bookedByName}`] : []),
    `Taken on: ${trip.takenOnLabel}`,
    `Due back: ${trip.expectedReturnLabel}`,
  ];
}

/**
 * "The vehicle is booked" — to whoever booked it and, when they're different
 * people, to whoever is actually driving it.
 *
 * Addressed by name and led by the driver, because the common case for the
 * second recipient is that somebody else arranged this on their behalf and this
 * email is the first they've heard of it.
 */
export function vehicleBookedEmail(
  input: VehicleTrip & {
    name: string;
    /**
     * Whose copy this is. "observer" is somebody copied in because of a
     * notification setting — they neither booked it nor are driving it, so
     * both of the other openings ("You've booked…", "X has booked it for you")
     * would be plainly wrong.
     */
    audience: "booker" | "driver" | "observer";
    forService: boolean;
    /** Why the vehicle is being taken, if they said. */
    purpose: string | null;
  },
) {
  const title = tripTitle(input);
  const subject = `${input.vehicleName} is booked — due back ${input.expectedReturnLabel}`;

  const opening =
    input.audience === "driver"
      ? `<strong>${escapeHtml(input.bookedByName)}</strong> has booked ${escapeHtml(title)} for you.`
      : input.audience === "observer"
        ? `<strong>${escapeHtml(input.bookedByName)}</strong> has booked ${escapeHtml(title)}${
            input.bookedByName !== input.driverName
              ? ` for <strong>${escapeHtml(input.driverName)}</strong>`
              : ""
          }.`
        : `You've booked ${escapeHtml(title)}${
            input.bookedByName !== input.driverName
              ? ` for <strong>${escapeHtml(input.driverName)}</strong>`
              : ""
          }.`;

  const html = emailShell({
    preheader: `Due back ${input.expectedReturnLabel}.`,
    eyebrow: "Vehicle booked",
    heading: `Hi ${input.name},`,
    content: [
      p(opening),
      detailTable(tripRows(input)),
      // Matters most on the driver's copy: somebody else arranged this, and
      // "what for?" is the first thing they'll want to know.
      ...(input.purpose ? [p("What it's for:"), quote(escapeHtml(input.purpose))] : []),
      ...(input.forService
        ? [note("This one is going in for a service, so it shows as being at the workshop.")]
        : []),
      ...(input.audience === "observer"
        ? [
            p(
              "You're copied on this because of the notification settings — there's nothing for you to do.",
            ),
          ]
        : [
            p(
              "Nothing else is needed now — the mileage, the fuel and anything you spent are all filled in when the vehicle comes back.",
            ),
          ]),
      button(input.bookingUrl ?? input.bookingsUrl, "Open this booking"),
      ...(input.audience === "observer"
        ? []
        : [
            note(
              "If you're going to be later than the time above, open the booking and extend it — otherwise you'll both get a reminder.",
            ),
          ]),
    ].join(""),
  });

  const text = [
    `Hi ${input.name},`,
    "",
    input.audience === "driver"
      ? `${input.bookedByName} has booked ${title} for you.`
      : input.audience === "observer"
        ? `${input.bookedByName} has booked ${title}${input.bookedByName !== input.driverName ? ` for ${input.driverName}` : ""}.`
        : `You've booked ${title}${input.bookedByName !== input.driverName ? ` for ${input.driverName}` : ""}.`,
    "",
    ...tripLines(input),
    ...(input.purpose ? ["", `What it's for: ${input.purpose}`] : []),
    ...(input.forService ? ["", "Going in for a service."] : []),
    "",
    input.audience === "observer"
      ? "You're copied on this because of the notification settings — there's nothing for you to do."
      : "Nothing else is needed now — the mileage, the fuel and anything you spent are filled in when the vehicle comes back.",
    "",
    input.bookingUrl ?? input.bookingsUrl,
    ...(input.audience === "observer"
      ? []
      : [
          "",
          "If you're going to be later than the time above, open the booking and extend it — otherwise you'll both get a reminder.",
        ]),
  ].join("\n");

  return { subject, html, text };
}

/**
 * "It was due back and it isn't" — sent once the expected return time passes,
 * then once a day while the vehicle is still out.
 *
 * Offers both answers, because being late is usually not the problem: the
 * problem is that the vehicle reads as unavailable to everyone else, and
 * extending the booking fixes that as well as returning it does.
 */
export function vehicleOverdueEmail(
  input: VehicleTrip & {
    name: string;
    /** "3 hours ago" — how late, in the words the reader would use. */
    overdueLabel: string;
    /**
     * Copied in by a notification setting rather than holding the vehicle. The
     * two ways out ("sign it in", "extend it") are things only the holder can
     * do, so telling an observer to do them would just be confusing.
     */
    forObserver?: boolean;
  },
) {
  const title = tripTitle(input);
  const subject = `${input.vehicleName} was due back ${input.overdueLabel}`;

  const html = emailShell({
    preheader: "Sign it back in, or extend the booking.",
    eyebrow: "Vehicle overdue",
    heading: `Hi ${input.name},`,
    content: [
      p(
        `${escapeHtml(title)} was due back <strong>${escapeHtml(input.expectedReturnLabel)}</strong>, which was ${escapeHtml(input.overdueLabel)}, and it hasn't been signed in yet.`,
      ),
      detailTable(tripRows(input)),
      input.forObserver
        ? p(
            `Until ${escapeHtml(input.driverName)} signs it back in or extends the booking, nobody else can book it. You're copied on this because of the notification settings.`,
          )
        : p(
            "Two ways to sort this out: sign the vehicle back in if it's back, or extend the booking if you still have it. Until one of those happens nobody else can book it.",
          ),
      button(input.bookingsUrl, input.forObserver ? "Open vehicle bookings" : "Sign it in or extend"),
      note("You'll get one of these a day until the vehicle is signed back in."),
    ].join(""),
  });

  const text = [
    `Hi ${input.name},`,
    "",
    `${title} was due back ${input.expectedReturnLabel}, which was ${input.overdueLabel}, and it hasn't been signed in yet.`,
    "",
    ...tripLines(input),
    "",
    input.forObserver
      ? `Until ${input.driverName} signs it back in or extends the booking, nobody else can book it.`
      : "Sign the vehicle back in if it's back, or extend the booking if you still have it.\nUntil one of those happens nobody else can book it.",
    "",
    input.bookingsUrl,
    "",
    "You'll get one of these a day until the vehicle is signed back in.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * "It's back" — the receipt for a completed trip, to the same two people.
 *
 * Quotes what was recorded rather than just confirming, so a wrong reading gets
 * spotted by the person who took it while they still remember the number.
 */
export function vehicleReturnedEmail(
  input: VehicleTrip & {
    name: string;
    returnedLabel: string;
    /** Pre-formatted so this file never has to know about km or rands. */
    openingMileageLabel: string | null;
    closingMileageLabel: string | null;
    distanceLabel: string | null;
    openingFuelLabel: string;
    closingFuelLabel: string;
    notes: string | null;
    refuel: { paidByLabel: string; amountLabel: string; hasReceipt: boolean } | null;
    signedInByName: string;
  },
) {
  const title = tripTitle(input);
  const subject = `${input.vehicleName} is back`;

  const rows: [string, string][] = [
    ["Vehicle", escapeHtml(title)],
    ["Driver", escapeHtml(input.driverName)],
    ["Taken on", escapeHtml(input.takenOnLabel)],
    ["Returned", escapeHtml(input.returnedLabel)],
    // The readings are left out entirely on a vehicle that doesn't track
    // mileage, rather than shown as dashes.
    ...(input.openingMileageLabel
      ? ([["Opening mileage", escapeHtml(input.openingMileageLabel)]] as [string, string][])
      : []),
    ...(input.closingMileageLabel
      ? ([["Closing mileage", escapeHtml(input.closingMileageLabel)]] as [string, string][])
      : []),
    ...(input.distanceLabel
      ? ([["Distance travelled", escapeHtml(input.distanceLabel)]] as [string, string][])
      : []),
    ["Fuel out / back", escapeHtml(`${input.openingFuelLabel} → ${input.closingFuelLabel}`)],
    ...(input.refuel
      ? ([
          ["Fuel bought", escapeHtml(`${input.refuel.amountLabel}, ${input.refuel.paidByLabel}`)],
        ] as [string, string][])
      : []),
  ];

  const html = emailShell({
    preheader: `Signed back in ${input.returnedLabel}.`,
    eyebrow: "Vehicle returned",
    heading: `Hi ${input.name},`,
    content: [
      p(
        `${escapeHtml(title)} has been signed back in${
          input.signedInByName !== input.driverName
            ? ` by <strong>${escapeHtml(input.signedInByName)}</strong>`
            : ""
        }. Here's what was recorded:`,
      ),
      detailTable(rows),
      ...(input.notes ? [p("Notes left on the trip:"), quote(escapeHtml(input.notes))] : []),
      ...(input.refuel
        ? [
            note(
              input.refuel.hasReceipt
                ? "A photo of the fuel receipt is on the booking."
                : "No photo of the fuel receipt was attached.",
            ),
          ]
        : []),
      button(input.bookingsUrl, "Open vehicle bookings"),
      note("If any of these figures look wrong, tell whoever looks after the fleet."),
    ].join(""),
  });

  const text = [
    `Hi ${input.name},`,
    "",
    `${title} has been signed back in${input.signedInByName !== input.driverName ? ` by ${input.signedInByName}` : ""}.`,
    "",
    `Vehicle: ${title}`,
    `Driver: ${input.driverName}`,
    `Taken on: ${input.takenOnLabel}`,
    `Returned: ${input.returnedLabel}`,
    ...(input.openingMileageLabel ? [`Opening mileage: ${input.openingMileageLabel}`] : []),
    ...(input.closingMileageLabel ? [`Closing mileage: ${input.closingMileageLabel}`] : []),
    ...(input.distanceLabel ? [`Distance travelled: ${input.distanceLabel}`] : []),
    `Fuel out / back: ${input.openingFuelLabel} -> ${input.closingFuelLabel}`,
    ...(input.refuel
      ? [`Fuel bought: ${input.refuel.amountLabel}, ${input.refuel.paidByLabel}`]
      : []),
    ...(input.notes ? ["", `Notes: ${input.notes}`] : []),
    ...(input.refuel
      ? [
          "",
          input.refuel.hasReceipt
            ? "A photo of the fuel receipt is on the booking."
            : "No photo of the fuel receipt was attached.",
        ]
      : []),
    "",
    input.bookingsUrl,
    "",
    "If any of these figures look wrong, tell whoever looks after the fleet.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * "That booking is gone" — to whoever booked it and, when different, to
 * whoever was going to drive.
 *
 * Sent even to the person who did the cancelling, because a booking made on
 * somebody's behalf can be undone by either of them, and silence is exactly how
 * two people both turn up expecting a car that nobody has. It says who did it
 * for the same reason.
 */
export function vehicleBookingCancelledEmail(
  input: VehicleTrip & {
    name: string;
    cancelledByName: string;
    /** True on the copy going to whoever pressed the button. */
    byYou: boolean;
    /** Why it was taken, if they'd said — the reminder of which booking this was. */
    purpose: string | null;
  },
) {
  const title = tripTitle(input);
  const subject = `${input.vehicleName} booking cancelled — ${input.takenOnLabel}`;

  const opening = input.byYou
    ? `You've removed your booking of ${escapeHtml(title)}.`
    : `<strong>${escapeHtml(input.cancelledByName)}</strong> has removed the booking of ${escapeHtml(title)}.`;

  const html = emailShell({
    preheader: `It was for ${input.takenOnLabel}. The vehicle is free again.`,
    eyebrow: "Vehicle booking cancelled",
    heading: `Hi ${input.name},`,
    content: [
      p(opening),
      detailTable(tripRows(input)),
      ...(input.purpose ? [p("It was booked for:"), quote(escapeHtml(input.purpose))] : []),
      p(
        "Nothing was recorded against it — no mileage, no fuel. The vehicle is free for anyone to book over those times again.",
      ),
      button(input.bookingsUrl, "Open vehicle bookings"),
      ...(input.byYou
        ? []
        : [note("If you still need the vehicle, book it again — it's available.")]),
    ].join(""),
  });

  const text = [
    `Hi ${input.name},`,
    "",
    input.byYou
      ? `You've removed your booking of ${title}.`
      : `${input.cancelledByName} has removed the booking of ${title}.`,
    "",
    ...tripLines(input),
    ...(input.purpose ? ["", `It was booked for: ${input.purpose}`] : []),
    "",
    "Nothing was recorded against it — no mileage, no fuel.",
    "The vehicle is free for anyone to book over those times again.",
    "",
    input.bookingsUrl,
    ...(input.byYou ? [] : ["", "If you still need the vehicle, book it again — it's available."]),
  ].join("\n");

  return { subject, html, text };
}

/**
 * "An organiser has declined your booking" — to whoever booked it and, when
 * different, whoever was going to drive.
 *
 * The reason is the point of this email, not a footnote: somebody has overruled
 * a plan the reader had already made, and "declined" without a why is the kind
 * of message that generates an angry walk down the corridor. It's quoted
 * verbatim, in their own words, high up.
 */
export function vehicleBookingDeclinedEmail(
  input: VehicleTrip & {
    name: string;
    declinedByName: string;
    reason: string;
    /** Why it was taken, if they'd said — so they know which booking this was. */
    purpose: string | null;
  },
) {
  const title = tripTitle(input);
  const subject = `Your booking of ${input.vehicleName} has been declined`;

  const html = emailShell({
    preheader: `${input.declinedByName} has declined it — the reason is inside.`,
    eyebrow: "Vehicle booking declined",
    heading: `Hi ${input.name},`,
    content: [
      p(
        `<strong>${escapeHtml(input.declinedByName)}</strong> has declined the booking of ${escapeHtml(title)}. You won't have the vehicle for those times.`,
      ),
      p("The reason given:"),
      quote(escapeHtml(input.reason)),
      detailTable(tripRows(input)),
      ...(input.purpose ? [p("You'd booked it for:"), quote(escapeHtml(input.purpose))] : []),
      p(
        "Nothing was recorded against it — no mileage, no fuel. The vehicle is free for those times again, so another vehicle or another slot may work.",
      ),
      button(input.bookingsUrl, "See what's free"),
      note("If you think this is a mistake, take it up with them directly — replying here won't reach anyone."),
    ].join(""),
  });

  const text = [
    `Hi ${input.name},`,
    "",
    `${input.declinedByName} has declined the booking of ${title}. You won't have the vehicle for those times.`,
    "",
    `The reason given: ${input.reason}`,
    "",
    ...tripLines(input),
    ...(input.purpose ? ["", `You'd booked it for: ${input.purpose}`] : []),
    "",
    "Nothing was recorded against it — no mileage, no fuel.",
    "The vehicle is free for those times again, so another vehicle or another slot may work.",
    "",
    input.bookingsUrl,
    "",
    "If you think this is a mistake, take it up with them directly — replying here won't reach anyone.",
  ].join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------------------ */
/* Asking for a vehicle somebody else has                             */
/* ------------------------------------------------------------------ */

function vehicleTitle(name: string, reg: string, nickname?: string | null): string {
  return `${name}${nickname ? ` “${nickname}”` : ""} (${reg})`;
}

/**
 * "Can I have the car?" — to whoever holds it.
 *
 * Leads with the window being asked for rather than with the request, because
 * the answer usually turns on one question: does that overlap what I actually
 * need it for? Both windows are shown side by side for the same reason.
 */
export function vehicleStealRequestEmail(input: {
  holderName: string;
  requesterName: string;
  vehicleName: string;
  vehicleReg: string;
  vehicleNickname?: string | null;
  message: string;
  yourFromLabel: string;
  yourToLabel: string;
  wantedFromLabel: string;
  wantedToLabel: string;
  approveUrl: string;
  declineUrl: string;
}) {
  const title = vehicleTitle(input.vehicleName, input.vehicleReg, input.vehicleNickname);
  const subject = `${input.requesterName} is asking for ${input.vehicleName}`;

  const html = emailShell({
    preheader: `They want it ${input.wantedFromLabel} – ${input.wantedToLabel}.`,
    eyebrow: "Vehicle request",
    heading: `Hi ${input.holderName},`,
    content: [
      p(
        `<strong>${escapeHtml(input.requesterName)}</strong> would like ${escapeHtml(title)}, which you have booked.`,
      ),
      detailTable([
        ["Vehicle", escapeHtml(title)],
        ["You have it", escapeHtml(`${input.yourFromLabel} – ${input.yourToLabel}`)],
        ["They want it", escapeHtml(`${input.wantedFromLabel} – ${input.wantedToLabel}`)],
      ]),
      p("What they said:"),
      quote(escapeHtml(input.message)),
      p(
        "If you agree, your booking is shortened to end when theirs begins — or given up entirely if theirs covers the whole of it. If you already have the vehicle, that shortened time is when it needs to be back.",
      ),
      button(input.approveUrl, "Let them have it"),
      p(link(input.declineUrl, "Or decline, and say why")),
      note("Nothing changes until you answer. You'll need to be signed in."),
    ].join(""),
  });

  const text = [
    `Hi ${input.holderName},`,
    "",
    `${input.requesterName} would like ${title}, which you have booked.`,
    "",
    `You have it: ${input.yourFromLabel} - ${input.yourToLabel}`,
    `They want it: ${input.wantedFromLabel} - ${input.wantedToLabel}`,
    "",
    `What they said: ${input.message}`,
    "",
    "If you agree, your booking is shortened to end when theirs begins — or given up entirely if theirs covers the whole of it.",
    "If you already have the vehicle, that shortened time is when it needs to be back.",
    "",
    `Let them have it: ${input.approveUrl}`,
    `Decline: ${input.declineUrl}`,
    "",
    "Nothing changes until you answer. You'll need to be signed in.",
  ].join("\n");

  return { subject, html, text };
}

/** "It's yours" — to whoever asked. */
export function vehicleStealApprovedEmail(input: {
  requesterName: string;
  holderName: string;
  vehicleName: string;
  vehicleReg: string;
  vehicleNickname?: string | null;
  wantedFromLabel: string;
  wantedToLabel: string;
  bookingsUrl: string;
}) {
  const title = vehicleTitle(input.vehicleName, input.vehicleReg, input.vehicleNickname);
  const subject = `${input.vehicleName} is yours — ${input.wantedFromLabel}`;

  const html = emailShell({
    preheader: `${input.holderName} agreed. It's booked for you.`,
    eyebrow: "Vehicle request approved",
    heading: `Hi ${input.requesterName},`,
    content: [
      p(
        `<strong>${escapeHtml(input.holderName)}</strong> has let you have ${escapeHtml(title)}. It's booked for you — you don't need to do anything else.`,
      ),
      detailTable([
        ["Vehicle", escapeHtml(title)],
        ["Yours from", escapeHtml(input.wantedFromLabel)],
        ["Due back", escapeHtml(input.wantedToLabel)],
      ]),
      p(
        "The mileage, the fuel and anything you spend are filled in when you bring it back.",
      ),
      button(input.bookingsUrl, "Open vehicle bookings"),
      note("If you no longer need it, remove the booking so somebody else can have it."),
    ].join(""),
  });

  const text = [
    `Hi ${input.requesterName},`,
    "",
    `${input.holderName} has let you have ${title}. It's booked for you — you don't need to do anything else.`,
    "",
    `Yours from: ${input.wantedFromLabel}`,
    `Due back: ${input.wantedToLabel}`,
    "",
    "The mileage, the fuel and anything you spend are filled in when you bring it back.",
    "",
    input.bookingsUrl,
    "",
    "If you no longer need it, remove the booking so somebody else can have it.",
  ].join("\n");

  return { subject, html, text };
}

/** "Sorry, no" — to whoever asked, carrying the reason they gave. */
export function vehicleStealDeclinedEmail(input: {
  requesterName: string;
  holderName: string;
  vehicleName: string;
  vehicleReg: string;
  wantedFromLabel: string;
  wantedToLabel: string;
  reason: string;
  bookingsUrl: string;
}) {
  const subject = `${input.holderName} is keeping ${input.vehicleName}`;

  const html = emailShell({
    preheader: "They've said why.",
    eyebrow: "Vehicle request declined",
    heading: `Hi ${input.requesterName},`,
    content: [
      p(
        `<strong>${escapeHtml(input.holderName)}</strong> is keeping ${escapeHtml(input.vehicleName)} (${escapeHtml(input.vehicleReg)}) for ${escapeHtml(`${input.wantedFromLabel} – ${input.wantedToLabel}`)}.`,
      ),
      p("What they said:"),
      quote(escapeHtml(input.reason)),
      p("Another vehicle may be free for that window — the calendar shows the whole fleet."),
      button(input.bookingsUrl, "See what's free"),
    ].join(""),
  });

  const text = [
    `Hi ${input.requesterName},`,
    "",
    `${input.holderName} is keeping ${input.vehicleName} (${input.vehicleReg}) for ${input.wantedFromLabel} - ${input.wantedToLabel}.`,
    "",
    `What they said: ${input.reason}`,
    "",
    "Another vehicle may be free for that window — the calendar shows the whole fleet.",
    "",
    input.bookingsUrl,
  ].join("\n");

  return { subject, html, text };
}

/**
 * "Your account is waiting" — for somebody who has never signed in.
 *
 * ⚠️ There is deliberately NO PASSWORD in here. Passwords are stored hashed,
 * so the system cannot read anybody's back out to remind them of it. The only
 * alternative would be to mint a new one, which would break the password they
 * may already have — so this points at the reset link instead, and whatever
 * they were given still works if they can find it.
 */
export function signInNudgeEmail(input: {
  name: string;
  email: string;
  loginUrl: string;
  forgotUrl: string;
  profileUrl: string;
}) {
  const { name, email, loginUrl, forgotUrl, profileUrl } = input;
  const subject = "Your COLAB Hub account is waiting for you";

  const html = emailShell({
    preheader: "You have an account you haven't used yet — here's how to get in.",
    eyebrow: "Getting started",
    heading: `Hi ${name}, you haven't signed in yet`,
    content: [
      p(
        "You have a COLAB Hub account, but it's never been used. The Hub is where you book a meeting room or a car, see who's on reception, and find anyone's number.",
      ),
      detailTable([
        ["Sign in at", link(loginUrl)],
        ["Your username", escapeHtml(email)],
      ]),
      p(
        `Still have the password you were given? Use it. If you don't — nobody can look it up for you, not even the office, because passwords are stored scrambled. ${link(forgotUrl, "Choose a new one here")} and you'll get a link by email.`,
      ),
      button(profileUrl, "Sign in and set up my profile"),
      p(
        "Once you're in, please fill in your profile — a photo, your cell number and your birthday. It's what everyone else sees when they look you up.",
      ),
      note("If you don't think you should have an account, let the COLAB office know."),
    ].join(""),
  });

  const text = [
    `Hi ${name},`,
    "",
    "You have a COLAB Hub account, but it's never been used.",
    "",
    `Sign in at: ${loginUrl}`,
    `Your username: ${email}`,
    "",
    "Still have the password you were given? Use it. If you don't, nobody can look",
    "it up for you — passwords are stored scrambled. Choose a new one here:",
    forgotUrl,
    "",
    `Once you're in, please fill in your profile: ${profileUrl}`,
    "",
    "If you don't think you should have an account, let the COLAB office know.",
  ].join("\n");

  return { subject, html, text };
}

/** "Your profile is half empty" — for somebody who signs in but hasn't filled it in. */
export function profileNudgeEmail(input: {
  name: string;
  missing: string[];
  profileUrl: string;
  directoryUrl: string;
}) {
  const { name, missing, profileUrl, directoryUrl } = input;
  const subject = "Two minutes: finish your COLAB profile";

  const html = emailShell({
    preheader: `Still to add: ${missing.join(", ")}.`,
    eyebrow: "Your profile",
    heading: `Hi ${name}, your profile isn't finished`,
    content: [
      p(
        `Your entry in the ${link(directoryUrl, "COLAB team directory")} is missing a few things. It's what people see when they're trying to work out who you are or how to reach you.`,
      ),
      p("<strong>Still to add:</strong>"),
      bulletList(missing),
      button(profileUrl, "Finish my profile"),
      p("It takes about two minutes, and you only have to do it once."),
      note("Already added some of these? Then this list is out of date — have a look anyway."),
    ].join(""),
  });

  const text = [
    `Hi ${name},`,
    "",
    "Your entry in the COLAB team directory is missing a few things:",
    "",
    ...missing.map((m) => `  - ${m}`),
    "",
    `Finish your profile: ${profileUrl}`,
    "",
    "It takes about two minutes, and you only have to do it once.",
  ].join("\n");

  return { subject, html, text };
}
