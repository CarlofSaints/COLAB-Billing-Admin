/**
 * Central catalogue of permissions and the default role assignments.
 * The Roles & Permissions grid can override these at runtime, but this is
 * what gets seeded and what "Reset to defaults" restores.
 */

export type PermissionDef = {
  key: string;
  label: string;
  category: string;
  sort: number;
};

export const PERMISSIONS: PermissionDef[] = [
  // Controls
  { key: "controls.view", label: "View controls", category: "Billing Controls", sort: 10 },
  { key: "controls.manage", label: "Configure controls (sqm, headcount, fixed items)", category: "Billing Controls", sort: 20 },

  // Sub-companies
  { key: "companies.view", label: "View sub-companies", category: "Sub-Companies", sort: 30 },
  { key: "companies.manage", label: "Add / edit sub-companies", category: "Sub-Companies", sort: 40 },

  // Team Members (formerly "Staff" — keys kept as staff.* to avoid a data migration)
  { key: "staff.view", label: "View team members", category: "Team Members", sort: 50 },
  {
    key: "staff.manage",
    // Says "anyone else's" because the pair only makes sense read together:
    // this one is the right to edit OTHER people, profile.edit is the right to
    // edit YOURSELF. "Add / edit team members" gave no clue which.
    label: "Add / edit / import ANY team member (incl. company, tags, billing)",
    category: "Team Members",
    sort: 60,
  },

  // Team Hub (the social hub: dashboard + personal profiles)
  { key: "hub.view", label: "View team dashboard", category: "Team Hub", sort: 62 },
  {
    // Deliberately separate from staff.view. That one is the admin list —
    // billing flags, cell numbers, who's inactive. This is the read-only
    // social directory everybody gets.
    key: "hub.directory",
    label: "View Meet Your Team (the social directory)",
    category: "Team Hub",
    sort: 63,
  },
  {
    key: "profile.edit",
    label: "Create & edit OWN team member profile only",
    category: "Team Hub",
    sort: 64,
  },
  { key: "events.manage", label: "Manage team events", category: "Team Hub", sort: 66 },
  {
    key: "team.invite",
    label: "Invite team members & approve hub sign-ups",
    category: "Team Hub",
    sort: 68,
  },

  // Email groups
  { key: "groups.view", label: "View email groups", category: "Email Groups", sort: 70 },
  { key: "groups.manage", label: "Create / edit email groups", category: "Email Groups", sort: 80 },

  // Mail sender
  { key: "mail.send", label: "Send announcements", category: "Mail Sender", sort: 90 },

  // Billing / invoicing (future)
  { key: "billing.view", label: "View billing & invoices", category: "Billing & Invoices", sort: 100 },
  { key: "billing.run", label: "Generate & send invoices", category: "Billing & Invoices", sort: 110 },

  // Users
  { key: "users.view", label: "View users", category: "Users & Access", sort: 120 },
  { key: "users.manage", label: "Create / edit users", category: "Users & Access", sort: 130 },
  { key: "roles.manage", label: "Manage roles & permissions", category: "Users & Access", sort: 140 },

  // Integrations
  { key: "integrations.manage", label: "Manage Xero / Dext credentials", category: "Integrations", sort: 145 },

  // Restricted values
  {
    key: "values.restricted",
    label: "View restricted values (hidden amounts, e.g. salaries)",
    category: "Restricted Values",
    sort: 147,
  },

  // Office issues
  { key: "issues.manage", label: "View & manage reported issues", category: "Issues", sort: 144 },

  // User tags
  { key: "tags.manage", label: "Manage user tags", category: "User Tags", sort: 146 },

  // Reception rota. Viewing is for everyone — the desk rota is something the
  // whole office needs to be able to look up; editing it is not.
  { key: "reception.view", label: "View the reception rota", category: "Reception", sort: 146 },
  {
    key: "reception.manage",
    label: "View & edit the reception rota",
    category: "Reception",
    sort: 147,
  },

  // Meeting rooms. Booking itself needs only hub.view — everyone books; these
  // two are for looking after the rooms and sorting out other people's slots.
  { key: "rooms.manage", label: "Add / edit meeting rooms", category: "Meeting Rooms", sort: 151 },
  {
    key: "bookings.manage",
    label: "Cancel or edit anyone's room booking",
    category: "Meeting Rooms",
    sort: 152,
  },

  // Vehicles. Booking one needs only hub.view — everybody drives; these two are
  // for looking after the fleet and for widening who may book what.
  {
    key: "vehicles.manage",
    label: "Add / edit vehicles in the fleet, and sign any vehicle back in",
    category: "Vehicles",
    sort: 153,
  },
  {
    /**
     * The right to hand out the exception, not the exception itself. Everyone
     * is limited to their own company's vehicles; this permission is what lets
     * you tick "Can book vehicles from other companies" on a team member.
     *
     * Directors only, by default and by request — moving a car between the
     * businesses is a decision about company property, not office admin.
     */
    key: "vehicles.crosscompany.grant",
    label: "Allow a team member to book OTHER companies' vehicles (Directors only)",
    category: "Vehicles",
    sort: 154,
  },

  // Admin tasks
  { key: "tasks.view", label: "View admin tasks", category: "Admin Tasks", sort: 148 },
  { key: "tasks.manage", label: "Create & assign admin tasks", category: "Admin Tasks", sort: 149 },

  // Logs
  { key: "logs.view", label: "View activity log", category: "Activity Log", sort: 150 },
];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ROLES: {
  key: string;
  name: string;
  description: string;
  rank: number;
}[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Full control, including billing controls, users and roles.",
    rank: 10,
  },
  {
    key: "director",
    name: "Director",
    description: "Sees everything across all companies, but cannot change controls or settings.",
    rank: 20,
  },
  {
    /**
     * Split out of Admin so that Admin could be handed out widely.
     *
     * Everything that shows or moves money lives here: the billing dashboard,
     * the invoice run, the controls that decide how costs are split, and the
     * Xero/Dext credentials. Admin keeps the office work and no longer sees any
     * of it.
     */
    key: "finance",
    name: "Finance",
    description:
      "Runs the billing: the dashboard, controls, invoice runs and the accounting integrations. No user or role administration.",
    rank: 25,
  },
  {
    key: "admin",
    name: "Admin",
    description:
      "Does the day-to-day office work: team members, the hub, tasks, reception and announcements. No billing — that's Finance.",
    rank: 30,
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to the basics.",
    rank: 40,
  },
  {
    key: "team_member",
    name: "Team Member",
    description:
      "A member of a COLAB company. Sees the team hub and maintains their own profile; no billing or admin access.",
    rank: 50,
  },
];

// All permission keys.
const ALL = PERMISSIONS.map((p) => p.key);

/**
 * The office operator's set — team members, the hub, tasks, reception,
 * announcements. Everything except money, users and roles.
 *
 * Named because Finance is defined as this PLUS the money, rather than as its
 * own hand-maintained list. Two lists that were meant to overlap would drift
 * the first time a permission was added to one of them.
 */
const ADMIN_PERMISSIONS = [
  "staff.view",
  "staff.manage",
  "groups.view",
  "groups.manage",
  "mail.send",
  "logs.view",
  "hub.view",
  "hub.directory",
  "profile.edit",
  "events.manage",
  "team.invite",
  "tasks.view",
  "tasks.manage",
  "tags.manage",
  "reception.view",
  "reception.manage",
  "issues.manage",
  "rooms.manage",
  "bookings.manage",
  "vehicles.manage",
];

/**
 * The money. Split out of Admin so that Admin could be handed to far more
 * people without showing them a single amount.
 *
 * `companies.view` belongs here because it gates the billing dashboard as well
 * as the Sub-Companies page — leaving it on Admin would defeat the split.
 */
const MONEY_PERMISSIONS = [
  "controls.view",
  "controls.manage",
  "companies.view",
  "companies.manage",
  "billing.view",
  "billing.run",
  "integrations.manage",
  "values.restricted",
];

/** Default permission set per role key. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  // Super Admin: everything.
  super_admin: [...ALL],

  // Director: view-only, but across all companies + billing visibility.
  director: [
    "controls.view",
    "companies.view",
    "staff.view",
    "staff.manage",
    "groups.view",
    "billing.view",
    "users.view",
    "logs.view",
    "hub.view",
    "hub.directory",
    "profile.edit",
    "events.manage",
    "team.invite",
    "tasks.view",
    "tasks.manage",
    "tags.manage",
    "reception.view",
    "reception.manage",
    "issues.manage",
    "rooms.manage",
    "bookings.manage",
    "vehicles.manage",
    // Deliberately NOT given to Admin below — Carl's rule is that only a
    // Director may let someone drive another company's car.
    "vehicles.crosscompany.grant",
  ],

  // Finance: everything Admin does, PLUS the money. These are the people who
  // ran the whole operation before the split — they lose nothing by moving
  // here, which is the only reason the split is safe to make.
  finance: [...ADMIN_PERMISSIONS, ...MONEY_PERMISSIONS],

  // Admin: the office operator, and now a role that can be handed out freely.
  // No billing, no controls, no sub-companies — those are Finance's.
  admin: [...ADMIN_PERMISSIONS],

  // Viewer: minimal read-only.
  viewer: [
    "companies.view",
    "staff.view",
    "logs.view",
    "hub.view",
    "hub.directory",
    "profile.edit",
    "reception.view",
  ],

  // Team Member: the social hub — the team dashboard, the directory, their own
  // profile, and (Carl's call) the shared address book and announcements.
  // `groups.view` is read-only: they can see who's in a group, not edit one.
  team_member: [
    "hub.view",
    "hub.directory",
    "profile.edit",
    "reception.view",
    "groups.view",
    "mail.send",
  ],
};

// The Super Admin role can never have permissions removed via the grid,
// to prevent locking everyone out.
export const LOCKED_ROLE_KEY = "super_admin";

/** Group permissions by category, preserving sort order. */
export function permissionsByCategory() {
  const map = new Map<string, PermissionDef[]>();
  for (const p of [...PERMISSIONS].sort((a, b) => a.sort - b.sort)) {
    if (!map.has(p.category)) map.set(p.category, []);
    map.get(p.category)!.push(p);
  }
  return Array.from(map.entries()).map(([category, perms]) => ({ category, perms }));
}
