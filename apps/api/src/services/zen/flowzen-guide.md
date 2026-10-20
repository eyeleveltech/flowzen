# How Flowzen works

Flowzen is the app EyeLevel Growth Studio runs on: selling, delivering retainers and projects, billing, costs and the team. This guide describes the app as it is built today. Screen names, buttons and labels are given in the words the screen uses. Links are app addresses; give them as Markdown links, e.g. [Money → Billing](/money?tab=billing).

## Who can do what

Everybody has a preset, plus any extra permissions ticked for them in Team → Access & permissions.

- **Employee:** their own work only.
- **Department head (Head):** own work, their team's work, all work, paid/unpaid status (no amounts), entering costs, issuing equipment.
- **Business development (BD):** own work, companies (read and edit), pipeline and proposals (read and edit), paid/unpaid status.
- **Accounts:** own work, companies (read), paid/unpaid status, money figures, entering costs.
- **Management:** everything, including Setup and reports. Management (and anyone with Setup access) passes every permission check.

The permissions behind the screens:
- **Team work:** opens Team, and lets a person assign others.
- **All work:** opens All tasks, Live work, projects and retainers.
- **Money figures:** shows amounts, costs and profit. Without it, figures read "Hidden" or "—", never ₹0.
- **Reports:** opens the Monday brief and the Forecast.
- **Setup:** opens Settings.

A person who types the address of a screen they cannot open is sent away from it.

**Department heads see their own departments.** A Head sees the people of the departments they lead (set in Settings → Departments) and the tasks any of those people are on, plus tasks the Head created or asked for. Management sees everyone. A Head who leads no department still sees everyone until given one. This applies to Team, All tasks, the calendar's Team tasks, editing other people's tasks and events, team alerts and confirming the time split. It does not apply to assigning (a Head can give work to anyone), to client work (projects, retainers, Live work), to the Approvals report, events or assets.

**Salaries** (a person's monthly cost) are visible only to Setup access. An admin sets it on Team → the person's menu → Edit → "Monthly cost to the company". Heads and Accounts see time-split percentages; Accounts also see combined "People cost" figures on Money.

### Writing a proposal (/quotations/{id})

The proposal itself, written in Flowzen, by hand or with the AI.
- **Starting:** "Write with AI", "Start blank" or "Start from a proforma". All give the standard sections with the studio terms filled in. From a proforma, its lines go on the Pricing tab and its terms into Terms (the proforma is not changed). A price already logged by hand on the deal comes across as one line marked "price from v1".
- **Document tab, Sections:** the sections (cover line, about us, what we heard, scope, timeline, investment, terms, next steps). Hide a section with the eye, reorder with the arrows, add your own. It saves itself; the preview beside it follows. A line starting "- " is a bullet; a single line right above bullets prints as their bold lead-in.
- **Document tab, Write with AI:** ask in plain words ("write the first draft", "shorter intro", "more premium tone"). It knows the client record, the services on the Pricing tab and the studio terms, and suggests changes as cards to Accept or Discard; nothing changes until accepted. It never writes prices, uses Zen's AI setup (Settings → Zen assistant), and leaves what it does not know as a yellow "Needs input", which stops Finalise until filled. For Management it can also put a price you typed on the Pricing tab ("Add to Pricing").
- **Layout:** Minimal (most proposals), Premium (larger deals: full green cover, numbered sections) or Compact (one page, no cover). Changing it never rewrites a word.
- **Prices never go in the text.** The Investment section is drawn from the Pricing tab. A rupee amount typed into the text that no line backs stops Finalise.
- **Pricing tab (Management only):** the services, each Monthly fee, One-time fee, or Paid by client directly (ad spend: shown apart, not in the fee, not taxed). Pick from the service list or type a line. Totals come with GST by the client's state. Monthly and one-time are never added together.
- **Floor:** a monthly fee below the floor for the client's industry (Setup → Services & pricing) needs Management to record why (20 characters or more) before Finalise. One-time fees have no floor.
- **Discounts** need what the client gives in return (a longer term, case-study rights).
- **Investment box:** the fee before GST and "18% GST additional", never a GST-inclusive total (the Pricing tab still shows the GST working).
- **Where a rate comes from** (shown under each line): typed, the service list, the rate agreed with this client, a past proposal, or carried over from an earlier price. Under each line, Management also sees what earlier final proposals charged for the same service ("Charged before"), used only with "Use this rate". "Keep … as <client>'s agreed rate" saves a line's rate as that client's agreed rate.
- **How the one-time fee is paid:** on the Pricing tab, a split such as 50/50 or 40/30/30 (whole percentages adding to 100). It prints under the one-time fee and becomes the project's milestones when the deal is won.
- **Send for review:** the writer hands a draft to Management; it shows as In review, the writer can no longer change it, and Management gets a bell. Management prices it and finalises, or uses "Send back" with a note that shows at the top of the draft.
- **Finalise (Management):** checks all of the above, that no shown section is empty and that nothing still needs input, then locks the version, freezes its prices and keeps its PDF and Word file exactly as they were.
- **Downloads:** PDF and Word, for any version. A draft's carry a DRAFT mark.
- **Who sees prices:** Management always. Anyone else sees a draft without its figures ("Pricing is added by Management"), and the final version in full, since it goes to the client.
- **Versions:** "New version" copies the text and prices into a new draft (one open draft or review at a time). Open an older version and press New version to bring it back.
- **Compare versions** (Versions tab): any two versions side by side. The price changes at the top (Management, or between two finals), then each section with removed words struck out and added words highlighted; a rewritten section shows old above new.
- **When the deal is won:** "Set up work" opens the retainer or project form already filled in from the won proposal: for a retainer, the monthly fee, GST and each monthly service as a project on the retainer (untick any); for a project, the one-time fee, GST, the proposal's title and its payment split as the milestones. Nothing is created until someone presses Create. The reference is EL/PR/<year>/<number>-v<n>, e.g. EL/PR/2026-27/014-v2.
- **Mark as sent:** a final version goes on the pipeline as a sent version, at its monthly fee for a retainer or its one-time fee for a project. First one moves the deal to Proposal sent, later ones to In negotiation. Next step optional.

## Links to records

Every row a lookup returns carries a `link` (and some a `clientLink`): use it exactly as given. These are the same addresses, for an id you already have — from the page they are on, say:
- client: /companies/{id} (add ?tab=PROPOSALS, WORK, MONEY or AUDIT for a tab)
- proposal document: /quotations/{proposalId} (add ?doc={documentId} for one version)
- one-time project: /projects/{id} (?tab=milestones, tasks, costs, people or activity)
- retainer: /retainers/{id}?month=YYYY-MM (&tab=projects, costs, allocations, invoice or billing)
- retainer project: /retainers/{retainerId}/projects/{projectId}
- internal project: /internal-projects/{id}
- task: /my-work?task={id}
- asset: /assets/{id}
- calendar event: /calendar?event={id}

## My Work (/my-work)

Everybody's own list: every task they are on, as lead or helper. Cancelled and deleted tasks are not shown.

- **Follow-ups** (only for someone with any): their own open deals and active leads whose next step is due today, overdue (red), or tomorrow — the next step, the client, the date, and "Log touch". There is no bell for an overdue next step; this is where the owner sees it.

- **Tiles:** "Due Today" (with how many are on hold), "Overdue" (with how long the oldest has been open), "Rest of the week" (the next 7 days, today excluded), "Your average close".
- **Groups, in order:**
  1. **Overdue:** due before today, not Done, not In review.
  2. **Due today**.
  3. **Later this week:** includes anything due later.
  4. **Waiting for approval:** In review, longest waiting first.
  5. **Done this week**.
- **Arranging:** a person can drag tasks into their own order within the first three groups. New tasks land at the top.
- **Group by:** "When" (the groups above, the default) or "Project or retainer" (the work still to do, under the retainer, project or internal project it belongs to, with "Internal — no project" for one-off studio jobs). Groups fold open and shut and show a count. The choice is remembered in that browser. Dragging works in "When" only.
- **On each row:** change the due date (click the date) and the status (To do, In progress, On hold, Done, Cancelled). Clicking the task opens its drawer: details, the approval block, Edit and Delete.
- **Approver panels:** approvers also see "Waiting for your approval" (with Approve and Request changes) and "Sent back — add your changes".
- **"Task for myself"** creates a task.
- **Opening one task:** /my-work?task={id} opens that task. If it is not on the person's own list, it opens as an approval view.

## Calendar (/calendar)

Everybody. What is on when, as layers that can be switched on and off.

- **Layers:**
  - **For everyone:** My tasks, Meetings & shoots, Equipment and Holidays.
  - **Google busy:** when Settings → Integrations has Google Calendar on.
  - **Team tasks:** Team work. A Head sees their departments.
  - **Money:** invoices due, and proformas' "valid till". Amounts appear only with money figures.
  - **Sales:** outreach follow-ups.
  - **Work:** project starts and ends, and retainer renewals.
- **Views:** Week, Month and Schedule (a 30-day list).
- **"Search for people":** shows one person's meetings, busy time and tasks. "Just me" shows only events you are on.
- **"Create":** a Task, or an Event (Kind: Meeting, Shoot or Other) with time, place, people, client, project or retainer, client contacts, and (for a shoot) gear to reserve. Press "Book it".
- **Clash warnings:** clashes with other events, gear that is reserved, out, held or in repair, and people busy in Google. Warnings never block saving.
- **Dragging:**
  - A task moves its due date.
  - An event moves, keeping its length.
- **Who can change or cancel an event:** whoever booked it, Management, or the head of somebody on it. Cancelling releases its gear.
- **What people on an event are told:** they are emailed and get a bell alert when it is booked, moved, re-located or cancelled, and on the morning of the event. Changing only the title, notes, gear or client tells nobody.

## Team (/members)

Team work (Heads and Management). The Team tab is the delivery view; the Approvals tab is at /members?tab=approvals.

- **Scope line:** a Head sees a line such as "Showing Video (12 people). Management sees everyone."
- **Tiles:**
  - "People".
  - "Open Tasks": all open tasks — not Done, Cancelled or In review — whatever the note under it says.
  - "Overdue".
  - "Waiting on Clients": every On hold task.
- **"Delivery" table:** each person's Open, Overdue, Waiting and "Avg close". "List" or "By department". Export CSV.
- **Row menu:** Edit details, Assign a task, Kit they hold, Access & permissions, Send a password link (valid 60 minutes), Switch off account. All but "Assign a task" and "Kit they hold" need Setup access.
- **Invite** (Setup access): name, email, department, access preset. The invite link is shown and emailed.
- **Opening a person:** shows their tasks grouped by state, each linked to its project or retainer month.
- **Board** is no longer a tab here: it became **My department** (/my-department), and an old /members?tab=board link goes there.
- **Approvals tab:**
  - For the last 7 or 30 days: what is waiting now, typical decision time, how many were decided on time, escalations, and each approver's record.
  - It covers the whole studio.

## My department (/my-department)

A department head's page for their department: their people and everything those people are working on. It is in the sidebar only for somebody who heads a department. A head of several departments switches between them at the top. Management is not given it in the sidebar; they open any department's page from Settings → Departments with "Open department page" (/my-department?department={id}). Nobody else can open it, and a head cannot open another department's page. A head sees only their own people.

- **Header:** the department, how many people, its head, and **Needs attention**: overdue tasks, tasks on hold more than 3 working days, tasks stuck in review past the approval reminder time, urgent tasks not started, gear overdue back, and — from the 25th of the month — anybody whose time split for the month is not confirmed. Each item opens what it is about.
- **People tab** (/my-department?tab=people): one card per person — name, designation, phone and email (tap to call or mail); **Working on now** (the task they said they are on: each person sets it themselves with "Working on this now" on one of their own open tasks on My Work or in the task, which moves a To do task to In progress; one at a time; it clears itself when the task is done, cancelled, sent for approval or put on hold, or when they press Clear; a head cannot set it for them; no time is kept or shown) and **Next up** (the top of their own My Work order); counts of Open, Overdue, Waiting, In review and Done this week; today's meetings and shoots; and the gear they hold. **Assign** on a card opens the new-task form with that person filled in.
  - **Clicking a card** opens the person panel: their tasks grouped Overdue, Today, This week, Later, Waiting and In review; the clients and projects they are on; their week (task deadlines, meetings and shoots, Google busy time); the gear they hold and what is reserved for them; and this month's time split as percentages. Opening a task there lets the head reassign it or move its due date.
- **Work tab** (/my-department?tab=work): the client work the department's people are on, by client and then each retainer or project — who from the department is on it, open and overdue tasks, and the next deadline — and the department's own internal projects with owner, people, % done, target date or days left, and open and overdue tasks. Every row opens its page.
- **Calendar tab** (/my-department?tab=calendar): a week view with only the department's people — their meetings and shoots, task deadlines, holidays, and Google busy time (shown as "Busy" with the person's name, never the title). Narrow it to one person.
- **Approvals tab** (/my-department?tab=approvals): the team's tasks in review (how long they have waited, the round, the link) and changes requested on the team's work in the last two weeks. If the head approves that task type — or is its escalation contact and the round has escalated — Approve and Request changes are on the row. Nobody can approve a task they are on.
- **Equipment tab** (/my-department?tab=equipment): gear out on booking with the team and its due-back date (red once overdue), gear they hold long-term, and gear reserved for the team's coming meetings and shoots, with clash warnings.
- **Time split tab** (/my-department?tab=time-split): this month's split per person as percentages (never money, even for an admin), confirmed or not, with Edit and Confirm for each person and "Confirm all". A closed month cannot be changed.
- **Not here:** rankings, scores, timers, "overloaded" labels and salaries.

## All tasks (/all-work)

All work (Heads and Management; a Head sees their departments' work).

- **Filters:** search, Person, Department, Client (including "Internal", and "Internal — no project" for internal tasks filed under no project), Project, Type of work (including "Not set"), Status and "Overdue only". Status starts on "Unfinished" (To do, In progress, In review, On hold). /all-work?noProject=1 opens on "Internal — no project".
- **Group by:** None (the default), Project or retainer, Client, Person, Department, or Due (Overdue, Today, This week, Later, Earlier). Each group folds open and shut and shows a count; the filters still apply inside. A task with two people is under both in Person and Department. The choice is remembered in that browser. Grouping is of the tasks shown, so past the 500-task limit it says so.
- **Tiles:** "Open" (To do + In progress), "Overdue", "On hold" and "Nobody on it".
- **Sorting:** click a column header.
- **Limits:** the list shows up to 500 tasks, and Export CSV gives up to 5,000.
- **No create button here.**

## Companies (/companies)

Companies access (BD, Accounts, Management). Real companies; outreach leads are kept separately.

- **Tabs:** Client, Prospect, Past and All.
- **Tiles:**
  - Clients.
  - Prospects.
  - In the Outreach List.
  - "Contracted Monthly": active retainers' monthly value.
- **"What's happening":** a one-line summary per company, e.g. "Retainer renewal approaching in N days."
- **Adding companies:** there is no button to add a company. Companies come from promoting an outreach lead.
- **A company page has tabs:**
  - **Overview & People:**
    - Contacts, with roles Approver, Payer and Contact; add them with "Add Person".
    - Active retainer and live projects.
    - Company details.
  - **Work:**
    - Retainers ("Add retainer") and projects ("Add project"). Both only for a Client.
    - Sample work ("Add sample").
    - Follow-ups ("Schedule follow-up", which creates a task for that person).
  - **Proposals:** "New proposal", and every proposal with its versions.
  - **Invoices & Proformas:** proformas (Edit and Cancel while unpaid; Download; Email) and tax invoices.
  - **Audit Trail:** the history of the company and everything under it.
- **Statuses:** Prospect, Client and Past.
  - Promoting a lead makes a Prospect.
  - Winning a proposal makes a Client.
  - Every hour, a Prospect or Client with no active retainer, no live project and no activity for 90 days is moved to Past.
- **"Remove":**
  - "Make them a past client" keeps everything.
  - "Delete permanently" is Setup access only. You must type the name. It is refused if any invoice has been paid, and the company does not go to Trash.

## Outreach list (/outreach)

Companies access. Cold names, before they are companies.

- **Status tabs:** All, Not contacted, Follow up, Meeting, Interested, Dead. A link can carry ?status=.
- **New lead:** a name, plus a phone or an email, then "Add to the list". Import CSV checks the file first, then adds the names.
- **Changing status:**
  - Follow up, Meeting and Interested are "active". Follow up needs a call-back date and remarks; Meeting needs its date; Interested needs neither. Each can also carry a **next step** (a few words) — optional. A date can't be in the past.
  - Not contacted and Dead need neither; moving to them clears the next step.
  - The next step and its date show under the name, red once the date has passed, and the date appears on the Calendar's Sales layer. It creates no task and no alert.
  - An active lead with no next step shows a "No next step" badge, and the "Missing next step" filter lists them. Nothing refuses a save without one.
- **Last touch:** the last real contact — a logged touch, a status change, or a date set by hand. Editing a phone number is not contact. Each active lead shows "Last contact Nd ago"; with none recorded it counts from the day the lead was added.
- **Going stale:** an active lead whose last touch is more than 10 days ago (Settings → Pipeline → Going stale). The banner says how many.
- **Log touch** (row button or menu): how (Call, WhatsApp, Email, Meeting, Other) and a short note, both required, plus the next step and date if there is one. It moves the last touch to now and is in the lead's history.
- **Set last contact date** (row menu, or tick several rows): for correcting the record — imported names carry the import date. A date, not in the future. The CSV import also reads an optional "Last contacted" column.
- **Delete:** goes to Trash.
- **Becoming a company:** see "Lead to client" below. Only an Interested lead can be promoted.

## Pipeline (/pipeline)

Pipeline access (BD, Management). The "Sales pipeline" board.

- **Columns:**
  1. Prospect
  2. Proposal Sent
  3. In Negotiation
  4. Proforma Issued / Contract Sent
  5. Verbal Yes
  6. Won
  7. Lost
- **Where a deal sits:** decided by what has happened to it, not by hand. Dragging a card opens the real step:
  - In Negotiation → Add version
  - Proforma Issued → Raise proforma
  - Verbal Yes → Flag verbal yes, only from Proforma Issued
  - Won → Mark won
  - Lost → Mark lost
  - Backward moves are refused, and Lost is final.
- **Each card:** value, retainer or one-time, owner, days since the last touch (amber once going stale), the next step and its date (red when overdue, a "No next step" badge when missing), and "N% likely". Click "N% likely" to override this deal's probability.
- **Next step:** an open deal (no outcome) can carry a short next step and a date. It is optional everywhere — a new proposal, a version, a proforma, verbal yes, an edit, Log touch — and a deal without one shows "No next step". A next step date can't be in the past.
- **Last touch:** the latest of a logged touch, a version sent, a stage change or a proforma raised, or a date set by hand. Owner, probability and correction edits don't count. With none recorded, it falls back to when the deal entered its stage.
- **Card menu (⋯):** Log touch (how and a note; the next step if there is one), Set next step, Set last contact date. The client's Proposals tab has the same buttons on each open deal.
- **Tiles:**
  - "Live Deals" and "Full Pipeline" count every card not in Won, so lost deals are included.
  - "Going Stale": open deals whose last touch is more than 25 days ago (Settings → Pipeline → Going stale).
  - "Weighted": each deal's value × its probability.
- **Won card:** offers "Set up the retainer →" or "Create the project →" until the work exists.
- **"Stage to stage":** conversion rates over 6 months.

## Proposals (/quotations)

Pipeline access. Every proposal and proforma.
- **Deal values are Management's** (anyone with the money figures permission). BD see every deal on the Pipeline, here and on the client's Proposals tab without its value: no Full pipeline or Weighted tiles, no value column, no figure on the card. They cannot change a value either. Proforma amounts are unchanged.

- **Tabs:** Live, Closed, Proformas, and Deleted (with Restore).
- **Tiles:**
  - Live Proposals.
  - Value Out There.
  - "Given Away This Year": the first quote minus the won value. It is not actually limited to this year.
  - Proformas Unpaid.
- **"+ New":** starts a proposal.
- **Day-to-day work:** versions, proformas, winning and losing happen on the company's Proposals tab or the Pipeline.
- **The proposal document:** under each client's name, "Write the proposal" (or "Proposal v2 · draft") opens /quotations/{id}. See "Writing a proposal" below.
- **Proformas:**
  - Statuses: Unpaid, Paid, Cancelled.
  - A proforma becomes Paid by itself when the tax invoice raised from it is fully paid.
  - Nothing marks a proforma Expired. One past its "valid till" stays Unpaid and raises an alert.
  - Only an unpaid proforma can be edited.

## Live work (/live-work)

All work (Heads and Management). Everything being delivered.

- **Tabs:** retainers, projects, sample and internal. A link can carry ?tab=.
- **Tiles:**
  - Live Retainers (with how many have no contract).
  - Live Projects.
  - One Time In Flight: quoted value of live paid projects.
  - At Risk: retainers with no term or renewing within 45 days, plus flagged projects.
- **Retainers:** active ones, with this month's tasks done and late, most late first.
- **Projects:** On track, Over estimate, Behind schedule, Flagged, Delivered, Cancelled.
- **Internal tab:**
  - A pinned card first, **"General — no project"**: open and overdue internal tasks filed under no project. Clicking it opens All tasks on "Internal — no project".
  - Then one row per internal project: name, department, owner, the people with open tasks in it, a progress bar (% done), the target date or "N days left" / "Overdue by N days" (red), and open and overdue counts.
  - Filters: department and status (Active, Done, All). Sort: target date (the default; no date last), progress, or name.
- **"+ New internal project":** creates studio work with no client and no money: name, owner, department, start date, target date and a description — all but the name optional.
- **An internal project's page** (/internal-projects/{id}): its dates and days left, department, owner, % done, open and overdue counts, the next task due, "People on this" (everyone with open tasks in it, with their counts), its tasks, and Edit (name, owner, department, dates, description), Mark done / Reopen and New task.
- **Retainers and projects are not created automatically.** Winning a deal does not create them; somebody sets them up.

## Monday brief (/brief)

Reports access (Management). The week on one page.

- **Summary:** written by AI at 07:00 on Monday, from counts and amounts only, never staff names. "Write summary" or "Regenerate" are allowed at most every 10 minutes, and need the AI key in Settings.
- **Last week (Monday–Sunday), against the week before, with an 8-week line:**
  - Cash collected
  - Invoiced
  - Deals won
  - Proposals sent (revisions included)
  - Tasks done (% on time)
  - One Approvals tile per approver group
  - Clicking a tile lists what is behind it.
- **Current week only:**
  - **"Needs your action":** open alerts grouped as Money to collect, Sales follow-ups, Billing to do, and Stuck approvals.
  - **"This week":** invoices due, projects ending, shoots and meetings, renewals.
  - **"Risks":** delivery and client risks.
  - **"Team by department":** counts only, nobody named.
  - **"Not using Flowzen":** Management only.
- **Past weeks:** ?week=YYYY-MM-DD (a Monday, up to 26 weeks back).
- **Email:** Monday after 07:00, to everyone with reports access.

## Money (/money)

Money figures (Accounts and Management).

- **"Figures for"** picks the period: this month, last month, this quarter, this financial year (the default), last financial year, or all time.
- **Tiles** (worked out on the server over every invoice; all include GST):
  - Billed: invoices raised in the period, cancelled ones left out.
  - Collected: payments received in the period.
  - Outstanding today: what is owed now, on every invoice, whatever the period.
  - Overdue today: the part of that past its due date, in rupees, with a count.
- **Header buttons:** Export invoices CSV, Export costs CSV, "+ New invoice". "+ New invoice" records a tax invoice already raised in Tally. It offers to link the client's live proforma and, for a project, the milestone it settles.
- **Tabs** (the tab is in the address: /money?tab=invoices, billing, costs or profit):
  - **Invoices:**
    - A page of 50 at a time; filter by Still owed, Overdue, Paid or Cancelled. Amounts include GST.
    - Statuses: Raised, Part-paid (some money in), Overdue (due before today, by the studio's calendar), Paid, Cancelled. The same badge shows on a client's tab and a project's invoices.
    - Row actions: "Record payment", "Prepare document", PDF and Email. PDF and Email need the seller's GSTIN, address and state.
  - **Billing** (/money?tab=billing):
    - Retainers: every retainer month waiting for a proforma, an invoice or a payment, plus "Earlier months, still owed". "Raise all proformas" raises every waiting month at once. Its line shows what is owed on invoices (incl. GST) and the fees not invoiced yet (before GST) separately — never added together.
    - **Project milestones:** each project's next milestone to bill, and every milestone with a proforma or invoice out, with "Raise proforma", "Record invoice" or "Record payment". Accounts can bill projects here without access to the project page. A milestone can have only one invoice.
  - **Costs:** every cost, newest first, with its date and "Paid by"; "+ Record a cost"; "Confirm draft" on recurring copies.
  - **Profit & Costs** (pick a month):
    - Tiles: Revenue (retainer fees + project invoices raised that month, before GST), Direct + people cost (client costs + the whole payroll), Overheads (company costs, salary-like ones left out), and "Company profit".
    - "Profit by client": retainers.
    - "Profit by project": each job's whole contract.
    - Company costs for the month, with a total of what counts as overheads.
    - Capital and loans: listed with a total, not subtracted from profit.
    - A section that fails to load says so; it never shows ₹0.

## Forecast (/forecast)

Reports access (Management). The next 3 months of cash.

- **Tiles:**
  - Current MRR: active retainers' monthly value.
  - Monthly Payroll.
  - MRR − Payroll.
  - Active Deals.
- **A card per month:**
  - Inflows: Retainers, Projects (milestones due), Deal assumed won, Cash in, and Pipeline (weighted).
  - Outflows: Payroll, Vendor & Direct.
  - Net Cash Flow, and "Cash Kept %".
- **"What if this deal closes?":** adds one open deal to the months.

## Assets (/assets)

Everybody can see the equipment register.

- **Who can do what:**
  - Issue equipment permission (Heads; anyone with Setup access): handing kit over, entering it and retiring it.
  - Money figures: prices and book value.
- **Tiles:**
  - On the register: everything, retired included.
  - Out now: checkouts, with how many are past due.
  - In repair.
  - Book value.
- **Tabs:** All, Out now, In repair and Retired.
- **"Enter kit":**
  - It gets a tag such as EL/CAM/001. Tags are never reused.
  - It can also record a capital cost in Money.
  - "Import" takes a CSV.
  - There is no screen to edit an item afterwards.
- **On an item:**
  - Check out (for a shoot, with a due-back date)
  - Assign (long-term, never overdue)
  - Check in (choosing Damaged sends it to repair)
  - Hand on
  - Repair / Back from repair
  - Retire (Written off, Sold, or Lost or stolen)
  - Remove (to Trash)
  - Retire, repair and remove are refused while it is out.
- **"Chain of custody":** every holder and the condition the kit went out and came back in.

## Time split (/allocations)

Enter costs (Heads, Accounts, Management). How each person's month divides across clients and projects. It turns salaries into people cost on retainers and projects.

- **How the split is made:**
  - From the 25th, each person's split is proposed from that month's completed tasks: the share of their finished retainer and project tasks that went to each piece of work.
  - Unconfirmed rows are re-proposed hourly.
- **"Edit":** change a person's percentages. Saving puts a confirmed person back to Pending.
- **"Confirm":**
  - Heads confirm only people in their departments.
  - Accounts and Management confirm anyone.
- **"Total %":** red over 100, green at 100.
- **Admin-only figures:** Monthly cost and Total Payroll.

## Setup (/settings)

Setup access (Management). The sidebar calls it Setup; the page is Settings. A panel on the left lists the tabs in five groups: Agency (General, Working calendar), Sales & money (Pipeline, Services & pricing, Documents & billing, Tax & numbering), People & work (Team, Departments, Approvals, Onboarding, Assets), AI & connections (Zen assistant, Email, Integrations) and Records (Activity, Usage, Trash). A link opens a tab: /settings?tab=<key>, where the key is organisation, calendar, pipeline, pricing, proforma, documents, team, departments, approvals, onboarding, assets, zen, email, integrations, activity, usage or trash. Without one it opens on General.

### Settings → General

- **Who you are:** name, website, phone, address.
- **Signing in:** "Password sign-in" switch (turn off only once everyone signs in with Google Workspace), and "Outgoing email", which opens the Email tab.

### Settings → Working calendar

Day start and end (default 10:00–19:00), days worked (default Monday–Saturday) and public holidays.

### Settings → Pipeline

- **Stage probabilities:** Proposal sent 30%, In negotiation 60%, Proforma issued 85%, Verbal yes 90%.
- **Going stale:** days since the last real contact before a deal (default 25) or an outreach lead (default 10) counts as going stale.

### Settings → Zen assistant

- **Provider and key:** provider, key and model. The same AI writes proposals ("Write with AI").
- **What Zen remembers:** each saved preference, with "Forget this".

### Settings → Tax & numbering

- **Tax identity:** State and GSTIN.
- **Numbering:** Prefix (default EL/PI) and "Financial year starts" (default April).
- **Dates and money:** timezone and currency.
- Without a state, quotations and invoices cannot work out tax.

### Settings → Documents & billing

- **Who is issuing the document:** registered name, PAN, declaration and signature.
- **Sender details:** contact email, default payment terms, and "Valid for (days)" for proformas (default 30).
- **Terms & conditions.**
- **HSN / SAC codes.**
- **Bank details.**

### Settings → Services & pricing

Management only.
- **Pricing floors:** the lowest monthly fee a proposal may quote: one for any client (₹75,000), and higher ones for chosen industries (Real Estate & Infrastructure ₹2,00,000, Healthcare & Wellness ₹1,50,000 to begin with).
- **Services:** what the studio sells, billed monthly or one-time, with a standard rate. The Pricing tab picks from this list. Retire one with the toggle; it stays on old proposals.
- **Agreed client rates:** a rate agreed with one client for one service (a partner rate, a renewal price), from a date and optionally until one. A proposal for that client uses it before the standard rate while it holds. "End it" stops it today.

### Settings → Email

The mail server (server, port, username, password), and the from name and address. Use "Send a test to me" to check it. Without it, Flowzen hands over links to pass on instead. The 08:00 digest, approval chasers and calendar emails need it.

### Settings → Integrations

The "Google Calendar connection" switch. When it is on, people connect from Profile:
- Busy time syncs every 15 minutes; others see only "Busy".
- Meetings and shoots are written into a "Flowzen" calendar in the person's Google.

The "Phone notifications" switch. When it is on, people turn them on from Profile → Phone notifications. When it is off, nothing is sent and the Profile card is hidden. Each switch shows only when the server has its keys.

### Settings → Team

A read-only list of who is here. Inviting and access happen on Team.

### Settings → Departments

- **Departments:** add, rename and reorder them.
- **Heads:** set a head. Only people with Department head or Management access can be one. The head gets "My department" in their sidebar.
- **Open department page** (Management): opens that department's My department page (/my-department?department={id}).
- **People:** move people between departments.
- **Merge and archive:** merge one department into another. A department can be archived only when it is empty; archived ones can be restored.
- **Notes on the tab:**
  - anyone with no department;
  - departments with no head;
  - people with Department head access who lead no department, and so still see everyone.

### Settings → Approvals

- **Chasing a stuck approval:** "Remind after" (default 2 hours) and "Escalate after" (default 4 hours), in working time.
- **Who approves:**
  - "Approvers for all work" (any one is enough) and "Escalate to".
  - With no approvers, no task can be ticked "Needs approval".

### Settings → Assets

- **Tag prefix:** default EL.
- **How long each kind of kit is written off over.**
- **Fixed-asset schedule:** by financial year, with CSV. It needs money figures and Issue equipment.

### Settings → Onboarding

A "Won checklist" form. It does not work today: the checklist is not saved, and no tasks are created when a deal is won. Say so if asked.

### Settings → Trash

Restore removed proposals, projects, outreach leads, costs and assets. Some sections need extra access. Deleted tasks are not in Trash; deleting a task is final.

### Settings → Activity

Everything that happened: filter by who, area and dates. Zen's questions are logged here too.

### Settings → Usage

Management only. For 7 or 30 days:
- who opened Flowzen, last active, days active, changes and top screens;
- amber after 3 working days away.

Records are kept 90 days.

## Profile (/profile)

Everybody:
- edit their name, job title and phone;
- see the kit they hold;
- connect Google Calendar;
- turn on phone notifications (below);
- see their account details;
- change their password (at least 8 characters; this signs them out everywhere).

Email, department and access are changed by an admin on Team.

### Profile → Phone notifications

Shown only when Settings → Integrations has it on. Per person and per device:
- **Turn on** asks the browser's permission, then lists the device. **Remove** takes a device off; **Send a test** checks it.
- **Android:** works in Chrome.
- **iPhone (iOS 16.4 or later):** works only when Flowzen is on the Home Screen. Tap Share → Add to Home Screen, open Flowzen from there, then turn this on. In a Safari tab the card shows these steps instead of the button.
- **Blocked:** if the browser's permission was refused, allow notifications for Flowzen in the browser's site settings, then turn it on again.
- **What is sent**, each its own switch: Approvals (on), Calendar (on), My tasks (on), Everything in my bell (off — it can be a lot).
  - Approvals: work waiting for you to approve, its 2-hour reminder and escalation, and approved / changes requested on work you sent.
  - Calendar: you were booked, moved, removed or cancelled, and the morning of a meeting or shoot.
  - My tasks: a task someone else gave you, or whose due date they changed.
- **Never** about something you did yourself. One event is one notification.
- **Working hours only.** Anything outside them, or on a holiday, waits for the next working morning. More than 3 waiting become one "You have N updates in Flowzen" that opens the bell. At most 20 an hour.
- **Lock screen:** a title and one line, never a money figure. Tapping opens the page it is about.

# How to do the main jobs

## Lead to client
1. [Outreach list](/outreach) → "New lead" → a name and a phone or email → "Add to the list".
2. Work it with the status: Follow up (a call-back date and remarks) or Meeting (its date), with a next step if you have one. After each call or message, "Log touch".
3. When they want a quote, press "Mark interested" and say what happens next.
4. Press "Promote to company", check the details, then "Promote". A matching phone or email blocks a duplicate.
5. It is now a Prospect in [Companies](/companies). It becomes a Client only when a proposal is won.

## Proposal to work
1. Open the company → Proposals → "New proposal". Choose the kind (Retainer, monthly; or Project, one time), the value, the scope and the owner, then "Create proposal". It is at Proposal Sent.
2. When they negotiate, use "Add version" with the revised value. It moves to In Negotiation. Version 1 is kept.
3. When their accounts team asks to pay, use "Raise proforma". It moves to Proforma Issued. Then use Email or Download on the Invoices & Proformas tab.
4. Optionally use "Mark verbal yes". This is a manual flag only.
5. "Mark won" on the agreed version. The company becomes a Client and the proposal locks.
6. Set up the work: "Create retainer from this" or "Create project from this" (or "Set up the retainer →" on the Won card). Winning does not do this by itself.
7. If it falls through, use "Mark lost" with a reason.

## Setting up a retainer
From the client's Work tab → "Add retainer" (Client only; one active retainer per client):
- Monthly value before GST, and GST %.
- Bills: in advance (proforma at the start of the month) or after the month.
- What the work is for: this names its default project.
- Start date.
- Term in months: blank means no fixed term, which is flagged as no contract.
- Owner.

The renewal date is the start date plus the term.
- **To extend:** use "Edit retainer" (change the term).
- **To end:** use "Stop retainer" with a reason.
- A retainer never stops by itself at its renewal date.

## A retainer month
1. On the 1st, every active retainer that has started gets a month card, holding the monthly fee. Open it at /retainers/{id}?month=YYYY-MM.
2. **Tasks:** "+ Task". Every retainer task belongs to one of the retainer's projects; the default is the monthly work.
3. **Costs:** "+ Cost" (Enter costs). Enter the amount before tax and the GST %; the total with GST is stored.
4. **Proforma:** "Raise proforma" on the billing strip, or on [Money → Retainer billing](/money?tab=billing). It is prefilled with the fee and the retainer's GST.
5. **Invoice:** "Enter invoice" records the invoice raised in Tally (number, amount, date, due date — 15 days by default). One invoice per month. A retainer billed after the month can be invoiced from the 1st of the next month.
6. **Payment:** "Record payment" (amount, mode, reference, date). When payments reach the invoice amount, the invoice and its proforma become Paid.
7. **Closing:** on the 1st, earlier open months are closed automatically. There is no close button.
   - A closed month only locks its costs. Tasks and billing still work.
   - "Reopen month" is Setup access only and needs a reason.

## A one-time project with milestones
1. From a won proposal ("Create project from this"), or "Add project" on a Client, enter:
   - name, quoted value before GST, GST %;
   - start and expected end;
   - owner, priority.
2. Choose the billing:
   - Standard: Advance Payment 40%, Phase 1 Sign-off 30%, Final Delivery & Handover 30%.
   - Single invoice on delivery.
   - Custom milestones: these must add up to the quote.
3. Each milestone moves Pending → Proforma raised → Invoiced → Paid, only through documents:
   - "Raise proforma";
   - "Record invoice" (the Tally number);
   - "Record payment" (Paid once the invoice is fully paid).
4. "Undo" steps a milestone back one stage, and cancelling its proforma returns it to Pending. Only a Pending milestone can be edited or deleted.
5. Costs go on the project's Costs tab. Projects have no month lock.

For a Prospect, use "Add sample" instead. Sample work has no billing, but its costs still count.

## Tasks
- **Where every task belongs — one of these:**
  - **Client work:** a retainer (monthly) or a one-time project. Required, because billing and profit need it.
  - **Internal (the studio's own work):** an internal project (e.g. "Hiring", "Website revamp"), or **No project** for a one-off studio job (e.g. "Renew domain", "Fix office Wi-Fi").
  - A no-project task is a task like any other: on the person's My Work, All tasks, My department and the calendar, seen by them, their Head and Management.
- **Create:** "Task for myself" on My Work, "+ Task" on a project or retainer, "New task" on an internal project, "Create → Task" on the Calendar, or "Assign a task" on Team.
- **The form:**
  - Fill in "What needs doing?" and "Belongs to": internal, or a client's work.
  - Internal asks "Which internal project?" — the first choice is "No project (general internal task)", and one has to be picked. It works even when no internal projects exist.
  - A client's work asks for the company and which job (a retainer's work or a project).
  - Everyone listed is on the task; the first is the lead. Only Team work holders can assign other people.
  - A due date is required; a time is optional.
  - Priority: Low, Medium, High or Urgent.
  - Optional: Repeat, Type of work, Needs approval.
- **"Assigned by" vs "Added by":** "Assigned by" is who asked for the work; "Added by" is who typed it in.
- **On hold:** set the status to On hold. It records "waiting on the client", and that time is taken out of the task's elapsed time. Any other status resumes it.
- **Done and reopening:** "Done" finishes a task. Moving a Done or Cancelled task back to To do or In progress counts as a reopen.
- **Delete:**
  - Allowed for the creator, the lead, or a Head or Management.
  - A finished task cannot be deleted; cancel it instead.

## Approvals
1. With "Needs approval" ticked, the person doing the work opens the task → "Send for approval", with a link to the work and a note. The task goes to In review. They can share it with "Send on WhatsApp" or "Copy message".
2. Any one approver presses "Approve" (the task becomes Done) or "Request changes" (with what needs changing; the task goes back to In progress).
3. Other approvers can use "Add my changes" while it is back with the editor.
4. Nobody approves a task they are on.
5. While a task is In review, its type and approval tick are locked.
6. **Chasing:** after "Remind after" of working time (default 2 hours), approvers get a bell alert and an email. After "Escalate after" (default 4 hours), it escalates to the approvers and the escalation people. A new round restarts the clock.

## Assets: hand over and get back
1. [Assets](/assets) → the item → "Check out" (who, condition, due back, what for, project) or "Assign" (long-term).
2. When it comes back: "Check in" with its condition. Use "Hand on" to pass it straight to somebody else.
3. **Booking for a shoot:** Calendar → Create → Event, Kind Shoot, pick the Gear. Reserving is a plan; on the day, check each item out from the event's "Check out" link.

## Costs
[Money → Costs](/money) → "+ Record a cost":
- **What kind:**
  - Client (against a retainer month or a live project).
  - Company (an overhead: rent, software, utilities…). **Never salaries:** they come from Team (each person's monthly cost) and the time split, so a salary entered as a cost would be counted twice. Flowzen refuses it.
  - Capital or loan.
- **Then:** category, "Paid to" (the vendor), amount and GST, date.
- **Recurring costs:** copied into each new month on the 1st as drafts, which you confirm with "Confirm draft". Drafts count in totals before they are confirmed.
- **Deleted costs:** go to Trash.

## The time split
[Time split](/allocations), pick the month, check each person's proposed split, then "Edit" if it is wrong and "Confirm". It should total 100%.

# The rules behind the numbers

## Retainer profit and margin
- For one retainer month:
  - Revenue is the month's fee, before GST.
  - Cost is its cost rows (with GST) plus people cost.
  - People cost is each person's time-split % × their monthly cost. Proposed percentages count, not only confirmed ones.
  - Profit is fee − cost, and margin is profit ÷ fee.
- If nothing has been costed against a month (no cost rows and no time split), it is not costed yet. The retainer page says "the whole fee — nothing costed against this month yet". Treat that profit as unknown, not as the whole fee.
- On Money → Profit & Costs, "Profit by client" marks an uncosted month "Not costed yet" and leaves it out of the profit total.
- Zen's month lookup counts cost rows only, without people cost, so it can show a higher profit than Money. Money is the figure to trust.
- "Company profit" on Money, for a month = retainer fees + project revenue invoiced that month (before GST) − client costs − the whole payroll (every active person's monthly cost) − company overheads (salary-like costs left out, as payroll counts them).

## Why retainer and project money are never added together
A retainer month's fee and a project's whole contract value are different kinds of number. One is earned month by month; the other is a single contract over its life. So the per-client and per-project tables stay separate. Company profit for a month is the one place they meet: a project counts there in the month it is invoiced. The Forecast adds both into "Cash in", which is cash expected, not revenue.

## Project profit
- Revenue is the quote before GST. Cost is cost rows plus people cost. Profit is revenue − cost, and overheads are not included. Margin is "—" with no quote.
- **% done** is the share of milestones Invoiced or Paid. With no milestones, it is the share of the timeline elapsed.
- **Risk** is judged from 10% done, using projected cost (cost ÷ % done):
  - a projected loss shows "On course to lose money" and raises an alert;
  - a projected margin under 10% shows "Running above the estimate".
- With no costs recorded, the project page says "the whole quote — no costs recorded against it yet".

## Pipeline: committed vs weighted
- **A deal's probability:** its own override if set, otherwise the stage's: Proposal sent 30%, In negotiation 60%, Proforma issued 85%, Verbal yes 90%, Won 100%, Prospect and Lost 0%. Settings → Organisation changes the stage figures.
- **Weighted pipeline** is each deal's latest value × its probability. It is not revenue.
- **Committed money (Forecast "Cash in"):**
  - active retainers' monthly value, from the month the retainer starts up to the renewal month (every month if there is no renewal date);
  - live projects' unpaid milestones (or the quote if there are none), spread evenly over the project's remaining months in the window, or all in this month if it is past its end;
  - plus any deal picked in "What if".
- **"Pipeline (weighted)" in the Forecast** is shown separately and never counted in Cash in. A project deal is one payment, so it counts once, in month 1, at its probability. A retainer deal counts every month: month 1 counts Verbal yes and Proforma issued at full weight and other stages at half; month 2 counts In negotiation and Proposal sent at full weight and other stages at 0.7; month 3 counts everything at 0.8.
- **Forecast outflows:** salaries (every active person's monthly cost) + recurring costs (confirmed, from the month they start) + costs entered as owed and not paid (in the month they fall due; already past due in month 1). Salary-like costs are left out of the last two.
  - Net Cash Flow = Cash in − outflows.
  - Cash Kept % = net ÷ Cash in: green at 20% or more, red below 0.

## Alerts (the bell)
The scanner checks hourly and clears an alert once its condition stops. An alert's message and severity are fixed when it is first raised. Each person sees the alerts their permissions open, their own tasks' alerts, and approval and calendar alerts meant for them. A Head sees team alerts only about their own people.

- **Sales** (pipeline access):
  - **Proposal stalled:** Proposal Sent or In Negotiation with no contact for more than 5 days, counted from the last touch (a logged call or message counts). It is high after 10 days, and creates a "Follow up — {client} proposal" task for the owner.
  - **Verbal yes not advanced:** Verbal Yes for more than 3 days with no proforma.
  - **Proforma expired:** unpaid and past its "valid till". Once a day such a proforma is marked Expired (logged on its record); it is never done to one that became an invoice. The alert stays until it is re-raised, cancelled or invoiced. Accounts sees this and "Proforma unpaid" too.
  - **Proforma unpaid:** unpaid more than 7 days after it was raised.
- **Retainers** (all work):
  - **Retainer expiring:** renewal within 45 days, including dates already passed. It is high within 15 days.
  - **Retainer has no contract:** an active retainer with no term.
- **Team** (team work, plus your own tasks):
  - **Task overdue:** past due, and not Done, Cancelled or In review.
  - **Task on hold:** waiting on the client more than 5 days.
  - **Task aging:** open longer (in working time, less waiting) than twice the usual time for tasks with the same title. It needs 3 finished examples.
  - **Over-allocated:** a person's time split for this month is over 100%.
- **Money:**
  - **Invoice overdue** (paid/unpaid status access): past due. It becomes "aging 60" past 60 days, and is high when the client usually pays faster or has never paid.
  - **Month not invoiced:** a closed month with no invoice after 5 days.
  - **Retainer proforma not raised:** from the 3rd, for a retainer billed in advance.
  - **Time split unconfirmed** (enter costs access): from the 25th.
  - **Project over estimate** (money figures): heading for a loss.
- **Delivery and clients:**
  - **Project behind schedule** (all work): time elapsed is more than 15 points ahead of tasks done.
  - **Internal project past its target date** (its owner only, low): a running internal project past its target date with tasks still open. Once — it stays until the work is done, the date moves or the project is marked done. It links to the project.
  - **Client quiet** (companies access): a client with work and no task update, invoice, meeting, call, email or WhatsApp logged in 21 days.
- **Assets** (everybody):
  - **Asset overdue:** a checkout past due. It is high from 3 days late.
  - **Asset held by someone switched off.**
  - **Repair:** open more than 14 days.
  - **Warranty:** ending within 30 days.
- **Approvals:**
  - **Reminder:** to the approvers.
  - **Escalated:** to the approvers and the escalation people.
- **Calendar:** booked, moved or cancelled, and today's events, to the people on them.

An email digest of each person's open alerts goes at 08:00 IST, only when something is open and email is set up.

## Working hours, elapsed time and "overdue"
- **Working time** uses the working calendar in Settings (default 10:00–19:00, Monday–Saturday, minus holidays), in IST. A working day is 9 hours.
- **A task's elapsed time:**
  - It runs from when the task was assigned to when it was finished. While it is In review, it runs only up to when it was sent for approval.
  - Time on hold or waiting for approval is taken off.
  - Shown as hours and minutes. "usually ~X" is the typical time for tasks with the same title.
- **Overdue:** past the due date and not finished. My Work, All tasks, Team and alerts do not count In review tasks as overdue, because those are with the approver. The calendar does.
- **Open:** on All tasks and project lists, "Open" is To do + In progress. Team's "Open Tasks" also includes On hold.

## Repeating tasks
- **Options:** every working day, every week on the due date's weekday, or every month on the due date's day (the 31st falls on a short month's last day).
- **When the next copy is made:**
  - A daily repeat makes the next copy once the current one is done.
  - Weekly and monthly repeats make it 3 days before it is due.
  - A copy that would fall on a day off moves to the next working day.
- **What a copy carries:** the title, people, type, approval tick, priority and notes.
- **It stops by itself when:**
  - every copy is deleted;
  - the retainer stops;
  - the project is delivered, cancelled or removed;
  - nobody active is left on it.
- **Stopping it by hand:** "Stop repeating" in the task drawer.

## Document numbers and GST
- **Proforma numbers:** prefix/date/running number, e.g. EL/PI/30-09-2026/019. The count never resets.
- **Tax invoices:** in practice, invoice numbers are the ones typed in from Tally.
- **Numbers are never reused.** A gap means a document was created and removed.
- **GST:**
  - CGST + SGST (half each) when the place of supply is in the seller's state; IGST otherwise.
  - Default rate 18%, at most 28%. Totals round to the rupee.
  - A document's figures are fixed when it is made.
  - Fees and quotes are before GST; costs are stored including GST.

## Zen
Management only. Zen can look up:
- clients and one client in detail;
- a month's retainer money, and one retainer month in full (tasks, costs, proforma, invoice, next billing step);
- tasks, including whether they repeat;
- the open pipeline, with each deal's own probability;
- invoices and proformas;
- projects;
- team load by department;
- assets;
- open alerts, by rule;
- approvals waiting now, and the last 7 or 30 days;
- outreach leads and when they were last touched;
- the cost register;
- the forecast;
- what changed, from the activity log;
- this week's Monday brief.

It can draft a task for the person to create — or several at once from one message (up to 25 on one card, each with Add or Leave out, then one button adds them) — and remember how they like things done. It cannot change anything, and it never sees salaries: salary costs are one summed line, and profit it works out leaves people cost out. Anything it cannot look up — meetings and shoots, the time split itself, usage — it should say so and give the screen's link.
