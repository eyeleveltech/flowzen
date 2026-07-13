# Flowzen — Corrections & Change Requests (Running Doc)

**Owner:** Akmal Rahman
**Dev team:** Harish (Naif, Jai)
**Product:** Flowzen — project.eyelevelstudio.in
**Started:** 11 Jul 2026
**Status legend:** OPEN → IN DEV → DONE

This is a running list. New corrections get appended at the bottom of the latest batch with a date stamp. Do not delete completed items, mark them DONE.

---

## Batch 1 — 11 Jul 2026

### A. Dashboard

| # | Item | Correction | Status |
|---|---|---|---|
| 1 | Active Clients count | Show only clients that have projects or tasks in an **open status** (not completed, or delayed). Any client with at least one item in an open status counts as active. Clients with everything completed drop out of this count. | OPEN |
| 2 | Active Projects count | Same logic. A project counts as active if it has at least one task **not marked completed**. Fully completed projects drop out. | OPEN |
| 3 | My Task widget | Rework as a **Pending Tasks** highlight. When the user logs in, their pending tasks should be visually highlighted, labelled "Pending Tasks" instead of "My Task". It should draw attention, not sit as a plain list. | OPEN |

### B. Clients — list view and filters

| # | Item | Correction | Status |
|---|---|---|---|
| 4 | Gantt view | **Remove Gantt** from the client section entirely. | OPEN |
| 5 | Status filter | Add a **"Select All"** option in the status dropdown (all statuses selectable in one click). | OPEN |
| 6 | Engagement filter | Add a **"Select All"** option in the engagement dropdown as well. | OPEN |
| 7 | Account Managers filter | Remove the word "All" from the label. "All Account Managers" becomes **"Account Managers"**. | OPEN |
| 8 | City filter | **Remove "Filter by City"** completely. | OPEN |
| 9 | Industry filter | Change "All Industry" to **"Select All"**. | OPEN |

### C. Client detail — Overview page

| # | Item | Correction | Status |
|---|---|---|---|
| 10 | Overview fields | The Overview tab must display **every field captured about the client** at creation/edit. No captured field should be hidden from the overview. | OPEN |
| 11 | Top action bar | Add three actions at the top of the client page: **Edit client details**, **Delete client**, and **Create Project** (create a project inside this client directly from here). | OPEN |
| 12 | Delete confirmation | Deleting a client must trigger a **confirmation popup** before anything is removed. No single-click deletes. | OPEN |

---

## Batch 2 — 11 Jul 2026

### D. Add Client form

| # | Item | Correction | Status |
|---|---|---|---|
| 13 | Client name field | Remove the client name field from Add Client details. Keep only the contact. | OPEN |

### E. DECIDED — Lifecycle Stage: CRM is master, Flowzen auto-maps

**Decision (11 Jul 2026):** The Flowzen client status field is renamed **"Lifecycle Stage"**. The Odoo CRM pipeline is the master. Flowzen's Lifecycle Stage is derived automatically from the CRM stage via a sync (both tools have APIs). Nobody sets Lifecycle Stage manually in Flowzen.

**Mapping table (source of truth for the sync):**

| CRM stage | Flowzen Lifecycle Stage |
|---|---|
| New Lead, Outreach, Meeting, Proposal, Negotiation, Contract | Prospect |
| Active Retainer, Active Project | Active |
| On Hold | On Hold |
| Project Completed | Completed |
| Churned | Churned |

Note: "On Hold" is being ADDED to the CRM pipeline (item 16 below) so the mapping is complete 1-to-1 with no manual exceptions.

| # | Item | Correction | Status |
|---|---|---|---|
| 14 | Rename field | Flowzen client "Status" field renamed to **"Lifecycle Stage"** everywhere it appears (client page, filters, dashboard). | OPEN |
| 15 | CRM → Flowzen sync | Build the auto-sync: Odoo CRM stage change updates the client's Lifecycle Stage in Flowzen per the mapping table above. CRM is master, Flowzen Lifecycle Stage becomes read-only. | OPEN |
| 16 | On Hold in CRM | Add **"On Hold"** as a stage in the Odoo CRM pipeline (sits between Active Project and Project Completed in the stage list). Owner: Akmal/Odoo side, not Flowzen dev. | OPEN |

---

## Batch 3 — 11 Jul 2026

### F. Client master page

| # | Item | Correction | Status |
|---|---|---|---|
| 17 | Overview segmentation | The client master page keeps the existing Notes option. All information captured in the Overview must be segmented into sections: **Contacts**, **Company Details**, **Company Contact People Details**. | OPEN |

### G. CRM — Client Payment

| # | Item | Correction | Status |
|---|---|---|---|
| 18 | Client Payment section | Add a **Client Payment** option on the client in the CRM. Visible ONLY in the CRM. It must never appear in the project management tool. | OPEN |

### H. Project Management — Projects list

| # | Item | Correction | Status |
|---|---|---|---|
| 19 | View switcher | Add a **View** option on the right side of the Projects section. Views: **List, Timeline, Calendar, Gantt**. Filter options sit alongside these views. | OPEN |
| 20 | Filter labels | Current filters are Search Projects, All Status, All Clients. Remove the word "All": rename to **Status** and **Clients/Owners**. Search stays. | OPEN |
| 21 | Due date filter | Add a **Due Date** filter with a calendar picker. | OPEN |

### I. Inside a project (project detail page)

| # | Item | Correction | Status |
|---|---|---|---|
| 22 | Budget/spend | **Remove budget, spend and all financial fields** from the project view in the PM tool. Money lives in the CRM only. | OPEN |
| 23 | Client details block | Show only the **company name** and the **contact person's name**. | OPEN |
| 24 | Task filters | Replace current task filters with: **Status, Assignee, Project Type, Due Date (calendar picker)**. The **Search bar sits above the filter row** so it looks clean. | OPEN |
| 25 | Add Task button | **Add Task** button on the top right of the project's task view. | OPEN |
| 26 | Custom field | Alongside Add Task, add a **customize/add field** option so any extra field can be added when needed. | OPEN |
| 27 | Milestones | **Remove Milestones** from the project detail page. | OPEN |

### J. Tasks section (main task view)

| # | Item | Correction | Status |
|---|---|---|---|
| 28 | Filter placement | All filters shown at the **top** of the task view. | OPEN |
| 29 | Task visibility rule | By default a user sees **only tasks assigned to them**, nobody else's. If the user is a **Manager with a team under them, they see all their team members' tasks** too. | OPEN |
| 30 | Filter labels + calendar | Remove the word "All" from every filter label. Add a **calendar (due date) filter**. | OPEN |
| 31 | Customize columns | Add a **customize columns** control on the right side (shown when no filter is applied). | OPEN |

### K. Departments

| # | Item | Correction | Status |
|---|---|---|---|
| 32 | Manager role | When a department is created, rename **"Head or Leaders" to "Manager"**. A department can have **multiple Managers**. | OPEN |

### L. UNIVERSAL — every list/board in BOTH CRM and PM tool (TOP PRIORITY)

| # | Item | Correction | Status |
|---|---|---|---|
| 33 | View Settings panel | Every board with a list (Clients, Projects, Tasks, pipeline — CRM and PM) gets a standard **View Settings** panel: **Name** (e.g. All Companies) · **View type** (List view, Board view) · **Table settings** (Data, Filters, Sort by) · **Sharing** (Copy link to view, Manage sharing, Export ⌘⇧X) · **Actions** (Save changes ⌘S, Reset to last save, Clone to new view, Delete view). | OPEN |
| 34 | Add Column (+) | Every table gets an **Add Column** option shown as a **"+"** at the end of the columns. Clicking it opens a **dropdown of ALL fields captured in the database for that entity**, so any captured field can be pulled in as a column. Common across CRM and PM. | OPEN |

### M. CRM — Pipeline Kanban view

| # | Item | Correction | Status |
|---|---|---|---|
| 35 | Collapse columns | Each kanban column gets an **arrow at its top-right corner to collapse** the column. | OPEN |
| 36 | Add from column | Each column shows all its cards populated, and below the last card a **"+" with an "Add Client" option**. | OPEN |
| 37 | Fixed header/footer | Each kanban column has a **fixed (floating) header and footer**; the client cards scroll inside between them. | OPEN |
| 38 | Column footer totals | The column footer shows the **total estimated value** of that stage and the **weighted amount** (probability-weighted contribution to overall income). | OPEN |

---

## Batch 4 — 11 Jul 2026

### N. Task form — required fields

| # | Item | Correction | Status |
|---|---|---|---|
| 39 | Task field spec | The task (create/edit) must carry all the fields below. | OPEN |

**Field spec:**

| Field | Behaviour |
|---|---|
| Task Title | Text |
| Due Date and Time | Date + time picker |
| Repeat Task | Toggle. Mainly for repetitive tasks. |
| Repeat Frequency | Shown only when Repeat Task is on — options like Daily, Weekly, Monthly |
| Task Description | Long text |
| Project | Link to a project |
| Task Type | Dropdown |
| Reviewer | Person |
| Assigned By | Person |
| Assigned To | **Multiple people allowed** |
| Priority | Dropdown |
| Assigned Date | Date |
| Time Spent | Time tracking |
| Drive Link | URL field (Google Drive link) |

---

## Batch 5 — 11 Jul 2026

### O. Revenue capture — requirements (locked regardless of final module structure)

| # | Item | Correction | Status |
|---|---|---|---|
| 40 | Monthly payment visibility | Akmal must be able to see **who has paid** and **what the receivable is for the month** at a glance. | OPEN |
| 41 | Client type 1 — Project | Quotation sent → agreed payment. Capture: **advance received / no advance / full advance payment, GST component, total receivable**. Full revenue picture per project client. | OPEN |
| 42 | Client type 2 — Retainer | **Monthly repetitive retainer fee**, with tax in some cases, without tax in others. Both cases receive money month on month — capture the recurring schedule and receipts. | OPEN |
| 43 | Client type 3 — Events | Capture **total expenses and vendor payments** made for the event, alongside the revenue. | OPEN |
| 44 | Calls & Meetings | NOT required in CRM — calls and meetings will be handled in the task manager instead. | DROPPED |

### P. DECIDED — Revenue becomes a full third module: CRM | Project Management | Revenue

**Decision (11 Jul 2026):** Flowzen has THREE modules. Money gets one home. The team lives in CRM and PM; the Revenue module is permission-gated.

| # | Item | Correction | Status |
|---|---|---|---|
| 45 | Module structure | Flowzen = **CRM \| Project Management \| Revenue**. CRM stays pure sales: **Pipeline, Quotations, Renewals** (rename from "Renewables"), **Lost Deals, Reports**. | OPEN |
| 46 | Revenue module tabs | New Revenue module with: **Revenue Overview** (who paid this month, receivables for the month, MRR) · **Contracts** · **Invoices** · **Payments** · **Subscriptions** (monthly retainers, with-tax and without-tax cases) · **Receivables** · **Expenses**. | OPEN |
| 47 | Expenses tab | Every expense is logged against a **project or event**: vendor name, amount, date, category. A project (event, photo shoot, etc.) can have **multiple vendors**. Must answer: for each project, how much did we spend in total. | OPEN |
| 48 | Per-project P&L | With expenses captured per project, show a **P&L per project/event**: revenue received minus total expenses. This generalizes the earlier "Events P&L" — events are one project type; every project gets the same treatment. | OPEN |
| 49 | Revenue permissions | Revenue module visible **only to Akmal** (and a finance role later). Module-level permission. Nothing from Revenue ever appears in the Project Management tool (consistent with item 22). | OPEN |

**Open question (not yet decided):** does Flowzen Revenue REPLACE Odoo invoicing or mirror it? Running both gives two versions of "receivables this month". Suggested direction: Flowzen becomes the single source for money, Odoo stays CRM-stage master only. To be confirmed by Akmal.

**How the 3 client types map to the Revenue module:**

| Client type | Where it lives |
|---|---|
| 1. Project (quotation → agreed payment, advance/no advance/full advance, GST, total receivable) | Quotations (CRM) → Contracts + Invoices + Payments + Receivables |
| 2. Monthly retainer (with or without tax, month-on-month) | Subscriptions + Payments |
| 3. Events (revenue + vendor expenses) | Invoices/Payments + Expenses → per-project P&L |

---

## Batch 6 — 11 Jul 2026

### Q. Unified Client entity (all three modules)

| # | Item | Correction | Status |
|---|---|---|---|
| 50 | One Client record everywhere | Merge all client/lead details into ONE standard **Client** entity shared by CRM, Project Management and Revenue. Whether the record is a lead or at any pipeline stage, it is the same Client. Created in CRM → flows into PM. Created in PM → flows into CRM. The data captured for a client is common and identical in all three modules. | OPEN |

**Clarification:** the CRM referenced throughout this doc is the **Flowzen CRM module** (not Odoo). The Lifecycle Stage sync in Section E is therefore an internal Flowzen sync: CRM module stage → PM module Lifecycle Stage.

### R. Pipeline — common fields (all stages)

| # | Item | Correction | Status |
|---|---|---|---|
| 51 | Next Follow-up Date | Rename "Follow-up Date" to **"Next Follow-up Date"**. It appears constantly at the **top in every stage**. | OPEN |
| 52 | Last Contacted Date | **Last Contacted Date** is a common field present in all stages. | OPEN |
| 53 | LinkedIn field | Remove the **LinkedIn Account** field from the Add Lead form and from every stage. Never ask for it. | OPEN |

### S. Pipeline — stage transition forms (fields asked when moving stages)

| # | Transition | Keep | Remove | Status |
|---|---|---|---|---|
| 54 | New Lead → Outreach | (nothing required) | Stage Change Notes | OPEN |
| 55 | Outreach → Meeting | **Meeting Date** (confirmed) | Outreach Channel Used, Response Status, Outreach Message Used, Stage Change Notes | OPEN |
| 56 | Meeting → Proposal | **Audit Required**, **Services Agreed in Scope** | Meeting Notes, Audit Findings, Audit Report Links, Next Step Agreed, Notes | OPEN |
| 57 | Proposal → Negotiation | **Deal Value**, **Expected Close Date**, **Proposal Sent Date**. Proposal document is auto-linked from inside the system (proposals are generated in-system, link directly, no manual link field). **Proposal validity auto-set to 14 days** from sent date. | Proposal Document Link (manual), Engagement Type, Stage Notes | OPEN |
| 58 | Negotiation → Contract | **Deal Value**, **Expected Close Date**, **Contract Type**, **Agreed Final Value** | Counter Offer Log, Key Objections, Stage Change Notes | OPEN |

### T. Pipeline — stage renames and end-of-pipeline flow

| # | Item | Correction | Status |
|---|---|---|---|
| 59 | Stage renames | "Closing" → **"Won & Closed"**. "Closed Lost/Close" → **"Lost & Closed"**. "Closed" → **"Project Completed"**. Active stays **Active**. | OPEN |
| 60 | End-of-pipeline flow | After Won & Closed: if retainer, move to **Active** the moment work starts. Whether retainer or one-time project, on completion both go to **Project Completed**. Everything lost/dead goes to **Lost & Closed** (final stage in the list). | OPEN |
| 61 | Won & Closed → Active gate | Mandatory check: **Contract Closed**. If the contract is not closed, the deal CANNOT move to Active Retainer. Capture: **Payment Terms, Billing Frequency, Start Date Confirmed**. Remove Stage Change Notes. All of these details must also be captured and reflected in the **Revenue module**. | OPEN |
| 62 | Lost & Closed reason | Remove every current field on this transition. Ask ONLY the lost reason, dropdown: **Quotation too high** · **Client got a better offer** · **Unknown (client doesn't want to proceed)** · **On hold** · **Not responsive (client not answering calls)**. | OPEN |

### U. Quotation → Pro Forma → Invoice Draft flow

| # | Item | Correction | Status |
|---|---|---|---|
| 63 | Quotation tab | New quotation created here shows as **Quotation** and **Pro Forma Invoice** (both options visible in the Quotation tab). | OPEN |
| 64 | Move to Invoice Draft | Quotation/Pro Forma gets a **"Move to Invoice Draft"** action. This creates an **Invoice Draft inside the Revenue module**. | OPEN |
| 65 | Invoice Draft behaviour | In Revenue → Invoice Drafts: the draft is **editable**. A button generates a **PDF** which the user downloads and sends to the accounts team. Accounts creates the official invoice in **Tally**. Flowzen never generates the official invoice — the draft is the reference document only. | OPEN |

---

<!-- Append next batch below this line with a date stamp -->
