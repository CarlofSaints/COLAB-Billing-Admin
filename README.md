# COLAB — Billing & Admin

Admin & billing control centre for **COLAB House**, the registered entity that runs the shared
office space for four sub-companies: **OuterJoin, Atomic Marketing, Atomic Digital and iRam**.

At month-end, COLAB bills each sub-company for its share of shared expenses. Usage is split three
ways depending on the expense:

1. **Per square metre** — e.g. rent, divided by floor space occupied.
2. **Headcount** — e.g. utilities & consumables, divided per person.
3. **Fixed line item** — e.g. parking bays billed directly to a company.

This app houses those controls, the companies, staff, email groups, users/permissions and a full
activity log. Xero & Dext integration and automatic monthly invoicing come next.

## Stack

- **Next.js 16** (App Router) · **React 19** · **Tailwind v4**
- **Neon Postgres** + **Drizzle ORM**
- Credential auth (bcrypt + signed JWT cookie), role-based permissions
- **Resend** for announcements · **SheetJS** for Excel staff import

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL and AUTH_SECRET
npm run db:push                # create the tables in your Neon database
npm run db:seed                # roles, permissions, COLAB + 4 sub-companies, Super Admin
npm run dev
```

`db:seed` prints the temporary password for the initial Super Admin
(**carl@outerjoin.co.za**). You'll be asked to change it on first sign-in.

### Environment variables

| Variable                  | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`            | Neon Postgres pooled connection string.                            |
| `AUTH_SECRET`             | Long random string used to sign session cookies.                   |
| `RESEND_API_KEY`          | Resend API key (add in Vercel when ready to send mail).            |
| `MAIL_FROM`               | Verified sender, e.g. `COLAB <no-reply@colab2.co.za>`.             |
| `SEED_SUPERADMIN_PASSWORD`| Temp password used by `db:seed` for the first Super Admin.        |

## Roles

| Role            | Can do                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| **Super Admin** | Everything, including billing controls, users and the permissions grid.            |
| **Director**    | View everything across all companies. Cannot change controls or settings.          |
| **Admin**       | The operator: staff, documents, invoices, announcements. Not controls/users.       |
| **Viewer**      | Read-only basics.                                                                  |

Permissions are editable per role in **Roles & Permissions** (a live toggle grid). The Super Admin
role is locked to full access to prevent lock-outs.

## Deploying to Vercel

1. Import the repo in Vercel.
2. Add the **Neon** integration (sets `DATABASE_URL` automatically) or add it manually.
3. Add `AUTH_SECRET` (and later `RESEND_API_KEY` / `MAIL_FROM`).
4. After the first deploy, run `npm run db:push` and `npm run db:seed` against the production
   `DATABASE_URL` (locally with the prod env pulled, or via a one-off).
5. Point `www.colab2.co.za` (or a subdomain) at the Vercel project via DNS.

## Project layout

```
src/
  app/
    (app)/            # authenticated control-centre pages (sidebar shell)
      controls/       # sqm · headcount · fixed line items
      companies/      # sub-companies
      staff/          # staff + Excel import
      email-groups/   # groups & membership
      mail/           # announcement sender (Resend)
      users/          # user management
      roles/          # permissions grid
      logs/           # activity log
    actions/          # server actions (one file per domain)
    login/            # sign-in
    api/health/       # health check
  components/ui/      # design-system primitives
  db/                 # Drizzle schema, client, seed
  lib/                # auth, logging, permissions, utils
```
