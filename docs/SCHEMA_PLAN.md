# Flowzen · Schema Plan

**Document Version:** 1.0  
**Date:** 29 August 2026  
**Status:** Architecture Blueprint  
**Reference:** [`docs/PROJECT_BRIEF.md`](file:///d:/Harish/Flowzen/flowzen/docs/PROJECT_BRIEF.md)

---

## 1. Architectural Spine & Core Principles

The entire schema is built upon a single, unified spine:

```
COMPANY  (Prospect → Client → Past)
├── PERSON (Approver | Payer | Contact)
├── PROPOSAL (Retainer | Project)
│   ├── PROPOSAL_VERSION (v1, v2, v3... Immutable once sent)
│   └── PROFORMA (Advance payment request · Own sequential number)
│
├── RETAINER (Monthly work · No end date · Renews annually)
│   └── MONTH_CARD (One month · Auto-created on 1st · Holds work & financials)
│       ├── TASK (Created from TaskTemplate or ad hoc)
│       ├── COST (Direct client spend)
│       ├── PEOPLE_ALLOCATION (Confirmed head % split)
│       └── INVOICE (Tally Tax Invoice mirror) ──> PAYMENT
│
└── PROJECT (One-time work · Start/End date · Quoted & Estimated cost)
    ├── TASK
    ├── COST (Direct spend)
    ├── PEOPLE_ALLOCATION
    ├── MILESTONE (Advance, Phase, Delivery sign-offs)
    └── INVOICE ──> PAYMENT
```

### The Two Foundational Rules
1. **A Retainer is NOT a Project**: Ongoing monthly retainer work is never modeled as repeating "projects". A scheduled job creates a `MonthCard` on the 1st of every month.
2. **Does it end?**
   - **Yes** $\rightarrow$ `Project` (Fixed quoted value, estimated cost, start/end dates, milestone billing).
   - **No** $\rightarrow$ `Retainer` (Monthly recurring value, active month cards, renewal dates).
   - *There is no third type.*

---

## 2. Complete Entity Specifications

### 2.1 Identity, Tenancy & Organization

```prisma
enum RolePreset {
  EMPLOYEE
  HEAD
  BD
  ACCOUNTS
  MANAGEMENT
}

model Organization {
  id              String   @id @default(cuid())
  name            String
  proformaPrefix  String   @default("EL/PI")
  financialYearStart Int   @default(4) // April = 4
  timezone        String   @default("Asia/Kolkata")
  currency        String   @default("INR")
  workingHoursStart String @default("10:00")
  workingHoursEnd   String @default("19:00")
  workingDays     Int[]    @default([1, 2, 3, 4, 5, 6]) // Mon-Sat (0=Sun)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  users           User[]
  companies       Company[]
  outreachEntries OutreachEntry[]
  proposals       Proposal[]
  proformas       Proforma[]
  retainers       Retainer[]
  projects        Project[]
  tasks           Task[]
  taskTemplates   TaskTemplate[]
  costs           Cost[]
  invoices        Invoice[]
  alerts          Alert[]
  activities      Activity[]

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
  permissions    String[]   // Explicit array of permission keys overriding preset
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
```

---

### 2.2 CRM & Client Spine

```prisma
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
  
  // Derived in logic, indexed for fast query
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
  active     Boolean    @default(true) // POCs change, never delete
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
```

---

### 2.3 Sales, Proposals & Proformas

```prisma
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
  stage               ProposalStage    @default(TALKING) // Derived from state
  outcome             ProposalOutcome?
  wonVersionId        String?          @unique
  wonAt               DateTime?
  lostReason          String?
  probabilityOverride Int?             // 0 to 100
  verbalYesAt         DateTime?        // Set when verbally agreed
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
  value        Decimal   @db.Decimal(12, 2) // Monthly for Retainer, Total for Project
  scopeSummary String    // One line summary, e.g. "Scope trimmed, video dropped"
  sentAt       DateTime  @default(now())
  fileUrl      String?   // Document attachment URL
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
  number         String             // Sequential, e.g. EL/PI/26-27/012
  companyId      String
  sourceType     ProformaSourceType
  sourceId       String
  amount         Decimal            @db.Decimal(12, 2)
  raisedAt       DateTime           @db.Date
  validTill      DateTime           @db.Date
  status         ProformaStatus     @default(UNPAID)
  invoiceId      String?            @unique
  billingName    String             // Snapshotted at creation
  gstin          String?            // Snapshotted at creation
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
```

---

### 2.4 Retainers, Month Cards & Templates

```prisma
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
  termMonths     Int?           // Nullable = Month-to-month (flagged as contract risk)
  renewalDate    DateTime?      @db.Date // Computed from startDate + termMonths
  ownerId        String         // Account owner
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
  month       String          // Format: "YYYY-MM"
  revenue     Decimal         @db.Decimal(12, 2) // Snapshotted from Retainer.monthlyValue
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
  // JSON Structure: Array<{ title: string, dept: string, dayOfMonth: number, count?: number }>
  items          Json
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  retainers      Retainer[]

  @@map("task_templates")
}
```

---

### 2.5 Projects & Milestones

```prisma
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
  estimatedCost    Decimal?        @db.Decimal(12, 2) // Crucial for quote vs actual profit
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
  label     String          // "Advance 40%", "On design sign off 30%", "On launch 30%"
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
```

---

### 2.6 Work Tasks & Time Engine

```prisma
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
  workId              String?      // References MonthCard.id or Project.id (null if INTERNAL)
  monthCardId         String?
  projectId           String?
  assigneeId          String
  createdById         String
  dueDate             DateTime     @db.Date
  
  // The Time Clock
  assignedAt          DateTime     @default(now()) // Starts the clock on assignment
  completedAt         DateTime?    // Stops the clock
  status              TaskStatus   @default(OPEN)
  waitingOn           WaitingOn?
  waitingSince        DateTime?
  waitingTotalMinutes Int          @default(0)     // Accumulated hold time
  reopenCount         Int          @default(0)
  templateItemId      String?      // Links to TaskTemplate item for median benchmarks
  notes               String?      @db.Text
  attachments         Json?        // Array<{ name: string, url: string, size?: number }>
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
```

---

### 2.7 Costs, Financials & People Allocations

```prisma
enum CostType {
  DIRECT   // Belongs to a specific MonthCard or Project (Reduces Job Gross Margin)
  COMPANY  // General overhead (Office rent, Software, Tea - Company P&L only)
  CAPITAL  // Outside profit (Equipment, Deposits, Capex)
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
  workType         TaskWorkType? // Required if type == DIRECT
  workId           String?       // MonthCard.id or Project.id
  monthCardId      String?
  projectId        String?
  category         String        // Client: Ad spend, Freelancer, Shoot, Print... Company: Rent, Software...
  vendor           String
  amount           Decimal       @db.Decimal(12, 2)
  incurredAt       DateTime      @db.Date
  committedNotPaid Boolean       @default(false) // Warning signal for early overrun
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
  month           String       // Format: "YYYY-MM"
  workType        TaskWorkType // MONTH_CARD or PROJECT
  workId          String       // MonthCard.id or Project.id
  monthCardId     String?
  projectId       String?
  proposedPercent Int          // Auto-computed from completed task counts
  percent         Int          // Confirmed by Department Head (Percentages only, never INR)
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
  number         String        // Manually entered from Tally
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
  mode       String   // NEFT, RTGS, UPI, Cheque
  reference  String?
  createdAt  DateTime @default(now())

  invoice    Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("payments")
}
```

---

### 2.8 Alerts & Activity Audit Trail

```prisma
enum AlertSeverity {
  HIGH
  MED
  LOW
}

model Alert {
  id               String        @id @default(cuid())
  organizationId   String
  rule             String        // Identifier of the 12 rules, e.g. "RULE_PROPOSAL_FOLLOWUP"
  severity         AlertSeverity
  entityType       String        // "Proposal", "Invoice", "Project", "User", "Retainer"...
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
  entityType     String       // "Company", "Proposal", "Task", "MonthCard", "Project"...
  entityId       String
  actorId        String?
  verb           String       // "created", "version_added", "won", "completed", "hold_started"...
  payload        Json         @default("{}")
  at             DateTime     @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  actor          User?        @relation("ActorActivity", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([organizationId, entityType, entityId, at])
  @@map("activities")
}
```

---

## 3. Derived Values & Business Formulas

These values are **computed at read time** to guarantee zero data drift:

| Metric | Formula |
|---|---|
| **`Company.status`** | • `PROSPECT`: Default on creation or promotion from outreach.<br>• `CLIENT`: When $\ge 1$ proposal is `WON` or active retainer/live project exists.<br>• `PAST`: When no active retainer, no live project, and last activity $> 90$ days old. |
| **`Proposal.stage`** | • `TALKING`: Version 1 draft.<br>• `PROPOSAL_SENT`: Version 1 sent.<br>• `IN_NEGOTIATION`: Version count $> 1$.<br>• `PROFORMA_ISSUED`: Linked `Proforma` exists.<br>• `VERBAL_YES`: `verbalYesAt` is not null.<br>• `WON` / `LOST` / `EXPIRED`: Follows `outcome`. |
| **Task Working Elapsed** | `(completedAt ?? now) - assignedAt - waitingTotalMinutes` counted exclusively within **10:00 to 19:00 Mon–Sat IST**, excluding Sundays and registered holidays. |
| **Project `actualCost`** | $\sum \text{Direct Costs} + \sum (\text{Allocation \%} \times \text{User.monthlyCost})$ for all months the project was active. |
| **Job Profit & Margin** | $\text{Job Profit} = \text{Revenue} - \text{Direct Costs} - \text{People Costs}$ (Excludes company overheads).<br>$\text{Job Margin} = \frac{\text{Job Profit}}{\text{Revenue}}$. |
| **Company Net Profit** | $\text{Total Revenue} - \text{All Direct Costs} - \sum \text{Salaries} - \text{Company Overheads}$. *(Salaries counted exactly once).* |
| **Discount Given** | $\text{Version 1 Value} - \text{Won Version Value}$. |
| **Weighted Pipeline** | $\text{Current Version Value} \times (\text{Probability Override} \mathbin{??} \text{Stage Default \%})$. |
| **Committed Revenue** | $\sum \text{Active Retainer Values} + \sum \text{Milestones Due in Period}$ (Reported as two separate lines, never blended). |

---

## 4. Migration & Transition Strategy

1. **Clean Slate Cutover**: The target database will apply this schema cleanly via Prisma migrations.
2. **Data Mapping from Legacy Tables**:
   - `Lead` (old) $\rightarrow$ `OutreachEntry` (if cold) OR `Company` with `PROSPECT` (if contacted).
   - `Deal` / `Quote` (old) $\rightarrow$ `Proposal` + `ProposalVersion`.
   - `Engagement` (old retainers) $\rightarrow$ `Retainer` + `MonthCard`.
   - `Project` (old one-off jobs) $\rightarrow$ `Project` + `Milestone`.
   - `Task` (old) $\rightarrow$ `Task` (active tasks mapped; legacy closed tasks archived).
   - `Expense` (old) $\rightarrow$ `Cost` with `type = COMPANY` (historical spend lacked project IDs).
3. **Data Integrity Guarantee**: Historical job profitability starts on Day 1 of live cutover.
