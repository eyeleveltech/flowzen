# Flowzen · Master System Architecture & Engineering Blueprint

**Document Version:** 4.0 (Enterprise Rebuild)  
**Date:** 29 August 2026  
**Status:** Unified Master Specification  
**Governing Standards:**
* `PROJECT_BRIEF.md` (Domain & Core Business Engine)
* `building-components` (Accessible, Composable Radix/Shadcn Compound Components)
* `web-design-guidelines` (Vercel Web Interface Guidelines & Accessibility)
* `vercel-react-best-practices` (Next.js Performance & Waterfall Elimination)
* `turborepo` (Monorepo Workspace Boundaries & Build Caching)

---

## 1. Executive Summary & Core Business Spine

Flowzen is a specialized **Agency Operating System (Agency OS)** that unifies sales, delivery, financials, and team allocation into a single relational spine.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          THE UNIFIED DATA SPINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ COMPANY (Prospect → Client → Past)                                          │
│  ├── PERSON (Approver | Payer | Contact)                                    │
│  ├── PROPOSAL (Retainer | Project)                                          │
│  │    ├── PROPOSAL_VERSION (v1, v2, v3... Immutable once sent)              │
│  │    └── PROFORMA (Advance payment request · Sequential series)            │
│  │                                                                          │
│  ├── RETAINER (Monthly work · No end date · Renews annually)                │
│  │    └── MONTH_CARD (One month · Auto-created on 1st · Holds work & P&L)   │
│  │         ├── TASK (Template-spawned & ad-hoc)                             │
│  │         ├── COST (Direct client spend)                                   │
│  │         ├── PEOPLE_ALLOCATION (Confirmed head % split)                   │
│  │         └── INVOICE (Tally Tax Invoice mirror) ──> PAYMENT               │
│  │                                                                          │
│  └── PROJECT (One-time work · Start/End date · Quoted & Estimated cost)     │
│       ├── TASK                                                              │
│       ├── COST (Direct spend)                                               │
│       ├── PEOPLE_ALLOCATION                                                 │
│       ├── MILESTONE (Advance, Phase sign-offs, Delivery)                    │
│       └── INVOICE ──> PAYMENT                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The Two Foundational Invariants
1. **A Retainer is NOT a Project**: Ongoing retainer work never spawns manual repeating "projects". The 1st-of-month cron job automatically creates the `MonthCard` and schedules its template tasks.
2. **Does it end?**
   - **Yes** $\rightarrow$ `Project` (Fixed quoted value, estimated cost, start/end dates, milestone billing).
   - **No** $\rightarrow$ `Retainer` (Monthly recurring value, active month cards, renewal dates).
   - *There is no third type.*

---

## 2. Turborepo Monorepo Architecture

Flowzen is structured as a Turborepo monorepo with strict package boundaries:

```
flowzen/
├── apps/
│   ├── api/                 # Express + Prisma + Background Cron Workers
│   └── web/                 # Next.js (App Router) + Tailwind v4 + Framer Motion
├── packages/
│   └── shared/              # Pure TypeScript Types, Enums, Zod Schemas, & Utils
├── docs/                    # Architectural Specifications & Blueprints
├── turbo.json               # Pipeline configuration & build caching
└── package.json             # Root workspace definitions
```

### 2.1 Workspace Boundary Rules
* **`packages/shared`**: Zero framework dependencies (no React, no Prisma). Holds universal types, Zod contracts, and pure calculation utilities.
* **`apps/api`**: Owns Prisma client, database transactions, background cron engines, and HTTP route handlers.
* **`apps/web`**: Owns Next.js UI, Radix primitives, Zustand state stores, and SWR/React Query data-fetching layer.

---

## 3. Database Schema Blueprint (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. TENANCY & USERS
// ──────────────────────────────────────────────────────────────────────────────

enum RolePreset {
  EMPLOYEE
  HEAD
  BD
  ACCOUNTS
  MANAGEMENT
}

model Organization {
  id                String   @id @default(cuid())
  name              String
  proformaPrefix    String   @default("EL/PI")
  financialYearStart Int     @default(4) // April = 4
  timezone          String   @default("Asia/Kolkata")
  currency          String   @default("INR")
  workingHoursStart String   @default("10:00")
  workingHoursEnd   String   @default("19:00")
  workingDays       Int[]    @default([1, 2, 3, 4, 5, 6]) // Mon-Sat (0=Sun)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  users             User[]
  companies         Company[]
  outreachEntries   OutreachEntry[]
  proposals         Proposal[]
  proformas         Proforma[]
  retainers         Retainer[]
  projects          Project[]
  tasks             Task[]
  taskTemplates     TaskTemplate[]
  costs             Cost[]
  invoices          Invoice[]
  alerts            Alert[]
  activities        Activity[]

  @@map("organizations")
}

model User {
  id             String     @id @default(cuid())
  organizationId String
  name           String
  email          String     @unique
  passwordHash   String
  dept           String     // Design, Video, Marketing, Dev, BD, Art, Accounts
  monthlyCost    Decimal    @db.Decimal(12, 2) // CTC/month · setup.admin access only
  preset         RolePreset @default(EMPLOYEE)
  permissions    String[]   // Array of permission keys overriding preset
  active         Boolean    @default(true)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  organization       Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  ownedCompanies     Company[]          @relation("CompanyOwner")
  ownedProposals     Proposal[]         @relation("ProposalOwner")
  ownedRetainers     Retainer[]         @relation("RetainerOwner")
  ownedProjects      Project[]          @relation("ProjectOwner")
  assignedTasks      Task[]             @relation("TaskAssignee")
  createdTasks       Task[]             @relation("TaskCreator")
  enteredCosts       Cost[]             @relation("CostEnteredBy")
  allocations        PeopleAllocation[] @relation("UserAllocations")
  confirmedAllocations PeopleAllocation[] @relation("AllocationConfirmedBy")
  acknowledgedAlerts Alert[]            @relation("AlertAcknowledgedBy")
  activities         Activity[]         @relation("ActorActivity")

  @@index([organizationId, active])
  @@map("users")
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. CRM & CLIENT SPINE
// ──────────────────────────────────────────────────────────────────────────────

enum CompanyVertical {
  HEALTHCARE
  REAL_ESTATE
  D2C
  SPORTS
  IT_AND_SAAS
  RETAIL
  B2B
  HOSPITALITY
}

enum CompanySource {
  OUTREACH
  REFERRAL
  INBOUND
  PARTNER_AGENCY
  NETWORK
}

enum CompanyStatus {
  PROSPECT
  CLIENT
  PAST
}

model Company {
  id             String          @id @default(cuid())
  organizationId String
  name           String
  vertical       CompanyVertical
  source         CompanySource   @default(OUTREACH)
  ownerId        String?
  city           String
  website        String?
  gstin          String?
  billingAddress String?         @db.Text
  lostReason     String?
  status         CompanyStatus   @default(PROSPECT)
  archivedAt     DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  organization   Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  owner          User?           @relation("CompanyOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  people         Person[]
  proposals      Proposal[]
  proformas      Proforma[]
  retainers      Retainer[]
  projects       Project[]
  invoices       Invoice[]
  outreachEntry  OutreachEntry?  @relation("PromotedCompany")

  @@unique([organizationId, name])
  @@index([organizationId, status])
  @@index([ownerId])
  @@map("companies")
}

enum PersonRole {
  APPROVER
  PAYER
  CONTACT
}

model Person {
  id         String     @id @default(cuid())
  companyId  String
  name       String
  role       PersonRole @default(CONTACT)
  email      String?
  phone      String?
  linkedin   String?
  active     Boolean    @default(true)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  company    Company    @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, active])
  @@map("people")
}

enum OutreachStatus {
  NOT_CONTACTED
  CONTACTED
  REPLIED
  DEAD
}

model OutreachEntry {
  id                String          @id @default(cuid())
  organizationId    String
  name              String
  vertical          CompanyVertical
  source            CompanySource   @default(OUTREACH)
  ownerId           String?
  status            OutreachStatus  @default(NOT_CONTACTED)
  promotedCompanyId String?         @unique
  importedAt        DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  organization      Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  promotedCompany   Company?        @relation("PromotedCompany", fields: [promotedCompanyId], references: [id], onDelete: SetNull)

  @@index([organizationId, status])
  @@map("outreach_entries")
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. SALES, PROPOSALS & PROFORMAS
// ──────────────────────────────────────────────────────────────────────────────

enum ProposalKind {
  RETAINER
  PROJECT
}

enum ProposalStage {
  TALKING
  PROPOSAL_SENT
  IN_NEGOTIATION
  PROFORMA_ISSUED
  VERBAL_YES
  WON
  LOST
  EXPIRED
}

enum ProposalOutcome {
  WON
  LOST
  EXPIRED
}

model Proposal {
  id                  String           @id @default(cuid())
  organizationId      String
  companyId           String
  kind                ProposalKind
  ownerId             String
  stage               ProposalStage    @default(TALKING)
  outcome             ProposalOutcome?
  wonVersionId        String?          @unique
  wonAt               DateTime?
  lostReason          String?
  probabilityOverride Int?
  verbalYesAt         DateTime?
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  organization        Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company             Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  owner               User             @relation("ProposalOwner", fields: [ownerId], references: [id])
  wonVersion          ProposalVersion? @relation("WonVersion", fields: [wonVersionId], references: [id])
  versions            ProposalVersion[] @relation("ProposalVersions")
  proformas           Proforma[]

  @@index([organizationId, stage])
  @@index([companyId])
  @@index([ownerId])
  @@map("proposals")
}

model ProposalVersion {
  id           String    @id @default(cuid())
  proposalId   String
  n            Int       // 1, 2, 3...
  value        Decimal   @db.Decimal(12, 2)
  scopeSummary String
  sentAt       DateTime  @default(now())
  fileUrl      String?
  createdAt    DateTime  @default(now())

  proposal     Proposal  @relation("ProposalVersions", fields: [proposalId], references: [id], onDelete: Cascade)
  winningFor   Proposal? @relation("WonVersion")

  @@unique([proposalId, n])
  @@map("proposal_versions")
}

enum ProformaStatus {
  UNPAID
  PAID
  EXPIRED
  CANCELLED
}

enum ProformaSourceType {
  PROPOSAL
  MONTH_CARD
  PROJECT
}

model Proforma {
  id             String             @id @default(cuid())
  organizationId String
  number         String
  companyId      String
  sourceType     ProformaSourceType
  sourceId       String
  amount         Decimal            @db.Decimal(12, 2)
  raisedAt       DateTime           @db.Date
  validTill      DateTime           @db.Date
  status         ProformaStatus     @default(UNPAID)
  invoiceId      String?            @unique
  billingName    String
  gstin          String?
  terms          String             @db.Text
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  organization   Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company        Company            @relation(fields: [companyId], references: [id], onDelete: Cascade)
  proposal       Proposal?          @relation(fields: [sourceId], references: [id], map: "Proforma_Proposal_fkey")
  invoice        Invoice?           @relation(fields: [invoiceId], references: [id])

  @@unique([organizationId, number])
  @@index([organizationId, status])
  @@index([companyId])
  @@map("proformas")
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. RETAINERS, MONTH CARDS & TEMPLATES
// ──────────────────────────────────────────────────────────────────────────────

enum RetainerStatus {
  ACTIVE
  STOPPED
}

model Retainer {
  id             String         @id @default(cuid())
  organizationId String
  companyId      String
  monthlyValue   Decimal        @db.Decimal(12, 2)
  startDate      DateTime       @db.Date
  termMonths     Int?
  renewalDate    DateTime?      @db.Date
  ownerId        String
  status         RetainerStatus @default(ACTIVE)
  stoppedAt      DateTime?
  stopReason     String?
  templateId     String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company        Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  owner          User           @relation("RetainerOwner", fields: [ownerId], references: [id])
  template       TaskTemplate?  @relation(fields: [templateId], references: [id])
  monthCards     MonthCard[]

  @@index([organizationId, status])
  @@index([companyId])
  @@map("retainers")
}

enum MonthCardStatus {
  OPEN
  CLOSED
}

model MonthCard {
  id          String          @id @default(cuid())
  retainerId  String
  month       String          // "YYYY-MM"
  revenue     Decimal         @db.Decimal(12, 2)
  status      MonthCardStatus @default(OPEN)
  invoiceId   String?         @unique
  closedAt    DateTime?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  retainer    Retainer        @relation(fields: [retainerId], references: [id], onDelete: Cascade)
  invoice     Invoice?        @relation(fields: [invoiceId], references: [id])
  tasks       Task[]
  costs       Cost[]
  allocations PeopleAllocation[]

  @@unique([retainerId, month])
  @@index([month, status])
  @@map("month_cards")
}

model TaskTemplate {
  id             String       @id @default(cuid())
  organizationId String
  name           String
  items          Json         // Array<{ title: string, dept: string, dayOfMonth: number, count?: number }>
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  retainers      Retainer[]

  @@map("task_templates")
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. PROJECTS & MILESTONES
// ──────────────────────────────────────────────────────────────────────────────

enum ProjectStatus {
  LIVE
  DELIVERED
  CANCELLED
}

model Project {
  id               String          @id @default(cuid())
  organizationId   String
  companyId        String
  name             String
  quotedValue      Decimal         @db.Decimal(12, 2)
  estimatedCost    Decimal?        @db.Decimal(12, 2)
  startDate        DateTime        @db.Date
  endDate          DateTime        @db.Date
  ownerId          String
  status           ProjectStatus   @default(LIVE)
  sourceProposalId String?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  organization     Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company          Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
  owner            User            @relation("ProjectOwner", fields: [ownerId], references: [id])
  milestones       Milestone[]
  tasks            Task[]
  costs            Cost[]
  allocations      PeopleAllocation[]
  invoices         Invoice[]

  @@index([organizationId, status])
  @@index([companyId])
  @@map("projects")
}

enum MilestoneStatus {
  PENDING
  PROFORMA_RAISED
  INVOICED
  PAID
}

model Milestone {
  id        String          @id @default(cuid())
  projectId String
  label     String
  percent   Int
  amount    Decimal         @db.Decimal(12, 2)
  status    MilestoneStatus @default(PENDING)
  order     Int             @default(0)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  project   Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, order])
  @@map("milestones")
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. TASKS & TIME CLOCK ENGINE
// ──────────────────────────────────────────────────────────────────────────────

enum TaskWorkType {
  MONTH_CARD
  PROJECT
  INTERNAL
}

enum TaskStatus {
  OPEN
  WAITING
  DONE
}

enum WaitingOn {
  CLIENT
  ANOTHER_PERSON
}

model Task {
  id                  String       @id @default(cuid())
  organizationId      String
  title               String
  workType            TaskWorkType
  workId              String?
  monthCardId         String?
  projectId           String?
  assigneeId          String
  createdById         String
  dueDate             DateTime     @db.Date
  
  assignedAt          DateTime     @default(now())
  completedAt         DateTime?
  status              TaskStatus   @default(OPEN)
  waitingOn           WaitingOn?
  waitingSince        DateTime?
  waitingTotalMinutes Int          @default(0)
  reopenCount         Int          @default(0)
  templateItemId      String?
  notes               String?      @db.Text
  attachments         Json?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  assignee            User         @relation("TaskAssignee", fields: [assigneeId], references: [id])
  creator             User         @relation("TaskCreator", fields: [createdById], references: [id])
  monthCard           MonthCard?   @relation(fields: [monthCardId], references: [id], onDelete: Cascade)
  project             Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([organizationId, assigneeId, status])
  @@index([dueDate, status])
  @@index([monthCardId])
  @@index([projectId])
  @@map("tasks")
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. FINANCIALS, COSTS & ALLOCATIONS
// ──────────────────────────────────────────────────────────────────────────────

enum CostType {
  DIRECT
  COMPANY
  CAPITAL
}

enum CostPaidBy {
  COMPANY
  AKMAL
  JAMEEL_N_J_MACSON
}

enum CostTreatment {
  COMPANY_EXPENSE
  AKMAL_LOAN
  N_J_MACSON_LOAN
}

model Cost {
  id               String        @id @default(cuid())
  organizationId   String
  type             CostType
  workType         TaskWorkType?
  workId           String?
  monthCardId      String?
  projectId        String?
  category         String
  vendor           String
  amount           Decimal       @db.Decimal(12, 2)
  incurredAt       DateTime      @db.Date
  committedNotPaid Boolean       @default(false)
  paidBy           CostPaidBy    @default(COMPANY)
  treatment        CostTreatment @default(COMPANY_EXPENSE)
  enteredById      String
  recurring        Boolean       @default(false)
  notes            String?       @db.Text
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  organization     Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  enteredBy        User          @relation("CostEnteredBy", fields: [enteredById], references: [id])
  monthCard        MonthCard?    @relation(fields: [monthCardId], references: [id], onDelete: SetNull)
  project          Project?      @relation(fields: [projectId], references: [id], onDelete: SetNull)

  @@index([organizationId, type])
  @@index([monthCardId])
  @@index([projectId])
  @@index([incurredAt])
  @@map("costs")
}

model PeopleAllocation {
  id              String       @id @default(cuid())
  userId          String
  month           String       // "YYYY-MM"
  workType        TaskWorkType
  workId          String
  monthCardId     String?
  projectId       String?
  proposedPercent Int
  percent         Int          // Percentages only, never stores INR
  confirmedById   String?
  confirmedAt     DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  user            User         @relation("UserAllocations", fields: [userId], references: [id], onDelete: Cascade)
  confirmedBy     User?        @relation("AllocationConfirmedBy", fields: [confirmedById], references: [id], onDelete: SetNull)
  monthCard       MonthCard?   @relation(fields: [monthCardId], references: [id], onDelete: Cascade)
  project         Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([userId, month, workId])
  @@index([month, workId])
  @@map("people_allocations")
}

enum InvoiceStatus {
  RAISED
  PAID
  OVERDUE
  CANCELLED
}

model Invoice {
  id             String        @id @default(cuid())
  organizationId String
  number         String        // Entered from Tally
  companyId      String
  workType       TaskWorkType?
  workId         String?
  amount         Decimal       @db.Decimal(12, 2)
  raisedAt       DateTime      @db.Date
  dueAt          DateTime      @db.Date
  status         InvoiceStatus @default(RAISED)
  paidAt         DateTime?     @db.Date
  proformaId     String?       @unique
  projectId      String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company        Company       @relation(fields: [companyId], references: [id], onDelete: Cascade)
  project        Project?      @relation(fields: [projectId], references: [id], onDelete: SetNull)
  proforma       Proforma?     @relation
  monthCard      MonthCard?    @relation
  payments       Payment[]

  @@unique([organizationId, number])
  @@index([organizationId, status])
  @@index([companyId])
  @@map("invoices")
}

model Payment {
  id         String   @id @default(cuid())
  invoiceId  String
  amount     Decimal  @db.Decimal(12, 2)
  receivedAt DateTime @db.Date
  mode       String
  reference  String?
  createdAt  DateTime @default(now())

  invoice    Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("payments")
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. ALERTS & AUDIT TRAIL
// ──────────────────────────────────────────────────────────────────────────────

enum AlertSeverity {
  HIGH
  MED
  LOW
}

model Alert {
  id               String        @id @default(cuid())
  organizationId   String
  rule             String
  severity         AlertSeverity
  entityType       String
  entityId         String
  message          String
  raisedAt         DateTime      @default(now())
  resolvedAt       DateTime?
  acknowledgedById String?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  organization     Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  acknowledgedBy   User?         @relation("AlertAcknowledgedBy", fields: [acknowledgedById], references: [id], onDelete: SetNull)

  @@index([organizationId, resolvedAt, severity])
  @@index([entityType, entityId])
  @@map("alerts")
}

model Activity {
  id             String       @id @default(cuid())
  organizationId String
  entityType     String
  entityId       String
  actorId        String?
  verb           String
  payload        Json         @default("{}")
  at             DateTime     @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  actor          User?        @relation("ActorActivity", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([organizationId, entityType, entityId, at])
  @@map("activities")
}
```

---

## 4. UI/UX Design System & Component Architecture

Governed by `building-components` and Vercel's `web-design-guidelines`.

### 4.1 Strict Design Tokens
* **Color Ramp**:
  * Background: `#FAFAFA` (`--color-surface`)
  * Card / Panel Surface: `#FFFFFF` (`--color-white`)
  * Hover / Zebra Row: `#F3F4F6` (`--color-subtle`)
  * 1px Hairline Border: `#E5E7EB` (`--color-border`)
  * Primary Text / Headings: `#111827` (`--color-primary`)
  * Body Text: `#374151` (`--color-body`)
  * Supporting Meta / Icons: `#6B7280` (`--color-secondary`)
* **Elevation**: **Zero fancy drop shadows** in page flow. Cards and panels use a crisp 1px hairline border. Shadows are used exclusively on floating overlays (`--shadow-dropdown`, `--shadow-modal`).
* **Radius**: Unified `12px` (`rounded-xl`) across cards, buttons, inputs, and modals.
* **Typography**: Inter with **11px micro floor** (`text-micro`). All currency, hours, dates, and IDs use **`tabular-nums`** for vertical scanning.

---

### 4.2 Modern Radix/Shadcn Compound Components (`building-components`)

```tsx
// Composable Combobox Pattern (apps/web/src/components/ui/combobox.tsx)
export function Combobox<T extends { id: string; label: string }>({
  items,
  value,
  onChange,
  placeholder = "Select item…",
  searchPlaceholder = "Search…"
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="border border-border bg-white rounded-xl px-3.5 py-2.5 text-sm text-primary flex items-center justify-between hover:bg-subtle/60 transition-colors focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none min-h-11"
        >
          <span className="truncate">{selectedItem?.label ?? placeholder}</span>
          <ChevronsUpDown className="w-4 h-4 text-secondary shrink-0" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="bg-white border border-border rounded-xl shadow-dropdown p-1.5 z-50 min-w-55 animate-in fade-in-80"
          sideOffset={6}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="px-3 py-2 text-sm border-b border-border text-primary placeholder:text-muted focus:outline-none w-full bg-transparent mb-1"
          />
          <div className="max-h-60 overflow-y-auto">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange(item.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-body rounded-lg hover:bg-subtle hover:text-primary flex items-center justify-between transition-colors"
              >
                <span>{item.label}</span>
                {value === item.id && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

---

## 5. Next.js Performance & Engineering Guidelines (`vercel-react-best-practices`)

### 5.1 Waterfall Elimination
* **Parallel Fetching**: Utilize `Promise.all` across independent database queries in API routes and server components.
* **Deferred Await**: Move `await` statements inside the exact branches where data is used.
* **Fast Derived Values**: Compute company status, proposal stage, and job profitability on the fly at read-time instead of orchestrating multi-table update cascades.

### 5.2 Bundle Size & Dynamic Imports
* **Direct Imports**: Avoid index barrel files (`bundle-barrel-imports`). Import components directly from their specific module paths.
* **Lazy Modals & Drawers**: Heavy slide-over drawers (`TaskDetailDrawer`, `ProposalVersionModal`, `CostModal`) are dynamically loaded with `next/dynamic` so the initial route bundle remains under 60KB.
* **SWR Deduplication**: Client queries use SWR with deduplication keys, background revalidation on window focus, and optimistic updates for instant UI feedback.

---

## 6. Phased Implementation Roadmap

```
┌─────────────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
│ PHASE 1: FOUNDATIONS    │ ──> │ PHASE 2: SALES & CRM    │ ──> │ PHASE 3: WORK & TIME    │
│ Clean Schema & Auth     │     │ Proposals & Proformas   │     │ Retainers & My Work     │
└─────────────────────────┘     └─────────────────────────┘     └─────────────────────────┘
                                                                             │
┌─────────────────────────┐     ┌─────────────────────────┐     ┌────────────▼────────────┐
│ PHASE 6: INTELLIGENCE   │ <── │ PHASE 5: MARGIN & SPLIT │ <── │ PHASE 4: MONEY & COSTS  │
│ 12 Rules & Monday Brief │     │ 25th Allocations & P&L  │     │ Direct Spend & Invoices │
└─────────────────────────┘     └─────────────────────────┘     └─────────────────────────┘
```

* **Phase 1 (Foundations)**: Fresh schema reset, multi-tenant organization models, 12 RBAC permissions middleware, and clean seed script.
* **Phase 2 (Sales & CRM)**: Company directory, outreach promotion, proposals with immutable version trees, and sequential proforma generation.
* **Phase 3 (Work Execution)**: Retainer month cards (1st-of-month cron), Project milestones, Task time clock (Mon–Sat 10:00–19:00 IST), and My Work screen.
* **Phase 4 (Money & Financials)**: Cost ledger with mandatory `workId` on direct spend, Tally invoice registration, and payment reconciliation.
* **Phase 5 (Margin & Allocations)**: 25th-of-month allocation calculation job, head percentage confirmation drawer (without salary disclosure), and real-time job gross margin.
* **Phase 6 (Intelligence & Automation)**: Hourly evaluation of the 12 business rules, alert notifications, forward forecast, and Monday executive brief.
