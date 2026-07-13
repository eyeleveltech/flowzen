# Flowzen — Comprehensive Developer Note

**Product:** Flowzen (project.eyelevelstudio.in)
**Date:** 11 July 2026
**Owner:** Akmal Rahman
**For:** Harish, Naif, Jai
**Source:** Consolidates all 65 items from `Flowzen_Corrections_Running.md` (Batches 1-6). Item numbers in brackets [#] trace back to that doc.

---

## 0. Read this first — the big picture

Flowzen becomes **three modules**: **CRM | Project Management | Revenue** [45].

- **CRM** = pure sales. Pipeline, Quotations, Renewals, Lost Deals, Reports.
- **Project Management** = delivery. No money visible here, ever.
- **Revenue** (new module) = all money. Permission-gated to Akmal (+ a finance role later) [49].

One **Client** record is shared by all three modules [50]. The CRM pipeline stage is the master; the PM module's client "Lifecycle Stage" is derived from it automatically [14, 15].

---

## 1. Global — applies across all modules

### 1.1 Unified Client entity [50]

- ONE Client record shared by CRM, PM and Revenue. A lead, a prospect, and an active client are the same record at different lifecycle stages.
- Created in CRM → appears in PM. Created in PM → appears in CRM.
- The fields captured for a client are common and identical in all three modules (visibility of *money* fields is restricted by module permission, but the underlying record is one).

### 1.2 Lifecycle Stage (PM client status, derived from CRM stage) [14, 15, 16]

- Rename the PM client "Status" field to **"Lifecycle Stage"** everywhere: client page, filters, dashboard [14].
- Lifecycle Stage is **read-only** in PM. It auto-updates when the CRM pipeline stage changes [15].
- Mapping (uses the renamed stages from §3.2):

| CRM stage | PM Lifecycle Stage |
|---|---|
| New Lead, Outreach, Meeting, Proposal, Negotiation, Contract | Prospect |
| Won & Closed, Active | Active |
| On Hold | On Hold |
| Project Completed | Completed |
| Lost & Closed | Churned |

> **Confirm with Akmal:** whether "Won & Closed" should map to Active (assumed here) or stay Prospect until work starts.

### 1.3 View Settings panel — every list/board, both CRM and PM (TOP PRIORITY) [33]

Every board that renders a list (Clients, Projects, Tasks, Pipeline) gets a standard **View Settings** panel:

- **Name** (e.g. "All Companies")
- **View type:** List view · Board view
- **Table settings:** Data · Filters · Sort by
- **Sharing:** Copy link to view · Manage sharing · Export (⌘⇧X)
- **Actions:** Save changes (⌘S) · Reset to last save · Clone to new view · Delete view

### 1.4 Add Column "+" — every table (TOP PRIORITY) [34]

- At the end of every table's columns: a **"+"** button.
- Clicking it opens a dropdown of **all fields captured in the database for that entity**, so any captured field can be pulled in as a column.
- Common across CRM and PM.

### 1.5 Filter conventions (everywhere) [5, 6, 7, 9, 20, 30]

- Remove the word **"All"** from every filter label ("All Status" → "Status", "All Clients" → "Clients/Owners", "All Account Managers" → "Account Managers", "All Industry" → "Select All" option inside the dropdown).
- Every multi-option filter dropdown gets a **"Select All"** option.
- Due-date filters use a **calendar picker**.

---

## 2. Dashboard

| Change | Spec |
|---|---|
| Active Clients [1] | Count only clients with projects/tasks in an **open status** (not completed; delayed counts as open). A client with everything completed drops out. |
| Active Projects [2] | A project counts as active if it has **at least one task not marked completed**. |
| Pending Tasks [3] | Replace the "My Task" widget: on login the user's pending tasks are **highlighted**, labelled **"Pending Tasks"**. It should draw attention, not sit as a plain list. |

---

## 3. CRM module

### 3.1 Tabs

**Pipeline · Quotations · Renewals · Lost Deals · Reports** [45]

- Rename "Renewables" → **"Renewals"** [45].
- The earlier "Client Payment in CRM" request [18] is **superseded**: all payment data now lives in the Revenue module. The unchanged rule: payment data is never visible in PM.

### 3.2 Pipeline stages (final list)

1. New Lead
2. Outreach
3. Meeting
4. Proposal
5. Negotiation
6. Contract
7. **Won & Closed** (renamed from "Closing") [59]
8. **Active** (retainer or one-time project; deal moves here the moment work starts) [60]
9. On Hold [16]
10. **Project Completed** (renamed from "Closed"; both retainers and one-time projects land here on completion) [59, 60]
11. **Lost & Closed** (renamed from "Closed Lost"; final stage, everything dead lands here) [59, 60]

### 3.3 Common pipeline fields — all stages

- **Next Follow-up Date** (renamed from "Follow-up Date") — pinned at the **top of every stage** [51].
- **Last Contacted Date** — present in every stage [52].
- **Remove the LinkedIn Account field** from Add Lead and from every stage [53].

### 3.4 Stage transition forms — keep/remove spec [54-58]

| Transition | KEEP | REMOVE |
|---|---|---|
| New Lead → Outreach | nothing required | Stage Change Notes |
| Outreach → Meeting | Meeting Date (confirmed) | Outreach Channel Used · Response Status · Outreach Message Used · Stage Change Notes |
| Meeting → Proposal | Audit Required · Services Agreed in Scope | Meeting Notes · Audit Findings · Audit Report Links · Next Step Agreed · Notes |
| Proposal → Negotiation | Deal Value · Expected Close Date · Proposal Sent Date | Proposal Document Link (manual) · Engagement Type · Stage Notes |
| Negotiation → Contract | Deal Value · Expected Close Date · Contract Type · Agreed Final Value | Counter Offer Log · Key Objections · Stage Change Notes |

Notes on Proposal → Negotiation [57]:
- Proposals are generated inside the system, so the deal links **directly to the in-system proposal**. No manual link field.
- **Proposal validity auto-set to 14 days** from the sent date.

### 3.5 Won & Closed → Active gate [61]

- **Mandatory check: Contract Closed.** If the contract is not closed, the deal cannot move to Active. Hard block, not a warning.
- Capture on this transition: **Payment Terms · Billing Frequency · Start Date Confirmed.**
- No stage change notes.
- Everything captured here **flows into the Revenue module** (creates/updates the Subscription record for retainers).

### 3.6 Lost & Closed [62]

- Remove every existing field on this transition. Ask ONLY the **Lost Reason** (mandatory dropdown):
  - Quotation too high
  - Client got a better offer
  - Unknown — client doesn't want to proceed
  - On hold
  - Not responsive — client not answering calls

### 3.7 Pipeline Kanban view [35-38]

- Each column: **collapse arrow** at the top-right corner [35].
- Each column: all cards populated; below the last card, a **"+" with "Add Client"** [36].
- Each column: **fixed (floating) header and footer**; cards scroll between them [37].
- Column footer shows: **total estimated value** of the stage + **weighted amount** (probability-weighted contribution to overall income) [38].

### 3.8 Quotation → Pro Forma → Invoice Draft flow [63-65]

1. A new quotation in the Quotations tab is visible as **Quotation** and **Pro Forma Invoice**.
2. Action on it: **"Move to Invoice Draft"** → creates an **Invoice Draft in the Revenue module**.
3. In Revenue → Invoice Drafts: the draft is **editable**. A button **generates a PDF** which the user downloads and sends to the accounts team.
4. Accounts creates the official invoice in **Tally**. Flowzen NEVER generates the official invoice — the draft is a reference document only.

---

## 4. Project Management module

### 4.1 Clients — list view and filters [4-9]

- **Remove Gantt** from the client section [4].
- **Remove "Filter by City"** [8].
- Status filter: add **Select All** [5]. Engagement filter: add **Select All** [6]. Industry filter: "All Industry" → **Select All** [9].
- "All Account Managers" → **"Account Managers"** [7].

### 4.2 Client master page [10-13, 17]

- **Add Client form:** remove the client name field, keep only the **contact** [13].
- **Overview** shows **every field captured** for the client [10], segmented into: **Contacts · Company Details · Company Contact People Details** [17]. The existing Notes option stays.
- Top action bar: **Edit client details · Delete client · Create Project** [11].
- Deleting a client requires a **confirmation popup** — no single-click deletes [12].
- Lifecycle Stage shown here is read-only (see §1.2).

### 4.3 Projects list [19-21]

- **View switcher on the right:** List · Timeline · Calendar · Gantt. Filters sit alongside [19].
- Filters: Search stays; "All Status" → **Status**; "All Clients" → **Clients/Owners** [20].
- Add a **Due Date filter with calendar picker** [21].

### 4.4 Project detail page [22-27]

- **Remove budget, spend and all financial fields.** Money lives in Revenue only [22].
- Client details block: **company name + contact person's name** only [23].
- Task filters: **Status · Assignee · Project Type · Due Date (calendar picker)**. The **Search bar sits above the filter row** [24].
- **Add Task** button top right [25], plus a **customize/add field** option next to it [26].
- **Remove Milestones** from the project detail page [27].

### 4.5 Tasks section [28-31, 39]

**Layout and filters:**
- All filters at the **top** [28].
- Remove "All" from every filter label; add a **calendar (due date) filter** [30].
- **Customize columns** control on the right side (shown when no filter is applied) [31].

**Visibility rule [29]:**
- Default: a user sees **only tasks assigned to them**.
- A **Manager with a team** sees all their team members' tasks.

**Task field spec [39]:**

| Field | Behaviour |
|---|---|
| Task Title | Text |
| Due Date and Time | Date + time picker |
| Repeat Task | Toggle (for repetitive tasks) |
| Repeat Frequency | Only when Repeat Task is on: Daily / Weekly / Monthly etc. |
| Task Description | Long text |
| Project | Link to a project |
| Task Type | Dropdown |
| Reviewer | Person |
| Assigned By | Person |
| Assigned To | **Multiple people allowed** |
| Priority | Dropdown |
| Assigned Date | Date |
| Time Spent | Time tracking |
| Drive Link | URL (Google Drive) |

### 4.6 Departments [32]

- Rename "Head or Leaders" → **"Manager"**.
- A department can have **multiple Managers**. (Manager status drives the task-visibility rule in §4.5.)

---

## 5. Revenue module (NEW)

### 5.1 Tabs [46]

**Revenue Overview · Contracts · Invoices · Payments · Subscriptions · Receivables · Expenses** (+ **Invoice Drafts**, fed from Quotations, §3.8)

### 5.2 Revenue Overview [40]

One screen answering: **who has paid this month, and what is the receivable for the month.** Plus MRR from Subscriptions.

### 5.3 The three client revenue types [41-43]

| Type | Flow | Must capture |
|---|---|---|
| 1. Project client | Quotation (CRM) → Contract → Invoice → Payment → Receivable | Advance received / no advance / full advance · GST component · total receivable — the full revenue picture per project |
| 2. Monthly retainer | Subscriptions + Payments | Recurring monthly fee, **with tax and without tax** cases, month-on-month receipts |
| 3. Events | Invoices/Payments + Expenses | Revenue plus **total expenses and vendor payments** |

### 5.4 Expenses [47]

- Every expense is logged **against a project or event**: vendor name, amount, date, category.
- A project (event, photo shoot, etc.) can have **multiple vendors**.
- Must answer: "for each project, how much did we spend in total."

### 5.5 Per-project P&L [48]

- Revenue received minus total expenses, **per project/event**. Events are one project type; every project gets the same treatment.

### 5.6 Invoice Drafts [64, 65]

- Receives drafts from CRM Quotations ("Move to Invoice Draft").
- Draft is editable → button generates a **PDF for download** → sent to accounts → official invoice made in **Tally**. Flowzen never issues the official invoice.

### 5.7 Data inflow from CRM [61]

- The Won & Closed → Active gate (Payment Terms, Billing Frequency, Start Date Confirmed, Agreed Final Value) writes into Revenue automatically — retainers create/update a Subscription record.

### 5.8 Permissions [49]

- Revenue module visible **only to Akmal** (+ a finance role later). Module-level permission.
- Nothing from Revenue ever appears in the PM module (consistent with §4.4 removing budget/spend).

---

## 6. Open questions (waiting on Akmal)

1. **Odoo:** does Flowzen Revenue replace Odoo invoicing or mirror it? Suggested: Flowzen becomes the single money source.
2. **Won & Closed lifecycle mapping:** maps to Active in PM (assumed) or stays Prospect until work starts?
3. **On Hold stage position:** currently placed after Active in the stage list — confirm.

---

## 7. Suggested build order

1. **Unified Client entity** (§1.1) — everything else hangs off this data model.
2. **View Settings + Add Column "+"** (§1.3, 1.4) — flagged TOP PRIORITY, touches every screen.
3. **CRM pipeline changes** (§3.2-3.6) — stage renames, transition forms, gates. Daily-use surface.
4. **Dashboard + PM cleanups** (§2, §4) — mostly removals and relabels, fast wins.
5. **Revenue module** (§5) — biggest new build; needs 1 and 3 in place first.
6. **Kanban polish + Lifecycle sync** (§3.7, §1.2).

---

*Running change log with statuses: `EyeLevel/Internal/Flowzen_Corrections_Running.md`. New corrections keep getting appended there; this note is the consolidated spec as of 11 Jul 2026.*
