import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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

// How a common space is divided across the sub-companies.
// "occupancy" = pro-rata by each company's occupied m²; "custom" = fixed % per company.
export const splitMethodEnum = pgEnum("split_method", ["occupancy", "custom"]);

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
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("staff_company_idx").on(t.companyId)],
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

// Fixed line items billed straight to a specific company (e.g. parking bays).
export const fixedLineItems = pgTable(
  "fixed_line_items",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
    unitAmount: numeric("unit_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fixed_line_company_idx").on(t.companyId)],
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
  fixedLineItems: many(fixedLineItems),
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

export const fixedLineItemsRelations = relations(fixedLineItems, ({ one }) => ({
  company: one(companies, {
    fields: [fixedLineItems.companyId],
    references: [companies.id],
  }),
}));

export const companyAllocationsRelations = relations(companyAllocations, ({ one }) => ({
  company: one(companies, {
    fields: [companyAllocations.companyId],
    references: [companies.id],
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
export type CompanyAllocation = typeof companyAllocations.$inferSelect;
export type CommonSpace = typeof commonSpaces.$inferSelect;
export type CommonSpaceSplit = typeof commonSpaceSplits.$inferSelect;
export type ActivityLogEntry = typeof activityLog.$inferSelect;
