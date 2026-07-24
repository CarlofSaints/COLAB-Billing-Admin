import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Enums                                                              */
/* ------------------------------------------------------------------ */

// "colab" = the parent billing entity; "sub" = one of the four billed sub-companies.
export const companyTypeEnum = pgEnum("company_type", ["colab", "sub"]);

// Billing allocation methods.
export const allocationMethodEnum = pgEnum("allocation_method", [
  "per_sqm",
  "headcount",
  "fixed",
]);

// Who/what triggered a logged event.
export const actorTypeEnum = pgEnum("actor_type", ["user", "system", "api"]);

// How often a scheduled mail goes out.
export const mailFrequencyEnum = pgEnum("mail_frequency", ["monthly", "weekly"]);

// Who a scheduled mail goes to: email groups, or each sub-company's own
// contact person (the admin who maintains that company's staff list).
export const mailAudienceEnum = pgEnum("mail_audience", ["groups", "company_contacts"]);

// A public hub sign-up request moves pending → approved/declined. A super
// admin gates it; approval creates the team member + their login.
export const signupStatusEnum = pgEnum("signup_status", ["pending", "approved", "declined"]);

// How a common space is divided across the sub-companies.
// "occupancy" = pro-rata by each company's occupied m²; "custom" = fixed % per company.
export const splitMethodEnum = pgEnum("split_method", ["occupancy", "custom"]);

// How the cost sitting on one Xero P&L expense account is recharged.
//   per_sqm   — split by effective floor-space share (rent-style)
//   headcount — split by staff count
//   equal     — even share each, regardless of size or headcount
//   fixed     — recovered through a fixed line item (parking etc.), not pro-rata
//   direct    — billed 100% to a single sub-company
//   percent   — split by percentages set per sub-company
//   exclude   — COLAB's own cost, never recharged
// Note: new values are appended, never inserted — Postgres enums only support
// ADD VALUE, and reordering would force the type to be recreated.
export const accountMethodEnum = pgEnum("account_method", [
  "per_sqm",
  "headcount",
  "fixed",
  "direct",
  "exclude",
  "equal",
  "percent",
  "controls",
]);

/** Per-company percentages for the "percent" method. Must total 100. */
export type PercentSplit = { companyId: number; percent: number };

/* ------------------------------------------------------------------ */
/* Companies (COLAB + the 4 sub-companies)                            */
/* ------------------------------------------------------------------ */

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: companyTypeEnum("type").notNull().default("sub"),
  regNumber: text("reg_number"),
  vatNumber: text("vat_number"),
  registeredAddress: text("registered_address"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  // Up to two further people who should also receive reminders (e.g. the
  // office manager as well as the director).
  contactName2: text("contact_name_2"),
  contactEmail2: text("contact_email_2"),
  contactName3: text("contact_name_3"),
  contactEmail3: text("contact_email_3"),
  // The Xero contact this company is invoiced as. Without it no invoice can
  // be raised, so the billing run checks this first.
  xeroContactId: text("xero_contact_id"),
  xeroContactName: text("xero_contact_name"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Roles, Permissions, Role-Permissions                              */
/* ------------------------------------------------------------------ */

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // super_admin, director, admin, viewer
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  rank: integer("rank").notNull().default(100), // lower = more powerful; used for display order
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // e.g. controls.manage
  label: text("label").notNull(),
  category: text("category").notNull(),
  sort: integer("sort").notNull().default(100),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

/* ------------------------------------------------------------------ */
/* Users                                                              */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id),
    active: boolean("active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/* ------------------------------------------------------------------ */
/* Staff                                                              */
/* ------------------------------------------------------------------ */

export const staff = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    cellNumber: text("cell_number"),
    email: text("email"),
    gender: text("gender"),
    // Which company the person belongs to (COLAB is a valid assignment).
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    position: text("position"),
    // Whether this person counts towards the headcount that shared costs are
    // split by. Some staff are on the list but shouldn't be billed for.
    includeInBilling: boolean("include_in_billing").notNull().default(true),
    active: boolean("active").notNull().default(true),

    /* --- Team-hub profile fields (self-maintained by the team member) --- */
    // The person's own login, once they've been turned into a user. The hub
    // links user↔team-member by email (the UID), but a nullable FK lets us
    // tell "has an account" from "profile filled in" and survives email edits.
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    dateOfBirth: date("date_of_birth"), // drives "birthdays this month"
    bio: text("bio"), // free text: "what I do at COLAB"
    favouriteColour: text("favourite_colour"), // stored as hex, e.g. "#4f46e5"
    hobbies: jsonb("hobbies").$type<string[]>(), // rendered as chips
    photoUrl: text("photo_url"), // Vercel Blob URL of their profile picture
    // Set the first time they save a profile — used to nudge empty profiles.
    profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("staff_company_idx").on(t.companyId),
    // Email is the UID that links a team member to their user account. Allow
    // many NULLs (staff without an email) but keep real addresses unique.
    uniqueIndex("staff_email_unique").on(t.email).where(sql`${t.email} is not null`),
  ],
);

/* ------------------------------------------------------------------ */
/* Team Hub events (Team Photo shoot, SANBS Blood Drive, …)           */
/* ------------------------------------------------------------------ */

// Upcoming happenings shown on the team dashboard. Managed by admins;
// visible to anyone with hub access.
export const hubEvents = pgTable(
  "hub_events",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    eventDate: date("event_date").notNull(),
    location: text("location"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hub_events_date_idx").on(t.eventDate)],
);

/* ------------------------------------------------------------------ */
/* Hub sign-up requests (public /join form → super-admin approval)    */
/* ------------------------------------------------------------------ */

// Someone new fills in the public join form. Nothing is created until a
// super admin approves — the human gate against abuse. On approval we make
// (or reuse) a staff row and issue a team_member login.
export const signupRequests = pgTable(
  "signup_requests",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    // Which COLAB company they're joining (COLAB itself is valid).
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: signupStatusEnum("status").notNull().default("pending"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signup_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/* Email Groups                                                       */
/* ------------------------------------------------------------------ */

export const emailGroups = pgTable("email_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailGroupMembers = pgTable(
  "email_group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => emailGroups.id, { onDelete: "cascade" }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.staffId] })],
);

/* ------------------------------------------------------------------ */
/* Scheduled mail (recurring reminders)                               */
/* ------------------------------------------------------------------ */

/**
 * A recurring reminder — e.g. "on the 25th, ask each sub-company's admin to
 * update their staff list before month-end billing". A single daily cron
 * decides which schedules are due, so the day is stored, not a cron string.
 */
export const mailSchedules = pgTable("mail_schedules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  audience: mailAudienceEnum("audience").notNull().default("company_contacts"),
  // Which groups to mail when audience = "groups".
  groupIds: jsonb("group_ids").$type<number[]>(),
  frequency: mailFrequencyEnum("frequency").notNull().default("monthly"),
  // monthly: 1–28 (clamped to the last day for short months). weekly: 0=Sun…6=Sat.
  dayOfMonth: integer("day_of_month"),
  dayOfWeek: integer("day_of_week"),
  active: boolean("active").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"), // "sent" | "failed" | "skipped"
  lastDetail: text("last_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Billing Controls                                                   */
/* ------------------------------------------------------------------ */

// Per-company allocation basis for the sqm and headcount methods.
// One row per sub-company.
export const companyAllocations = pgTable(
  "company_allocations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Floor space occupied, in square metres (drives per_sqm splits).
    squareMetres: numeric("square_metres", { precision: 12, scale: 2 }).notNull().default("0"),
    // Optional manual headcount override; when null we use the live staff count.
    headcountOverride: integer("headcount_override"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_alloc_company_unique").on(t.companyId)],
);

// How a fixed line item divides across companies.
//   quantity — `unit_amount` is a price each, and each company takes N units
//   percent  — `unit_amount` is the whole cost, and each company takes a share
export const fixedSplitModeEnum = pgEnum("fixed_split_mode", ["quantity", "percent"]);

// A fixed line item billed directly to companies (e.g. parking bays, or one
// person's salary split by agreed percentages).
export const fixedLineItems = pgTable("fixed_line_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  splitMode: fixedSplitModeEnum("split_mode").notNull().default("quantity"),
  // A price per unit in "quantity" mode; the total cost in "percent" mode.
  unitAmount: numeric("unit_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  // Hide the rand values from anyone without "View restricted values" —
  // salaries shouldn't be readable by everyone with billing access.
  sensitive: boolean("sensitive").notNull().default(false),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A company's share of a fixed line item. In "quantity" mode this is a number
// of units (Parking: OuterJoin ×3); in "percent" mode it is a percentage.
export const fixedLineAllocations = pgTable(
  "fixed_line_allocations",
  {
    id: serial("id").primaryKey(),
    fixedLineItemId: integer("fixed_line_item_id")
      .notNull()
      .references(() => fixedLineItems.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  },
  (t) => [uniqueIndex("fixed_alloc_unique").on(t.fixedLineItemId, t.companyId)],
);

/* ------------------------------------------------------------------ */
/* Xero expense account → split method mapping                        */
/* ------------------------------------------------------------------ */

/**
 * One row per mapped Xero P&L expense account. The account list itself lives
 * in Xero (fetched live); this table only records the billing decision, plus
 * a snapshot of the code/name so the mapping still reads sensibly when Xero
 * is unreachable or an account is later renamed.
 *
 * No row for an account = unmapped = left out of the billing run.
 */
export const expenseAccountMappings = pgTable(
  "expense_account_mappings",
  {
    id: serial("id").primaryKey(),
    // Xero AccountID (GUID) — stable even if the code or name changes.
    xeroAccountId: text("xero_account_id").notNull(),
    accountCode: text("account_code"),
    accountName: text("account_name").notNull(),
    accountType: text("account_type"), // EXPENSE / OVERHEADS / DIRECTCOSTS / …
    method: accountMethodEnum("method").notNull(),
    // Only for method = "direct": the sub-company that carries the whole cost.
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    // Only for method = "fixed": which fixed line item recovers this account.
    fixedLineItemId: integer("fixed_line_item_id").references(() => fixedLineItems.id, {
      onDelete: "set null",
    }),
    // Only for method = "percent".
    percentages: jsonb("percentages").$type<PercentSplit[]>(),
    // Hide every amount on this account — its supplier lines, its journal
    // reconciliation, and the invoice lines it produces.
    sensitive: boolean("sensitive").notNull().default(false),
    // With method = "fixed", how to split whatever the fixed line item doesn't
    // recover. The rule holds whether or not the amount is known here.
    balanceMethod: accountMethodEnum("balance_method"),
    balanceCompanyId: integer("balance_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    balancePercentages: jsonb("balance_percentages").$type<PercentSplit[]>(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("expense_account_map_unique").on(t.xeroAccountId)],
);

/**
 * A per-month split decision for one supplier's spend on one expense account
 * — the finer-grained override of `expense_account_mappings`, for accounts
 * that are too broad to split as a whole (e.g. Cost of sales covers both a
 * water supplier and a grocery run).
 *
 * One row per (supplier, account, month). A month with no row inherits the
 * most recent earlier month's decision, so recurring costs only have to be
 * split once; genuinely ad-hoc ones get set as they appear.
 */
export const supplierSplits = pgTable(
  "supplier_splits",
  {
    id: serial("id").primaryKey(),
    // Billing month this decision applies to, as "YYYY-MM".
    period: text("period").notNull(),
    xeroContactId: text("xero_contact_id").notNull(),
    supplierName: text("supplier_name").notNull(),
    accountCode: text("account_code").notNull(),
    accountName: text("account_name"),
    method: accountMethodEnum("method").notNull(),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    fixedLineItemId: integer("fixed_line_item_id").references(() => fixedLineItems.id, {
      onDelete: "set null",
    }),
    // Only for method = "percent".
    percentages: jsonb("percentages").$type<PercentSplit[]>(),
    // When method = "fixed", the fixed line item may recover less than COLAB
    // actually paid (e.g. 20 parking bays paid for, 16 taken up). These decide
    // how that leftover balance is split.
    balanceMethod: accountMethodEnum("balance_method"),
    balanceCompanyId: integer("balance_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    balancePercentages: jsonb("balance_percentages").$type<PercentSplit[]>(),
    // What the supplier's spend on this account came to that month — kept so
    // a past decision can still be explained after the Xero data moves on.
    amount: numeric("amount", { precision: 14, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supplier_split_unique").on(t.period, t.xeroContactId, t.accountCode),
    index("supplier_split_period_idx").on(t.period),
  ],
);

/* ------------------------------------------------------------------ */
/* App settings (key/value) — e.g. total building floor area          */
/* ------------------------------------------------------------------ */

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Common spaces (boardroom, training room, general common, …)        */
/* ------------------------------------------------------------------ */

export const commonSpaces = pgTable("common_spaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  squareMetres: numeric("square_metres", { precision: 12, scale: 2 }).notNull().default("0"),
  splitMethod: splitMethodEnum("split_method").notNull().default("occupancy"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-company percentage for a common space using the "custom" split method.
export const commonSpaceSplits = pgTable(
  "common_space_splits",
  {
    id: serial("id").primaryKey(),
    commonSpaceId: integer("common_space_id")
      .notNull()
      .references(() => commonSpaces.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    percent: numeric("percent", { precision: 6, scale: 2 }).notNull().default("0"),
  },
  (t) => [uniqueIndex("common_split_unique").on(t.commonSpaceId, t.companyId)],
);

/* ------------------------------------------------------------------ */
/* Invoice runs                                                       */
/* ------------------------------------------------------------------ */

// "recurring" = the predictable monthly charges (rent, fixed line items),
// billed ahead. "month_end" = the variable Xero actuals, billed in arrears
// once the month is reconciled.
export const invoiceRunTypeEnum = pgEnum("invoice_run_type", ["recurring", "month_end"]);

/** One generation of invoices for a billing month. */
export const invoiceRuns = pgTable(
  "invoice_runs",
  {
    id: serial("id").primaryKey(),
    period: text("period").notNull(), // YYYY-MM
    runType: invoiceRunTypeEnum("run_type").notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
    createdByUserId: integer("created_by_user_id"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_run_period_idx").on(t.period, t.runType)],
);

/** One invoice within a run — one per sub-company. */
export const invoiceRunInvoices = pgTable("invoice_run_invoices", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => invoiceRuns.id, { onDelete: "cascade" }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  // Populated once Xero accepts it; an error message otherwise.
  xeroInvoiceId: text("xero_invoice_id"),
  xeroInvoiceNumber: text("xero_invoice_number"),
  error: text("error"),
  // The exact lines that were sent, so a past invoice can always be explained.
  lines: jsonb("lines").$type<{ description: string; amount: number }[]>(),
});

/* ------------------------------------------------------------------ */
/* Activity / Audit Log                                               */
/* ------------------------------------------------------------------ */

export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    actorType: actorTypeEnum("actor_type").notNull().default("user"),
    actorId: integer("actor_id"), // users.id when actorType = user (no FK so logs survive user deletion)
    actorLabel: text("actor_label"), // human-readable, e.g. "Carl Dos Santos" or "Xero webhook"
    action: text("action").notNull(), // e.g. company.create, auth.login, mail.send
    entityType: text("entity_type"), // e.g. company, staff, invoice
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_created_idx").on(t.createdAt),
    index("activity_action_idx").on(t.action),
  ],
);

/* ------------------------------------------------------------------ */
/* Relations                                                          */
/* ------------------------------------------------------------------ */

export const companiesRelations = relations(companies, ({ many, one }) => ({
  staff: many(staff),
  allocation: one(companyAllocations, {
    fields: [companies.id],
    references: [companyAllocations.companyId],
  }),
  fixedLineAllocations: many(fixedLineAllocations),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  company: one(companies, { fields: [staff.companyId], references: [companies.id] }),
  user: one(users, { fields: [staff.userId], references: [users.id] }),
  groupMemberships: many(emailGroupMembers),
}));

export const emailGroupsRelations = relations(emailGroups, ({ many }) => ({
  members: many(emailGroupMembers),
}));

export const emailGroupMembersRelations = relations(emailGroupMembers, ({ one }) => ({
  group: one(emailGroups, {
    fields: [emailGroupMembers.groupId],
    references: [emailGroups.id],
  }),
  staff: one(staff, { fields: [emailGroupMembers.staffId], references: [staff.id] }),
}));

export const fixedLineItemsRelations = relations(fixedLineItems, ({ many }) => ({
  allocations: many(fixedLineAllocations),
}));

export const fixedLineAllocationsRelations = relations(fixedLineAllocations, ({ one }) => ({
  item: one(fixedLineItems, {
    fields: [fixedLineAllocations.fixedLineItemId],
    references: [fixedLineItems.id],
  }),
  company: one(companies, {
    fields: [fixedLineAllocations.companyId],
    references: [companies.id],
  }),
}));

export const companyAllocationsRelations = relations(companyAllocations, ({ one }) => ({
  company: one(companies, {
    fields: [companyAllocations.companyId],
    references: [companies.id],
  }),
}));

export const expenseAccountMappingsRelations = relations(expenseAccountMappings, ({ one }) => ({
  company: one(companies, {
    fields: [expenseAccountMappings.companyId],
    references: [companies.id],
  }),
  fixedLineItem: one(fixedLineItems, {
    fields: [expenseAccountMappings.fixedLineItemId],
    references: [fixedLineItems.id],
  }),
}));

export const commonSpacesRelations = relations(commonSpaces, ({ many }) => ({
  splits: many(commonSpaceSplits),
}));

export const commonSpaceSplitsRelations = relations(commonSpaceSplits, ({ one }) => ({
  space: one(commonSpaces, {
    fields: [commonSpaceSplits.commonSpaceId],
    references: [commonSpaces.id],
  }),
  company: one(companies, {
    fields: [commonSpaceSplits.companyId],
    references: [companies.id],
  }),
}));

/* ------------------------------------------------------------------ */
/* Inferred types                                                     */
/* ------------------------------------------------------------------ */

export type Company = typeof companies.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type EmailGroup = typeof emailGroups.$inferSelect;
export type FixedLineItem = typeof fixedLineItems.$inferSelect;
export type FixedLineAllocation = typeof fixedLineAllocations.$inferSelect;
export type CompanyAllocation = typeof companyAllocations.$inferSelect;
export type CommonSpace = typeof commonSpaces.$inferSelect;
export type CommonSpaceSplit = typeof commonSpaceSplits.$inferSelect;
export type ExpenseAccountMapping = typeof expenseAccountMappings.$inferSelect;
export type MailSchedule = typeof mailSchedules.$inferSelect;
export type HubEvent = typeof hubEvents.$inferSelect;
export type SignupRequest = typeof signupRequests.$inferSelect;
export type SupplierSplit = typeof supplierSplits.$inferSelect;
export type InvoiceRun = typeof invoiceRuns.$inferSelect;
export type InvoiceRunInvoice = typeof invoiceRunInvoices.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
