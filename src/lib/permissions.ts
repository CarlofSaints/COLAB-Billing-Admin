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
  { key: "staff.manage", label: "Add / edit / import team members", category: "Team Members", sort: 60 },

  // Team Hub (the social hub: dashboard + personal profiles)
  { key: "hub.view", label: "View team dashboard", category: "Team Hub", sort: 62 },
  {
    key: "profile.edit",
    label: "Create & edit own team member profile",
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
    key: "admin",
    name: "Admin",
    description: "Does the day-to-day work: staff, documents, invoices and announcements.",
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
    "profile.edit",
    "events.manage",
    "team.invite",
  ],

  // Admin: the operator. Manages staff, groups, mail and runs billing —
  // but does NOT configure controls or manage users/roles.
  admin: [
    "controls.view",
    "companies.view",
    "companies.manage",
    "staff.view",
    "staff.manage",
    "groups.view",
    "groups.manage",
    "mail.send",
    "billing.view",
    "billing.run",
    "logs.view",
    "hub.view",
    "profile.edit",
    "events.manage",
    "team.invite",
  ],

  // Viewer: minimal read-only.
  viewer: ["companies.view", "staff.view", "logs.view", "hub.view", "profile.edit"],

  // Team Member: just the social hub — see the team dashboard and maintain
  // their own profile. No billing, admin or settings access.
  team_member: ["hub.view", "profile.edit"],
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
