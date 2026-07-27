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
