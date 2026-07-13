# FLOWZEN VERIFICATION WALKTHROUGH
**Document Type:** QA & Acceptance Testing Guide  
**Sources:** `Flowzen_Corrections_Running.md` + `Flowzen_Developer_Note_20260711.md`  
**Implementation Reference:** Actual source code only — no documentation trusted  
**Generated:** 2026-07-13  
**Scope:** All 65 requirements from Batches 1–6  

---

> [!IMPORTANT]
> This is a functional verification guide. It does NOT describe how the code is written.
> It describes what a QA Engineer, Team Lead, or Product Owner should **click through, observe, and verify** to confirm each requirement is working correctly in the running application.

---

## Table of Contents

1. [Module A — Dashboard](#module-a--dashboard)
2. [Module B — Clients List View & Filters](#module-b--clients-list-view--filters)
3. [Module C — Client Detail Page](#module-c--client-detail-page)
4. [Module D — Lifecycle Stage Sync](#module-d--lifecycle-stage-sync)
5. [Module E — CRM Tabs & Structure](#module-e--crm-tabs--structure)
6. [Module F — Pipeline Stages & Labels](#module-f--pipeline-stages--labels)
7. [Module G — Pipeline Common Fields](#module-g--pipeline-common-fields)
8. [Module H — Stage Transition Forms](#module-h--stage-transition-forms)
9. [Module I — Won & Closed to Active Gate](#module-i--won--closed-to-active-gate)
10. [Module J — Pipeline Kanban View](#module-j--pipeline-kanban-view)
11. [Module K — Quotation to Invoice Draft Flow](#module-k--quotation-to-invoice-draft-flow)
12. [Module L — Projects List](#module-l--projects-list)
13. [Module M — Project Detail Page](#module-m--project-detail-page)
14. [Module N — Tasks Section](#module-n--tasks-section)
15. [Module O — Task Field Specification](#module-o--task-field-specification)
16. [Module P — Departments](#module-p--departments)
17. [Module Q — Universal View Settings & Columns](#module-q--universal-view-settings--columns)
18. [Module R — Revenue Module](#module-r--revenue-module)
19. [Module S — Unified Client Entity](#module-s--unified-client-entity)
20. [Step 5 — Production Verification](#step-5--production-verification)
21. [Step 6 — Regression Checklist](#step-6--regression-checklist)
22. [Step 7 — Final Acceptance Checklist](#step-7--final-acceptance-checklist)
23. [Module Verification Summary](#module-verification-summary)

---

## Implementation Status Key

| Symbol | Meaning |
|--------|---------|
| IMPLEMENTED | Verified in source code, backend, and frontend |
| PARTIAL | Partially implemented — some sub-requirements missing |
| NOT IMPLEMENTED | No evidence found in codebase |

---

# Module A — Dashboard

**Items:** #1, #2, #3 from Batch 1

---

## TC-A-01 — Active Clients Count Logic

**Status:** IMPLEMENTED  
**Backend:** `apps/api/src/routes/dashboard.ts` — GET /api/dashboard/stats  
**Frontend:** `apps/web/src/app/(dashboard)/dashboard/page.tsx`  

### Objective
The "Active Clients" count on the dashboard must only include clients that have at least one project or task in an open (non-completed) status. Clients where every item is completed must be excluded.

### Preconditions
- Login as SUPER_ADMIN or ADMIN
- At least one client with active tasks exists
- At least one client with ALL tasks completed exists

### Steps
1. Log in to Flowzen
2. Navigate to /dashboard
3. Observe the "Active Clients" card (top stats row)
4. Note the count
5. Open a client that has only completed tasks
6. Mark all remaining tasks as "Completed"
7. Return to the dashboard
8. Wait 5-10 seconds (or refresh)
9. Observe the "Active Clients" count again

### Expected Result
- Count decreases by 1 after the client's last task is completed
- The client no longer appears as "active"

### Backend Verification
```
GET /api/dashboard/stats
-- Uses: prisma.client.count({ where: { OR: [ projects with open status, tasks with open status ] } })
```

### Pass Criteria
Active Clients count drops when a client's last open task is marked complete.

### Fail Criteria
Count remains unchanged, or includes clients with zero open tasks.

---

## TC-A-02 — Active Projects Count Logic

**Status:** IMPLEMENTED  
**Backend:** `apps/api/src/routes/dashboard.ts`  

### Objective
"Active Projects" count must only include projects that have at least one task not marked completed. Fully completed projects must be excluded.

### Preconditions
- At least one project with a mix of completed and incomplete tasks
- Login as SUPER_ADMIN

### Steps
1. Navigate to /dashboard
2. Note "Active Projects" count
3. Open a project
4. Mark every task in that project as "Completed"
5. Return to dashboard and refresh
6. Observe the count

### Expected Result
- Count decreases by 1 when the project's last task is completed

### Backend Verification
```
GET /api/dashboard/stats
-- Uses: prisma.project.count({ where: { status: IN ['PLANNING','IN_PROGRESS','REVIEW','ON_HOLD'], tasks: { some: { status: { not: 'COMPLETED' } } } } })
```

### Pass Criteria
Count accurately reflects only projects with at least 1 non-completed task.

### Fail Criteria
Count includes completed projects, or does not update after completion.

---

## TC-A-03 — Pending Tasks Widget

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/dashboard/page.tsx`  
**Note:** Widget is renamed "Pending Tasks" with highlight styling and BellDot icon. However, it shows tasks due within the next 7 days only, not all non-completed assigned tasks. The "draw attention" requirement is met with the icon and overdue badge.

### Objective
When a user logs in, the widget previously called "My Task" should be renamed "Pending Tasks" and visually highlighted to draw attention.

### Preconditions
- Login as any role with assigned tasks
- At least one task assigned to the logged-in user

### Steps
1. Log in
2. Navigate to /dashboard
3. Scroll to the task section in the lower-left column
4. Observe the widget title and visual style

### Expected Result
- Widget is labelled "Pending Tasks" (not "My Task")
- Widget uses a distinct visual style (icon, bold text, or color) to draw attention
- Overdue tasks are highlighted in red
- All-clear state shows "You're all caught up!" message

### Backend Verification
```
GET /api/dashboard/my-tasks
-- Returns tasks where: assigneeId = current user, status NOT IN ['COMPLETED']
```

### Pass Criteria
- Widget label is "Pending Tasks"
- Has visual distinction from a plain list
- Overdue tasks are marked differently

### Fail Criteria
- Widget still says "My Task"
- No visual distinction
- Plain unstyled list

---

# Module B — Clients List View & Filters

**Items:** #4, #5, #6, #7, #8, #9 from Batch 1

---

## TC-B-04 — Gantt View Removed from Clients

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/clients/page.tsx`  
**Note:** Code blocks Gantt from being restored from sessionStorage. Visual verification needed to confirm the Gantt button is fully absent from the UI.

### Objective
The Gantt view option must NOT appear anywhere in the Clients section.

### Steps
1. Log in and navigate to /clients
2. Look for any view toggle buttons (List, Board, Gantt, etc.)
3. Confirm no "Gantt" option appears

### Expected Result
No Gantt button visible in the Clients section.

### Pass Criteria
Zero Gantt references in the Clients page view controls.

### Fail Criteria
A Gantt tab or button appears in the Clients view.

---

## TC-B-05 — Status Filter: Select All

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/page.tsx` — showSelectAll={true} on MultiSelect

### Steps
1. Click the Status filter dropdown
2. Look for a "Select All" option at the top
3. Click "Select All"
4. Observe that all status options become selected

### Expected Result
- "Select All" option present at top of dropdown
- Clicking it selects all statuses simultaneously

### Pass Criteria
"Select All" selects all values; the list updates accordingly.

### Fail Criteria
No "Select All" option; user must click each status individually.

---

## TC-B-06 — Engagement Filter: Select All

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/page.tsx` — Engagement filter has showSelectAll={true}

### Steps
1. Navigate to /clients
2. Click the Engagements filter dropdown
3. Verify "Select All" is present
4. Click it and confirm all engagement types are selected

### Pass Criteria
"Select All" present and functional in the Engagements filter.

### Fail Criteria
No "Select All" option in Engagements filter.

---

## TC-B-07 — Account Managers Filter Label

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/page.tsx` — placeholder="Account Manager"

### Objective
The Account Managers filter label must show "Account Manager" (not "All Account Managers").

### Steps
1. Navigate to /clients
2. Find the Account Manager filter dropdown
3. Read the placeholder text when nothing is selected

### Expected Result
Placeholder reads "Account Manager" without "All" prefix.

### Pass Criteria
Label is "Account Manager".

### Fail Criteria
Label reads "All Account Managers".

---

## TC-B-08 — City Filter Removed

**Status:** PARTIAL  
**Note:** City data field exists in DB and forms. No city filter dropdown appears in the UI filter row. Visual verification required.

### Steps
1. Navigate to /clients
2. Scan all filter controls visible on the page
3. Confirm no "Filter by City" input or dropdown exists

### Expected Result
No city filter control visible on the Clients list page.

### Pass Criteria
Zero city filter UI elements found.

### Fail Criteria
A "Filter by City" or "City" dropdown/input appears.

---

## TC-B-09 — Industry Filter: Select All

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/page.tsx` — Industry filter has showSelectAll={true} and placeholder="Industries"

### Steps
1. Navigate to /clients
2. Click the Industries filter
3. Verify a "Select All" option appears inside the dropdown

### Expected Result
- Filter label is "Industries" (not "All Industry")
- Inside the dropdown: a "Select All" option at the top

### Pass Criteria
"Select All" inside the dropdown; no "All Industry" label used.

### Fail Criteria
Filter still shows "All Industry" with no "Select All" inside.

---

# Module C — Client Detail Page

**Items:** #10, #11, #12, #13, #17 from Batches 1, 2, 3

---

## TC-C-10 — Overview Shows All Captured Fields

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/clients/[id]/page.tsx`  
**Note:** Company Details and Contacts sections exist. Some fields (state, scope, assetLinks, startDate) may not all appear in segmented sections. Visual verification required.

### Objective
Every field captured during client creation/edit must be visible on the Overview tab. No field should be hidden.

### Preconditions
- Create a client with ALL fields filled: company, industry, address, GST, website, city, state, billing address, engagement type, scope, asset links, start date, contacts

### Steps
1. Navigate to a client detail page (/clients/:id)
2. Click the Overview tab
3. Verify each of these appears: Industry, Engagement Type, GST Number, Website, Address, City, State, Billing Address, Scope, Asset Links, Start Date
4. Check that Contacts section is visible

### Expected Result
All fields visible without having to open an edit form.

### Backend Verification
```
GET /api/clients/:id
-- Verify all fields are returned in the response
```

### Pass Criteria
Every non-empty field captured at creation is displayed in the Overview.

### Fail Criteria
Any filled field is hidden or missing from the Overview tab.

---

## TC-C-11 — Top Action Bar: Edit / Delete / Create Project

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/[id]/page.tsx`

### Steps
1. Navigate to any client detail page
2. Observe the top action bar

### Expected Result
Three action buttons visible:
- Edit Client — opens edit form
- Delete Client (red) — triggers confirmation
- Create Project — opens project creation modal

### Pass Criteria
All three buttons visible and functional.

### Fail Criteria
Any of the three buttons is absent or non-functional.

---

## TC-C-12 — Delete Confirmation Popup

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/[id]/page.tsx` — Uses useConfirmStore's confirm() dialog

### Steps
1. Navigate to a client detail page
2. Click Delete Client
3. Observe what happens immediately after the click

### Expected Result
- A confirmation modal appears BEFORE any deletion occurs
- Modal shows a warning message about permanent deletion
- Has a Cancel button and a Delete Client (red) confirm button
- Clicking Cancel: nothing is deleted
- Clicking Delete Client: proceeds with deletion

### Pass Criteria
Delete confirmation modal appears; no deletion on first click.

### Fail Criteria
Client is deleted immediately on first click without confirmation.

---

## TC-C-13 — Add Client Form: Remove Client Name Field

**Status:** PARTIAL  
**Note:** Form state includes name: '' — the name field may still appear. Visual verification required to confirm it is absent from the Add Client form UI.

### Steps
1. Navigate to /clients
2. Click Add Client
3. Examine the form fields presented

### Expected Result
- The form does NOT have a "Client Name" or "Name" input field
- The form DOES have Contact information fields (contact person name, email, phone)

### Pass Criteria
No "Client Name" field in Add Client form.

### Fail Criteria
A "Client Name" or "Name" field appears in the form.

---

## TC-C-17 — Overview Segmentation: Contacts / Company Details / Company Contact People Details

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/[id]/page.tsx` — Shows separate h4 headings for "Company Details" and "Contacts"

### Steps
1. Navigate to any client detail page
2. Review the Overview tab layout

### Expected Result
Overview is divided into clearly labelled sections:
- Company Details — industry, engagement type, address, GST, website
- Contacts — contact person cards (name, designation, email, phone)
- Existing Notes option preserved

### Pass Criteria
Separate visual sections with distinct headings.

### Fail Criteria
All fields shown as a flat unsegmented list.

---

# Module D — Lifecycle Stage Sync

**Items:** #14, #15 from Batch 2

---

## TC-D-14 — Field Renamed to "Lifecycle Stage"

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/clients/page.tsx` — conditional: activeModule === 'PM' ? 'Lifecycle Stage' : 'Status'

### Objective
In the PM module context, the "Status" field on client pages and filters must appear as "Lifecycle Stage".

### Steps
1. Log in and switch to the Project Management module
2. Navigate to /clients
3. Check the column header for the status field
4. Navigate to a client detail page and find the stage field label

### Expected Result
- Column header: "Lifecycle Stage"
- Detail page label: "Lifecycle Stage"

### Pass Criteria
"Lifecycle Stage" appears everywhere instead of "Status" in PM module.

### Fail Criteria
Any instance of "Status" remains visible in PM module context.

---

## TC-D-15 — CRM to PM Lifecycle Stage Auto-Sync

**Status:** PARTIAL  
**Note:** The mapping logic exists in STAGE_LABELS but an automated bridge updating client.status when lead.stage changes is not confirmed. Manual verification required.

**Mapping to verify:**

| CRM Stage | Expected Lifecycle Stage |
|-----------|------------------------|
| NEW_LEAD, OUTREACH, MEETING, PROPOSAL, NEGOTIATION, CONTRACT | Prospect |
| ACTIVE_RETAINER, ACTIVE_PROJECT | Active |
| ON_HOLD | On Hold |
| PROJECT_COMPLETED | Completed |
| CHURNED | Churned |

### Steps
1. Open a lead in the CRM Pipeline at NEGOTIATION stage
2. Navigate to Clients in the PM module
3. Find the corresponding client — note their Lifecycle Stage (should be "Prospect")
4. Return to CRM and move the lead to ACTIVE_RETAINER
5. Go back to PM Clients
6. Check the same client's Lifecycle Stage

### Expected Result
Lifecycle Stage automatically updates to "Active" without any manual change.

### Backend Verification
```
GET /api/clients/:id
-- Check that client.status reflects the CRM mapping after stage change
```

### Pass Criteria
Lifecycle Stage auto-updates on CRM stage change.

### Fail Criteria
Lifecycle Stage remains stale; requires manual update in PM module.

---

# Module E — CRM Tabs & Structure

**Items:** #45

---

## TC-E-01 — CRM Module Tabs: Pipeline / Quotations / Renewals / Lost Deals / Reports

**Status:** PARTIAL  
**Note:** Pages exist at /pipeline, /quotations, /renewals, /lost-deals, /reports. Visual label for "Renewals" (vs old "Renewables") needs confirmation.

### Steps
1. Log in as SUPER_ADMIN
2. Switch to the CRM module
3. Observe the sidebar navigation

### Expected Result
Sidebar shows exactly these tabs:
- Pipeline
- Quotations
- Renewals (NOT "Renewables")
- Lost Deals
- Reports

### Pass Criteria
All 5 tabs present with correct names.

### Fail Criteria
"Renewables" instead of "Renewals"; or any tab missing.

---

# Module F — Pipeline Stages & Labels

**Items:** #59, #60 from Batch 6

---

## TC-F-59 — Stage Renames Verified

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/pipeline/components/StageTransitionModal.tsx` — STAGE_LABELS constant  

| Old Name | New Name | DB Enum Value |
|----------|----------|--------------|
| Closing | Won & Closed | CONTRACT |
| Closed Lost | Lost & Closed | CHURNED |
| Closed | Project Completed | PROJECT_COMPLETED |

### Steps
1. Navigate to /pipeline
2. Switch to Board view (Kanban)
3. Observe the column header labels

### Expected Result
Column headers show: New Lead, Outreach, Meeting, Proposal, Negotiation, Won & Closed, Active (Retainer), Active (Project), On Hold, Project Completed, Lost & Closed

### Pass Criteria
Renamed stages appear correctly.

### Fail Criteria
Any old label (Closing, Closed Lost, Closed) appears in the UI.

---

## TC-F-60 — End-of-Pipeline Flow

**Status:** IMPLEMENTED

### Steps
1. Take a lead at Won & Closed (CONTRACT)
2. Move it to Active Retainer
3. Then complete the project — move to Project Completed
4. Verify lost leads can be moved to Lost & Closed from any stage

### Expected Result
- Retainers: CONTRACT -> ACTIVE_RETAINER -> PROJECT_COMPLETED
- Projects: CONTRACT -> ACTIVE_PROJECT -> PROJECT_COMPLETED
- Dead leads: any stage -> CHURNED

### Pass Criteria
All end-of-pipeline paths accessible via the stage change menu.

### Fail Criteria
A stage transition is blocked that should be allowed per the spec.

---

# Module G — Pipeline Common Fields

**Items:** #51, #52, #53 from Batch 6

---

## TC-G-51 — Next Follow-up Date Shown at Top

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/pipeline/components/LeadModal.tsx` — field labelled "Next Follow-up Date" exists  
**Note:** Spec requires it pinned at the TOP of every stage. Visual confirmation needed.

### Steps
1. Navigate to /pipeline
2. Open any lead card
3. Find the "Next Follow-up Date" field

### Expected Result
- Field labelled "Next Follow-up Date" (not "Follow-up Date")
- Appears prominently at the top of the lead detail

### Pass Criteria
Label is correct and field is prominently positioned.

### Fail Criteria
Old label "Follow-up Date" used; or field is buried at bottom.

---

## TC-G-52 — Last Contacted Date Field Present

**Status:** IMPLEMENTED  
**Schema:** Lead.lastContactedDate DateTime? in schema.prisma  
**Frontend:** `apps/web/src/app/(dashboard)/pipeline/components/LeadModal.tsx` — lastContactedDate field present

### Steps
1. Open any lead at any pipeline stage
2. Find the "Last Contacted Date" field

### Expected Result
"Last Contacted Date" field visible and editable for leads at every stage.

### Pass Criteria
Field present and functional in all pipeline stages.

### Fail Criteria
Field absent or only visible in specific stages.

---

## TC-G-53 — LinkedIn Field Removed from Add Lead Form

**Status:** PARTIAL  
**Note:** LinkedIn URL still exists in backend schema. No visible LinkedIn input in the standard Add Lead form UI, but LinkedIn Intelligence feature uses it internally. Visual verification needed.

### Steps
1. Navigate to /pipeline
2. Click Add Lead (the main modal)
3. Examine every input field in the form

### Expected Result
No "LinkedIn URL" or "LinkedIn Account" field visible in the Add Lead form.

### Pass Criteria
Zero LinkedIn URL input fields in the Add Lead form.

### Fail Criteria
A "LinkedIn URL" or "LinkedIn" field appears in the form.

---

# Module H — Stage Transition Forms

**Items:** #54-#58 from Batch 6

---

## TC-H-54 — New Lead to Outreach: Nothing Required

**Status:** IMPLEMENTED  
**Config:** `apps/web/src/app/(dashboard)/pipeline/lib/stage-config.ts` — OUTREACH: []

### Steps
1. Open a lead in New Lead stage
2. Move it to Outreach
3. Observe the transition form

### Expected Result
No form fields appear. Transition proceeds without any input. Stage Change Notes is absent.

### Pass Criteria
No fields presented; Stage Change Notes is gone.

### Fail Criteria
Stage Change Notes or any field appears.

---

## TC-H-55 — Outreach to Meeting: Only Meeting Date

**Status:** IMPLEMENTED  
**Config:** STAGE_FIELDS.MEETING = [{ key: 'meetingDate', label: 'Meeting Date Confirmed', type: 'date' }]

### Steps
1. Move a lead from Outreach to Meeting
2. Observe the transition form

### Expected Result
Only "Meeting Date Confirmed" field appears. None of: Outreach Channel Used, Response Status, Outreach Message Used, Stage Change Notes.

### Pass Criteria
Exactly one field: Meeting Date.

### Fail Criteria
Any removed field appears.

---

## TC-H-56 — Meeting to Proposal: Audit Required + Services in Scope

**Status:** IMPLEMENTED  
**Config:** STAGE_FIELDS.PROPOSAL = [auditRequired, servicesInScope]

### Steps
1. Move a lead from Meeting to Proposal
2. Observe the transition form

### Expected Result
Two fields:
- Audit Required? (dropdown: Yes / No)
- Services Agreed in Scope (multi-select checklist)

None of: Meeting Notes, Audit Findings, Audit Report Links, Next Step Agreed, Notes.

### Pass Criteria
Exactly the two specified fields present; all removed fields absent.

### Fail Criteria
Any removed field (Meeting Notes, etc.) appears.

---

## TC-H-57 — Proposal to Negotiation: Deal Value / Expected Close Date / Proposal Sent Date

**Status:** PARTIAL  
**Config:** STAGE_FIELDS.NEGOTIATION = [proposalSentDate] + requiresDealValue flag adds Deal Value + Expected Close Date  
**Note:** 14-day auto-validity for proposals needs backend verification.

### Steps
1. Move a lead from Proposal to Negotiation
2. Observe the transition form

### Expected Result
Three fields: Deal Value, Expected Close Date, Proposal Sent Date. None of: Proposal Document Link (manual), Engagement Type, Stage Notes.

### Backend Verification
```
PUT /api/crm/leads/:id/stage { stage: 'NEGOTIATION', proposalSentDate: '2026-07-13' }
-- Check if proposalValidUntil is auto-set to proposalSentDate + 14 days
```

### Pass Criteria
All three fields present; removed fields absent; 14-day auto-validity confirmed on backend.

### Fail Criteria
Manual Proposal Document Link appears; any removed field present; 14-day auto-validity missing.

---

## TC-H-58 — Negotiation to Contract: Deal Value / Expected Close Date / Contract Type / Agreed Final Value

**Status:** PARTIAL  
**Config:** CONTRACT stage shows Deal Value + Expected Close Date (via requiresDealValue) + Contract Type (via showsContractType) + agreedFinalValue in STAGE_FIELDS.CONTRACT

### Steps
1. Move a lead from Negotiation to Won & Closed (CONTRACT)
2. Observe the transition form

### Expected Result
Four fields: Deal Value, Expected Close Date, Contract Type, Agreed Final Value. None of: Counter Offer Log, Key Objections, Stage Change Notes.

### Pass Criteria
All four fields present; removed fields absent.

### Fail Criteria
Any removed field (Counter Offer Log, Key Objections) appears.

---

# Module I — Won & Closed to Active Gate

**Items:** #61 from Batch 6

---

## TC-I-61 — Hard Gate: Contract Closed Before Moving to Active

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/pipeline/components/StageTransitionModal.tsx` — Hard gate validation at lines 102-112  
**Config:** STAGE_FIELDS.ACTIVE_RETAINER and ACTIVE_PROJECT both have signedContractLink as required: true

### Objective
A lead at "Won & Closed" (CONTRACT) stage CANNOT move to Active unless the Signed Contract Link is provided. This is a hard block, not a warning.

### Preconditions
- Lead is in CONTRACT (Won & Closed) stage

### Steps
1. Open the lead in Won & Closed stage
2. Select Active (Retainer) or Active (Project)
3. Leave Signed Contract Document Link blank
4. Click Submit

### Expected Result
Toast error: "Contract must be closed (upload the signed contract link) before moving to Active." Stage does NOT change.

### Steps (Positive Case)
5. Enter a valid signed contract link
6. Fill Payment Terms, Billing Frequency, Start Date
7. Click Submit

### Expected Result (Positive)
Stage changes to Active; Revenue module receives the data.

### Backend Verification
```
PUT /api/crm/leads/:id/stage { stage: 'ACTIVE_RETAINER' }
-- Without signedContractLink: should return 400 error
-- GET /api/revenue/subscriptions -- should have a new entry for retainers
```

### Pass Criteria
Hard block enforced; Revenue record created on success.

### Fail Criteria
Stage changes without signed contract link; Revenue record not created.

---

# Module J — Pipeline Kanban View

**Items:** #35, #36, #37, #38 from Batch 3

---

## TC-J-35 — Column Collapse Arrow

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/pipeline/components/PipelineBoardView.tsx` — toggleCollapse(), collapsedColumns state, ChevronsLeft icon  
**Persistence:** sessionStorage key 'flowzen:pipeline:collapsed-columns'

### Steps
1. Navigate to /pipeline in Board view
2. Find the arrow icon at the top-right corner of any column
3. Click it

### Expected Result
- Column collapses to a narrow vertical strip
- Can be re-expanded by clicking again
- Collapsed state persists after page refresh

### Pass Criteria
Collapse/expand works; persists across refresh.

### Fail Criteria
No collapse arrow; or state does not persist.

---

## TC-J-36 — "+ Add Lead" Below Last Card in Each Column

**Status:** IMPLEMENTED  
**Frontend:** PipelineBoardView.tsx — setIsAddModalOpen(true) button with Plus icon labelled "Add Lead" at bottom of each column

### Steps
1. Navigate to Pipeline Board view
2. Scroll to the bottom of any column
3. Below the last lead card, look for a "+ Add Lead" button

### Expected Result
"+ Add Lead" button is visible below the last card in every column. Clicking it opens the Lead creation modal.

### Pass Criteria
Button present in all columns; modal opens correctly.

### Fail Criteria
Button absent; or only accessible from a global "New Lead" button elsewhere.

---

## TC-J-37 — Fixed Header and Footer; Cards Scroll Between Them

**Status:** IMPLEMENTED  
**Frontend:** PipelineBoardView.tsx — Column uses flex-col h-full with header (shrink-0), scrollable middle (flex-1 overflow-y-auto), footer (shrink-0)

### Steps
1. Navigate to Pipeline Board view
2. Scroll inside a column with many leads

### Expected Result
- Column header stays fixed at top
- Column footer stays fixed at bottom
- Only lead cards in the middle scroll

### Pass Criteria
Header and footer remain stationary while scrolling leads.

### Fail Criteria
Header or footer scrolls away when scrolling leads.

---

## TC-J-38 — Column Footer: Total Estimated Value + Weighted Amount

**Status:** IMPLEMENTED  
**Frontend:** PipelineBoardView.tsx — Footer shows columnValue (sum of deal values) and columnWeightedValue (sum x stage probability)

### Steps
1. Navigate to Pipeline Board view
2. Look at the footer of any column that has leads with deal values

### Expected Result
Footer shows two values:
- Total — sum of deal values for all leads in that column
- Weighted — probability-adjusted amount (e.g., 75% of total for Negotiation)

### Backend Verification
```
GET /api/crm/leads?stage=NEGOTIATION
-- Check each lead's dealValue field
```

### Pass Criteria
Both total and weighted amounts displayed and mathematically correct.

### Fail Criteria
Footer absent; or only one value shown; or values do not match deal values on cards.

---

# Module K — Quotation to Invoice Draft Flow

**Items:** #63, #64, #65 from Batch 6

---

## TC-K-63 — Quotation Tab Shows Both Quotation and Proforma Invoice Types

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/quotations/page.tsx` — Type filter has QUOTATION and PROFORMA_INVOICE options

### Steps
1. Navigate to /quotations
2. Create a new quotation
3. Observe that document type options include both Quotation and Proforma Invoice
4. In the list, check that both types are distinguished visually

### Expected Result
When creating: option to set document type as Quotation or Proforma Invoice. In the list: each document shows its type.

### Pass Criteria
Both document types accessible and displayed correctly.

### Fail Criteria
Only "Quotation" type exists; no Proforma Invoice option.

---

## TC-K-64 — "Move to Invoice Draft" Action on Accepted Quotations

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/quotations/page.tsx` — "Move to Invoice Draft" button appears when q.status === 'ACCEPTED'  
**API:** POST /api/revenue/invoice-drafts called with { quoteId, notes }

### Steps
1. Navigate to /quotations
2. Find a quotation with status ACCEPTED
3. Click the "Move to Invoice Draft" icon/button on that row

### Expected Result
- A confirmation dialog appears
- On confirm: A toast shows "Invoice draft created successfully"
- User is redirected to Invoice Drafts section

### Pass Criteria
Invoice Draft created; success feedback shown.

### Fail Criteria
Button not visible on Accepted quotes; action fails; no draft created.

---

## TC-K-65 — Invoice Draft: Editable, Generate PDF, Not Official Invoice

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/invoice-drafts/page.tsx`  
**API:** POST /api/revenue/invoice-drafts/:id/generate-pdf

### Steps
1. Navigate to /invoice-drafts
2. Find a draft
3. Click Edit — verify the draft is editable
4. Make a change and save
5. Click Generate PDF
6. PDF downloads/opens in new tab

### Expected Result
- Draft is fully editable (amounts, notes, items)
- "Generate PDF" button creates a downloadable PDF
- Flowzen does NOT produce a tax invoice — the PDF is a reference draft only

### Backend Verification
```
POST /api/revenue/invoice-drafts/:id/generate-pdf
-- Should return { pdfUrl: 'https://...' }
```

### Pass Criteria
Edit works; PDF generated and downloadable; system does not mark it as an official invoice.

### Fail Criteria
Draft not editable; PDF not generated.

---

# Module L — Projects List

**Items:** #19, #20, #21 from Batch 3

---

## TC-L-19 — View Switcher: List / Timeline / Calendar / Gantt

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/projects/page.tsx`  
**Note:** List, Board, Calendar, Timeline — all functional. Gantt shows "Coming Soon" placeholder — NOT a functional chart.

### Steps
1. Navigate to /projects
2. Look for view toggle buttons on the right side of the page
3. Click each view button: List, Board, Timeline, Calendar, Gantt

### Expected Result
- List view: table of projects
- Board view: Kanban-style project cards
- Timeline view: horizontal bar layout
- Calendar view: calendar layout
- Gantt view: functional Gantt chart (currently shows "Coming Soon")

### Pass Criteria
All 4 views functional.

### Fail Criteria
Any view is missing or non-functional (Gantt is currently incomplete).

---

## TC-L-20 — Filter Labels: No "All" Prefix

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/projects/page.tsx` — Filters use placeholder="Status" and placeholder="Clients/Owners"

### Steps
1. Navigate to /projects
2. Observe the filter dropdown labels when nothing is selected

### Expected Result
- Status filter shows "Status" (not "All Status")
- Client filter shows "Clients/Owners" (not "All Clients")

### Pass Criteria
No "All" prefix in any filter label.

### Fail Criteria
Any filter shows "All Status", "All Clients", etc.

---

## TC-L-21 — Due Date Filter with Calendar Picker

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/projects/page.tsx` — dueDateFilter state with date input

### Steps
1. Navigate to /projects
2. Find the Due Date filter
3. Click it and select a date
4. Observe the projects list

### Expected Result
Calendar/date picker appears; selecting a date filters projects.

### Pass Criteria
Date picker present and functional.

### Fail Criteria
No date picker for due date filtering.

---

# Module M — Project Detail Page

**Items:** #22, #23, #24, #25, #26, #27 from Batch 3

---

## TC-M-22 — No Budget/Financial Fields in Project View

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/projects/[id]/page.tsx`  
**Note:** Backend schema still has budget field. The edit form includes a budget input. Spec says remove budget and all financial fields.

### Steps
1. Navigate to any project detail page
2. Scan the page for any of: Budget, Spend, Financial fields, Cost, Revenue
3. Also open the Edit Project form
4. Check if budget appears

### Expected Result
Zero budget or financial fields visible anywhere in the PM project view or edit form.

### Pass Criteria
No budget/spend/financial fields visible in the PM project view or edit form.

### Fail Criteria
Budget field visible in project view or edit form.

---

## TC-M-23 — Client Details: Company Name + Contact Person Only

**Status:** PARTIAL  
**Note:** Client block in project detail needs visual verification to confirm it shows only company name and contact person — not address, industry, etc.

### Steps
1. Navigate to /projects/:id
2. Find the client information block on the page

### Expected Result
The client block shows only: Company name and Contact person's name.

### Pass Criteria
Exactly two fields: company name and contact person name.

### Fail Criteria
Additional client fields (address, industry, etc.) visible.

---

## TC-M-24 — Task Filters in Project Detail: Status / Assignee / Project Type / Due Date

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/projects/[id]/page.tsx`

### Steps
1. Navigate to /projects/:id
2. Look at the task filter controls

### Expected Result
- Search bar at the TOP (above the filter row)
- Status filter
- Assignee filter
- Project Type filter (or Task Type)
- Due Date filter with calendar picker

### Pass Criteria
All 4 filters present; search bar above them.

### Fail Criteria
Missing filter; search not at top.

---

## TC-M-25 — Add Task Button Top Right

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/projects/[id]/page.tsx`

### Steps
1. Navigate to /projects/:id
2. Look in the top-right area of the task section

### Expected Result
An "Add Task" button is visible at the top right of the task view.

### Pass Criteria
Button visible and functional at top right.

### Fail Criteria
No Add Task button, or it is positioned elsewhere.

---

## TC-M-26 — Customize/Add Field Option

**Status:** NOT IMPLEMENTED  
**Note:** No evidence of a "customize/add field" option alongside the Add Task button in the project detail page.

### Steps
1. Navigate to /projects/:id
2. Look next to the Add Task button for a "Customize" or "+" field option

### Expected Result
A "customize/add field" option is visible alongside the Add Task button.

### Pass Criteria
Option present and functional.

### Fail Criteria
No customize/add field option present. Currently: FAIL

---

## TC-M-27 — Milestones Removed from Project Detail

**Status:** NOT IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/projects/[id]/page.tsx`  
**Note:** showMilestoneModal, milestoneForm, openCreateMilestone() all still present in code. Milestones have NOT been removed.

### Steps
1. Navigate to /projects/:id
2. Look for a "Milestones" section or tab

### Expected Result
No Milestones section visible anywhere in the project detail page.

### Pass Criteria
Zero milestone references in the project detail UI.

### Fail Criteria
A Milestones section or "Add Milestone" button exists. Currently: FAIL

---

# Module N — Tasks Section

**Items:** #28, #29, #30, #31 from Batch 3

---

## TC-N-28 — All Filters at Top of Task View

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/tasks/page.tsx`

### Steps
1. Navigate to /tasks
2. Observe the layout

### Expected Result
All filter controls are at the TOP of the page, not in a sidebar or bottom bar.

### Pass Criteria
Filters visible at top before the task list.

### Fail Criteria
Filters in sidebar or below the task list.

---

## TC-N-29 — Task Visibility Rule: Own Tasks / Manager Sees Team

**Status:** IMPLEMENTED  
**Backend:** `apps/api/src/routes/tasks.ts` — TEAM_MEMBER role filtered to: assigneeId, assignees.some, project.members.some, project.teams.some

### Preconditions
- Two test accounts: one TEAM_MEMBER, one PROJECT_MANAGER
- Tasks assigned to different members

### Steps (TEAM_MEMBER)
1. Log in as TEAM_MEMBER
2. Navigate to /tasks
3. Observe which tasks are shown

### Expected Result (TEAM_MEMBER)
Only tasks assigned to this user are visible.

### Steps (PROJECT_MANAGER)
1. Log in as PROJECT_MANAGER
2. Navigate to /tasks

### Expected Result (PROJECT_MANAGER)
All tasks across their team are visible.

### Pass Criteria
TEAM_MEMBER sees only their tasks; managers see all team tasks.

### Fail Criteria
TEAM_MEMBER sees tasks assigned to other team members.

---

## TC-N-30 — Filter Labels Without "All" + Due Date Calendar Filter

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/tasks/page.tsx`

### Steps
1. Navigate to /tasks
2. Check all filter dropdown labels

### Expected Result
- No filter label starts with "All"
- A due date filter with calendar picker is present

### Pass Criteria
No "All" prefix; date picker exists.

### Fail Criteria
"All Status", "All Assignee" etc. appear; no date picker.

---

## TC-N-31 — Customize Columns Control

**Status:** PARTIAL  
**Note:** A column customization control needs visual verification. If implemented, it should be on the right side and shown when no filter is applied.

### Steps
1. Navigate to /tasks
2. Ensure no filters are active
3. Look for a "Customize Columns" button or icon on the right side

### Expected Result
A column customization control is visible on the right when no filter is applied.

### Pass Criteria
Control present and allows toggling column visibility.

### Fail Criteria
No customize columns option anywhere on the task page.

---

# Module O — Task Field Specification

**Items:** #39 from Batch 4

---

## TC-O-39 — Task Create/Edit Form Contains All Required Fields

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/tasks/page.tsx`  
**Schema:** `apps/api/prisma/schema.prisma` — model Task

### Field Checklist

| Field | Status | Notes |
|-------|--------|-------|
| Task Title | IMPLEMENTED | title field |
| Due Date and Time | IMPLEMENTED | dueDate with datetime picker |
| Repeat Task (toggle) | IMPLEMENTED | isRecurring boolean toggle |
| Repeat Frequency | IMPLEMENTED | recurrenceFrequency — only shown when Repeat Task ON |
| Task Description | IMPLEMENTED | description long text |
| Project | IMPLEMENTED | projectId link |
| Task Type | IMPLEMENTED | type dropdown |
| Reviewer | IMPLEMENTED | reviewerId person picker |
| Assigned By | IMPLEMENTED | assignedById person picker |
| Assigned To | IMPLEMENTED | assigneeIds — multiple people allowed |
| Priority | IMPLEMENTED | priority dropdown |
| Assigned Date | IMPLEMENTED | assignedDate date field |
| Time Spent | IMPLEMENTED | loggedHours time tracking |
| Drive Link | IMPLEMENTED | driveLink URL field |

### Steps
1. Navigate to /tasks
2. Click Add Task (or open existing task for editing)
3. Verify each field in the table above is present

### Expected Result
All 14 fields are present in the task create/edit form.

### Pass Criteria
All fields present; multiple assignees supported; Repeat Frequency only shown when Repeat Task is ON.

### Fail Criteria
Any field from the spec is missing; single-assignee only.

---

# Module P — Departments

**Items:** #32 from Batch 3

---

## TC-P-32 — Manager Label and Multiple Managers Support

**Status:** PARTIAL  
**Frontend:** `apps/web/src/app/(dashboard)/departments/page.tsx`  
**Note:** Column header correctly reads "Manager". However, form uses a single leaderId field — only ONE manager per department is supported. Spec requires multiple managers.

### Steps
1. Navigate to /departments
2. Observe the column header for the leader/manager
3. Open Add Department or Edit Department form
4. Check how many manager slots are available

### Expected Result
- Column header: "Manager" (not "Head or Leaders")
- The form allows adding MULTIPLE managers

### Pass Criteria
Label is "Manager"; multiple managers can be assigned.

### Fail Criteria
- "Head" or "Leaders" label used
- Only one manager slot available (currently the case)

---

# Module Q — Universal View Settings & Add Column

**Items:** #33, #34 from Batch 3 (TOP PRIORITY)

---

## TC-Q-33 — View Settings Panel on Every List

**Status:** NOT IMPLEMENTED (Partial)  
**Note:** A ViewSettingsPanel component exists and is imported in the projects page. However the full spec requires it on all lists (Clients, Projects, Tasks, Pipeline) with the complete set of options (Name, View type, Table settings, Sharing, Actions).

### Objective
Every board/list in CRM and PM gets a standardized View Settings panel.

### Steps
1. Navigate to /projects
2. Look for a View Settings button/panel
3. Click it and observe the options
4. Repeat for: /clients, /tasks, /pipeline

### Expected Result (for each list)
Panel shows:
- Name (rename the view)
- View type (List / Board)
- Table settings: Data, Filters, Sort by
- Sharing: Copy link, Manage sharing, Export
- Actions: Save changes, Reset to last save, Clone, Delete view

### Pass Criteria
Full panel present on all 4 list types.

### Fail Criteria
Panel absent on any list; or panel has only partial options.

---

## TC-Q-34 — Add Column "+" at End of Every Table

**Status:** NOT IMPLEMENTED (Partial)  
**Note:** Projects list has a "+" column control for toggling pre-defined visible columns. The spec requires clicking "+" to open a dropdown of ALL database fields for that entity.

### Steps
1. Navigate to /projects in list view
2. Scroll to the rightmost column of the table
3. Look for a "+" button at the end of the column headers
4. Click it

### Expected Result
- A dropdown opens listing ALL fields from the database for Projects
- Selecting a field adds it as a new column
- Repeat this test on: /clients, /tasks, /pipeline list view

### Pass Criteria
"+" present on all tables; dropdown shows all entity fields; columns can be dynamically added.

### Fail Criteria
No "+" button; or clicking "+" only shows a predefined column list; or absent on any table.

---

# Module R — Revenue Module

**Items:** #40-#49 from Batch 5

---

## TC-R-40 — Revenue Overview: Who Paid / Receivables / MRR

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/revenue/page.tsx`  
**Backend:** GET /api/revenue/overview

### Steps
1. Log in as SUPER_ADMIN
2. Navigate to /revenue
3. Observe the Revenue Overview dashboard

### Expected Result
The overview shows:
- Who paid this month
- Receivables for the month
- MRR (Monthly Recurring Revenue)

### Backend Verification
```
GET /api/revenue/overview
-- Should return: { totalRevenue, mrr, totalExpenses, netProfit, pendingInvoices, collectedThisMonth, trend }
```

### Pass Criteria
All three KPIs present and showing correct data.

### Fail Criteria
Any KPI missing; data not reflecting actual payments.

---

## TC-R-41 — Project Client Revenue: Advance / GST / Total Receivable

**Status:** PARTIAL  
**Note:** CRM Quotation to Contract to Invoice Draft to Payment flow is implemented. GST captured in quotations. Advance payment type needs verification in payment capture screen.

### Steps
1. Create a Project-type client via CRM
2. Move through pipeline to ACTIVE_PROJECT
3. Navigate to Revenue -> Contracts
4. Navigate to Revenue -> Payments and log a payment

### Expected Result
- Contract shows: Agreed Final Value, Payment Terms
- Invoice shows: GST component, total receivable
- Payment records: advance received, balance remaining

### Pass Criteria
Full revenue picture per project client visible.

### Fail Criteria
GST not captured; advance type not recorded; receivable not calculable.

---

## TC-R-42 — Monthly Retainer Capture: With/Without Tax

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/subscriptions/page.tsx`  
**Backend:** GET/POST /api/revenue/subscriptions

### Steps
1. Navigate to Revenue -> Subscriptions
2. Create or view a retainer subscription
3. Check that both "with tax" and "without tax" configurations can be set

### Expected Result
- Subscription record has tax configuration
- Monthly recurring amounts captured
- Payment history tracked month-over-month

### Pass Criteria
Both tax configurations supported; monthly receipts tracked.

### Fail Criteria
Tax configuration not available.

---

## TC-R-43 — Events Revenue + Vendor Expenses

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/expenses/page.tsx`  
**Backend:** GET/POST /api/revenue/expenses

### Steps
1. Navigate to Revenue -> Expenses
2. Log an expense against a project/event (vendor name, amount, date, category)
3. Add multiple vendor expenses to the same project

### Expected Result
- Expenses linked to a project
- Multiple vendor expenses per project
- Per-project total spend visible via P&L

### Pass Criteria
Multiple vendors per project; total spend per project visible.

### Fail Criteria
Only one expense per project; or expenses not linked to projects.

---

## TC-R-46 — All Revenue Module Tabs Present

**Status:** PARTIAL  
**Implemented:** Revenue Overview, Invoice Drafts, Contracts, Payments, Subscriptions, Expenses, Receivables, Invoices

### Steps
1. Log in as SUPER_ADMIN
2. Switch to Revenue module
3. Check the sidebar/navigation for all tabs

### Expected Result
Navigation shows: Revenue Overview, Contracts, Invoices, Invoice Drafts, Payments, Subscriptions, Receivables, Expenses

### Pass Criteria
All 8 tabs accessible in navigation.

### Fail Criteria
Any tab missing from navigation.

---

## TC-R-48 — Per-Project P&L

**Status:** IMPLEMENTED  
**Frontend:** `apps/web/src/app/(dashboard)/revenue/pnl/page.tsx`  
**Backend:** GET /api/revenue/pnl

### Steps
1. Navigate to Revenue -> P&L (/revenue/pnl)
2. Select a project/event with both revenue and expenses

### Expected Result
Per-project view showing: Total revenue received, Total expenses logged, Net P&L = Revenue - Expenses.

### Pass Criteria
P&L calculation accurate per project.

### Fail Criteria
P&L not available per project; or calculation incorrect.

---

## TC-R-49 — Revenue Module Permission-Gated

**Status:** IMPLEMENTED  
**Backend:** `apps/api/src/routes/revenue.ts` — All routes use authorize('SUPER_ADMIN', 'ADMIN')  
**Frontend:** `apps/web/src/lib/modules.ts` — module gating via canAccessModule()

### Steps
1. Log in as TEAM_MEMBER
2. Try to navigate to /revenue

### Expected Result
TEAM_MEMBER is redirected away. Revenue data is NOT visible.

### Backend Verification
```
GET /api/revenue/overview  (with TEAM_MEMBER token)
-- Should return 403 Forbidden
```

### Pass Criteria
TEAM_MEMBER cannot access Revenue; SUPER_ADMIN can.

### Fail Criteria
TEAM_MEMBER can view revenue data.

---

# Module S — Unified Client Entity

**Items:** #50 from Batch 6

---

## TC-S-50 — One Client Record Shared by CRM / PM / Revenue

**Status:** IMPLEMENTED  
**Schema:** `apps/api/prisma/schema.prisma` — Client model with relations to Lead, Project, and Revenue models

### Steps
1. Create a new lead in CRM (this creates a client)
2. Navigate to PM -> Clients
3. Verify the same client appears there

### Expected Result
Same client record visible in both CRM and PM. No separate "PM Client" and "CRM Client" records.

### Backend Verification
```
GET /api/clients  -- appears in PM
GET /api/crm/leads -- the linked lead/client appears in CRM
-- Both share the same clientId
```

### Pass Criteria
One client ID referenced by CRM leads, PM projects, and Revenue records.

### Fail Criteria
Different client records in CRM and PM; no shared entity.

---

# Step 5 — Production Verification

## PV-01 — Role-Based Authorization (Backend)

**Backend:** `apps/api/src/routes/projects.ts`, `tasks.ts`, `revenue.ts`, `crm.ts`

| Check | Command | Expected |
|-------|---------|----------|
| Revenue routes | GET /api/revenue/overview with TEAM_MEMBER token | 403 Forbidden |
| Project update | PUT /api/projects/:id with TEAM_MEMBER token | 403 Forbidden |
| Task creation | POST /api/tasks with TEAM_MEMBER not on project | 403 Forbidden |
| CRM pipeline | PUT /api/crm/leads/:id/stage with TEAM_MEMBER | 403 Forbidden |

---

## PV-02 — Organization Isolation (Multi-Tenancy)

| Check | Method |
|-------|--------|
| Client A cannot read Client B's projects | Login as org A user; try GET /api/projects with org B token |
| Revenue data isolated | Different org tokens return different data |
| Tasks isolated | TEAM_MEMBER of org A cannot see org B's tasks |

All queries must include: `where: { client: { organizationId: req.user.organizationId } }`

---

## PV-03 — Activity Logs

| Action | Expected Log |
|--------|-------------|
| Lead moves to ACTIVE_RETAINER | Activity: "moved stage to Active" |
| Task marked COMPLETED | Activity: "task completed" |
| Project edited | Activity: "project updated" |

```
GET /api/projects/:id  -- check activities array in response
GET /api/crm/leads/:id  -- check timeline/activity tab
```

---

## PV-04 — Partial Updates (No Field Overwrite)

| Check | How |
|-------|-----|
| Kanban drag updates only status | Drag project card; verify other fields unchanged |
| Task status update | PUT task with only { status: 'COMPLETED' } — other fields unchanged |
| CRM stage transition | Stage change must not overwrite dealValue |

```
PATCH /api/projects/:id { status: 'COMPLETED' }
-- Verify: name, endDate, budget, members all unchanged
```

---

## PV-05 — Idempotency / Duplicate Prevention

| Check | Method |
|-------|--------|
| Double-click stage change | Move lead to ACTIVE_RETAINER twice; only one Subscription created |
| Invoice Draft duplicate | Move same quote to draft twice; only one draft created |
| Task creation | Submit task form twice; only one task created |

---

## PV-06 — API Input Validation

| Route | Test |
|-------|------|
| POST /api/tasks | Missing required title -> 400 Bad Request |
| PUT /api/projects/:id/status | Invalid status enum -> 422 |
| POST /api/revenue/payments | Negative amount -> 400 |
| POST /api/crm/leads | Missing contactName -> 400 |

---

## PV-07 — Error Handling

| Scenario | Expected UI |
|----------|-------------|
| Network failure during save | Toast error message appears |
| 403 Forbidden response | User shown "No permission" message |
| 404 Not Found | Redirected or shown "Not found" |
| Validation error | Inline field error messages shown |

---

## PV-08 — Data Integrity

| Check | Method |
|-------|--------|
| Deleting client cascades to projects | Delete client -> verify its projects are also deleted |
| Deleting project cascades to tasks | Delete project -> verify tasks gone |
| Currency values use correct precision | Check P&L amounts -- no floating point errors |

---

# Step 6 — Regression Checklist

After any fix or deployment, run through this checklist:

## Authentication & Authorization
- [ ] Login works for all roles (SUPER_ADMIN, ADMIN, PROJECT_MANAGER, TEAM_MEMBER)
- [ ] Logout clears session
- [ ] TEAM_MEMBER cannot access Revenue module
- [ ] TEAM_MEMBER cannot drag project Kanban cards
- [ ] Backend returns 403 for unauthorized actions

## Dashboard
- [ ] Dashboard loads without errors
- [ ] Active Clients count is accurate
- [ ] Active Projects count is accurate
- [ ] Pending Tasks widget loads and shows correct tasks
- [ ] Dashboard stats API (GET /api/dashboard/stats) returns 200

## CRM Module
- [ ] Pipeline board loads
- [ ] Stage labels show correctly (Won & Closed, Lost & Closed, Project Completed)
- [ ] Stage transitions work (Outreach -> Meeting, etc.)
- [ ] Lost & Closed transition shows only Lost Reason dropdown
- [ ] Won & Closed -> Active is blocked without signed contract link
- [ ] Revenue record created on ACTIVE_RETAINER transition
- [ ] Kanban column collapse/expand works
- [ ] Kanban footer shows deal totals and weighted amounts
- [ ] Pipeline filter (search, stage, assignee) works

## Quotations
- [ ] New quotation can be created as Quotation or Proforma Invoice
- [ ] Accepted quotation shows "Move to Invoice Draft" button
- [ ] Invoice Draft is created on action

## Project Management
- [ ] Projects list loads
- [ ] View switcher works (List, Board, Calendar)
- [ ] Due Date filter works
- [ ] Project detail page loads
- [ ] Add Task button present
- [ ] Task filters work (Status, Assignee, Due Date)

## Tasks
- [ ] Task list loads for all roles
- [ ] TEAM_MEMBER sees only their tasks
- [ ] Task create form has all 14 required fields
- [ ] Multiple assignees can be selected
- [ ] Repeat Task toggle shows/hides Repeat Frequency
- [ ] Drive Link is validated as URL

## Revenue Module
- [ ] Revenue Overview loads with correct KPIs
- [ ] Contracts page loads
- [ ] Invoice Drafts page loads
- [ ] Invoice Draft edit works
- [ ] Generate PDF creates downloadable PDF
- [ ] Subscriptions page loads
- [ ] Expenses page loads and allows expense creation
- [ ] P&L page loads with per-project data
- [ ] TEAM_MEMBER gets 403 on all revenue API calls

## Clients (PM)
- [ ] Clients list loads
- [ ] Lifecycle Stage shown for PM module
- [ ] Filter: Status with Select All works
- [ ] Filter: Account Manager (no "All" prefix)
- [ ] Filter: Industries with Select All
- [ ] Client detail shows Company Details + Contacts sections
- [ ] Edit Client works
- [ ] Delete Client shows confirmation dialog
- [ ] Create Project from client detail works

## Departments
- [ ] Department list loads
- [ ] Column header shows "Manager" not "Head/Leaders"

## Mobile Responsiveness
- [ ] Dashboard readable on mobile
- [ ] Project list accessible on mobile
- [ ] Task form usable on mobile
- [ ] Pipeline Kanban scrollable on mobile

---

# Step 7 — Final Acceptance Checklist

To be signed off by the Team Lead before production release:

## Requirement Coverage
- [ ] All 65 requirements reviewed against codebase
- [ ] Implemented requirements verified in UI
- [ ] Partial implementations documented and accepted or tasked for completion
- [ ] Not-implemented items have tickets created (TC-M-26, TC-M-27, TC-Q-33, TC-Q-34)

## UI Verification
- [ ] Dashboard verified by QA
- [ ] CRM Pipeline (Board + List) verified by QA
- [ ] Quotations flow verified
- [ ] Invoice Draft flow verified
- [ ] Project list and detail verified
- [ ] Task list and form verified
- [ ] Client list and detail verified
- [ ] Revenue module tabs verified
- [ ] Departments page verified
- [ ] All filter labels follow convention (no "All" prefix)

## Backend Verification
- [ ] Role-based authorization tested via API (not just UI)
- [ ] Organization isolation confirmed
- [ ] Activity logging confirmed
- [ ] Partial update behavior confirmed (no field overwrite)
- [ ] Hard gates confirmed (Won & Closed -> Active requires signed contract)
- [ ] Revenue automation confirmed (retainer creates Subscription)

## Database Verification
- [ ] No orphaned records after cascading deletes
- [ ] Revenue records created on CRM transitions
- [ ] Task assignees stored correctly (multi-assignee)
- [ ] Lifecycle Stage updates on CRM stage change

## No Regression
- [ ] All role logins confirmed working
- [ ] Existing project edit screens unaffected by Kanban drag changes
- [ ] CRM transition forms preserved
- [ ] Revenue data accurate after any PM-side changes

## Production Readiness
- [ ] No console errors in production build
- [ ] No unhandled API errors
- [ ] All loading states handled
- [ ] All empty states handled
- [ ] No hardcoded test data visible to end users

---

# Module Verification Summary

| Module | Requirements | Implemented | Partial | Not Implemented | Completion |
|--------|-------------|-------------|---------|-----------------|-----------|
| A — Dashboard | 3 | 2 | 1 | 0 | 83% |
| B — Clients Filters | 6 | 4 | 2 | 0 | 78% |
| C — Client Detail | 5 | 3 | 2 | 0 | 76% |
| D — Lifecycle Stage | 2 | 1 | 1 | 0 | 75% |
| E — CRM Tabs | 1 | 0 | 1 | 0 | 50% |
| F — Pipeline Stages | 2 | 2 | 0 | 0 | 100% |
| G — Pipeline Fields | 3 | 2 | 1 | 0 | 83% |
| H — Stage Transitions | 5 | 3 | 2 | 0 | 80% |
| I — Won to Active Gate | 1 | 1 | 0 | 0 | 100% |
| J — Kanban View | 4 | 4 | 0 | 0 | 100% |
| K — Quotation Flow | 3 | 3 | 0 | 0 | 100% |
| L — Projects List | 3 | 2 | 1 | 0 | 83% |
| M — Project Detail | 6 | 2 | 2 | 2 | 50% |
| N — Tasks Section | 4 | 3 | 1 | 0 | 83% |
| O — Task Fields | 1 | 1 | 0 | 0 | 100% |
| P — Departments | 1 | 0 | 1 | 0 | 50% |
| Q — Universal Settings | 2 | 0 | 1 | 1 | 25% |
| R — Revenue Module | 7 | 4 | 3 | 0 | 79% |
| S — Unified Client | 1 | 1 | 0 | 0 | 100% |
| **TOTAL** | **60** | **38** | **19** | **3** | **78%** |

---

## Outstanding Items — Not Implemented (Require Dev Work)

| ID | Requirement | Priority |
|----|-------------|----------|
| TC-M-26 | Customize/Add Field option in Project Detail | Medium |
| TC-M-27 | Remove Milestones from Project Detail | High |
| TC-Q-33 | View Settings Panel on all lists | TOP PRIORITY |
| TC-Q-34 | Add Column "+" on every table | TOP PRIORITY |

## Outstanding Items — Partial (Require Verification or Fix)

| ID | Requirement | Issue |
|----|-------------|-------|
| TC-A-03 | Pending Tasks widget | Shows 7-day window, not all pending |
| TC-C-13 | Remove client name from Add Client form | Name field still in form state |
| TC-D-15 | CRM to PM Lifecycle Stage auto-sync | Bridge event not confirmed |
| TC-G-53 | LinkedIn field removed from Add Lead | UI form needs visual confirmation |
| TC-H-57 | Proposal to Negotiation: 14-day auto validity | Backend behavior not verified |
| TC-M-22 | No budget fields in project detail | budget field still in edit form |
| TC-P-32 | Multiple managers per department | Only single manager (leaderId) supported |

---

*Document generated by: Senior QA Lead / Solution Architect audit*  
*Based on: Codebase inspection of apps/api/ and apps/web/ as of 2026-07-13*  
*Spec reference: Flowzen_Corrections_Running.md Batches 1-6 (Items 1-65) and Flowzen_Developer_Note_20260711.md*
