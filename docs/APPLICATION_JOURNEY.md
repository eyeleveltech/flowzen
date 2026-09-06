# Flowzen — Full Application Journey

A start-to-end walkthrough for manual testing: what to click, what happens underneath,
and *why* it works that way. Written against the running app at `localhost:3000`
(API on `localhost:4000`) using the seeded demo data.

This is a companion to `docs/PROJECT_BRIEF.md` (the formal spec, in this repo).
Where this doc explains *how to exercise* a piece of the system, the brief explains
*why it was specified that way*. Section numbers below (§4, §11.1, etc.) point back
at the brief.

---

## 0. Test accounts

All accounts use the org **EyeLevel Growth Studio**. Password for everyone except
Harish is `ChangeMe123!`. Harish's is `Harish143@`.

| Email | Role (preset) | Sees |
|---|---|---|
| `harish.s@eyelevelstudio.in` | Management | Everything — all 12 screens |
| `akmal@eyelevelstudio.in` | Management | Everything — same as Harish |
| `dilshad@eyelevelstudio.in` | Head, Digital Marketing | My Work, Team, Live work — money masked |
| `janani@eyelevelstudio.in` | Head, Design | Same as Dilshad |
| `charles@eyelevelstudio.in` | Head, Video | Same as Dilshad |
| `tanuja@eyelevelstudio.in` | Business Development | Companies, Outreach, Pipeline, Proposals — deal values visible, cost/margin not |
| `varsha@eyelevelstudio.in` | Business Development | Same as Tanuja |
| `priya@eyelevelstudio.in` | Accounts | Money status + figures, cost entry |
| `sneha@`, `ramya@`, `shyam@`, `shakila@`, `naif@`, `vikram@eyelevelstudio.in` | Employee | My Work only |

**Why role matters for testing:** permissions are enforced on the *server*, not just
hidden in the UI (§9 — "masking in the client only is not access control"). Logging in
as `sneha@` and confirming she genuinely cannot fetch `/money` data (not just that the
nav link is hidden) is a real test, not a cosmetic one.

---

## 1. The core idea — read this before clicking anything

Everything in the app hangs off one spine (§3, principle 1):

```
COMPANY → WORK → TASK
```

"Work" is either a **Retainer** (ongoing, no end date) or a **Project** (has a start,
an end, one quoted value). The only test that decides which: **does it end?** (§5).
There's no third type, and nothing is ever converted between them by hand.

Status fields you'll see everywhere (stage, company status, project health) are
**derived, never typed** (§3, principle 3) — there's no dropdown anywhere that lets
you set "Won" or "Client" directly. You do the real thing (mark a version won, raise
an invoice) and the label follows. If you ever find a screen where you can set a
status directly with no underlying action, that's worth flagging — it isn't supposed
to exist.

---

## 2. The full journey — one deal, start to finish

Follow this in order as one continuous story. Log in as `tanuja@` (BD) for steps
1–6, then switch to `harish.s@` for the rest (BD can't see money or manage delivery).

### Step 1 — Cold name → Company (§11.1)

Go to **Outreach list** (`/outreach`). This is deliberately a *separate* table from
Companies — 380 cold scraped names must never pollute the real client list (§6,
`OutreachEntry`). Pick any row and click **Mark replied**.

**What happens:** the API creates a real `Company` (status `Prospect`) in one
transaction and archives the outreach row — it disappears from this list and now
exists at `/companies`. A toast gives you a direct link to it.

**Why:** the brief's rule is explicit — a reply is the ONLY thing that promotes a cold
name into a Company. Nothing else does.

### Step 2 — The Company record

Open the new company (`/companies/[id]`). Four tabs: **Overview & People**,
**Proposals**, **Invoices & Proformas**, **Audit Trail**.

- Click **+ Add Person** → add a contact, role `Approver`. (§6, `Person.role`)
- Check **Audit Trail** — this is the `Activity` log (§6): every create/update writes
  one row here, append-only. This is what the previous system never had at all (§2).

**Quirk worth knowing, not a bug:** creating a company directly from the Companies
page's **+ New** button (instead of via Outreach promotion) auto-creates a placeholder
₹0 Proposal in the **Talking** stage alongside it. That's the only thing that
populates the Pipeline board's Talking column — Outreach-promoted companies and
explicitly-created proposals both skip it entirely (every "New Proposal" you create
by hand starts at **Proposal sent**). If you drag a card and expect Talking to fill
up from normal use, it won't — see §8 below.

### Step 3 — Raise a Proposal

On the Proposals tab, click **+ New Proposal**. Fill it in:

- **Kind**: `Retainer — ongoing monthly work` or `Project — one time, start and end`.
  This single choice decides everything that happens after Won.
- A value (monthly for Retainer, total for Project).

**What happens:** a `Proposal` + its first `ProposalVersion` (`n: 1`) are created.
Stage becomes **Proposal sent** automatically — you never set a stage.

**Also check the Pipeline board** (`/pipeline`): the same proposal now shows as a
card in the Proposal sent column, tagged **Retainer** or **One time** (that label
was recently fixed to say "One time" instead of a bare "Project" — the bare word
was confusable with the actual Project record you get after winning).

### Step 4 — Negotiate: add a Version

Client pushes back on price. From the Proposals tab (or by dragging the Pipeline
card into **In negotiation**), click **Add version**. Enter a lower value.

**What happens:** `ProposalVersion n:2` is created. **Version 1 is never touched** —
it's immutable once sent (§6). This is what makes "discount given" computable later
(`version1.value − wonVersion.value`, §8) — though note that figure isn't surfaced
as a KPI anywhere in the app yet (a known open gap, see §8 below).

### Step 5 — Raise a Proforma

Client's accounts team asks for a payment request before anything is won. From the
proposal (or by dragging the card to **Proforma issued**), click **Raise proforma**.
Fill in billing name, GSTIN, GST rate, description.

**What happens:** a `Proforma` is created with its own number series
(`EL/PI/26-27/NNN`, §14 — never a Tally number), and the proposal's stage follows
to **Proforma issued** automatically. Open the PDF from the Invoices & Proformas tab
and check the CGST/SGST split and terms actually match what you entered — these were
real bugs earlier this session (the PDF used to ignore the document's own terms and
show only a combined tax line).

### Step 6 — Verbal yes, then Won

Client agrees verbally. Drag the card to **Verbal yes** (only allowed once a proforma
exists — dragging it there from an earlier column is refused with an explanation, not
silently accepted: §18 explicitly forbids dragging cards to *set* a stage).

Then mark the winning version **Won** (button next to that version on the Proposals
tab, or drag to the **Won** column).

**What happens, atomically:**
- `Proposal.outcome = WON`, `wonVersionId` recorded, `wonAt` stamped.
- **Company.status flips to `Client`** — derived, not set by you (§8).
- The company page now offers **"Create retainer from this"** or **"Create project
  from this"**, depending on the proposal's `kind` — carrying the won value across
  so you never retype it (§3, principle 7: "nothing is entered twice").

Switch to `harish.s@` here — BD's permissions stop at the sale.

### Step 7a — If it was a Retainer

Click **Create retainer from this**. Confirm the **term** (months) — leaving it
blank is deliberate-but-flagged: a null term means month-to-month, which the rules
engine raises as `RETAINER_NO_CONTRACT`, an actual risk alert (§12).

**What happens next isn't manual.** A scheduled job (§13, 00:05 on the 1st) creates
a `MonthCard` for every Active retainer and fires its `TaskTemplate` — this is the
brief's central anti-busywork rule: **"a retainer is not a project"** (§5). Nobody
hand-creates four to ten projects a month just to log routine work.

To test this without waiting for the actual 1st of the month: the job
(`apps/api/src/workers/monthCard.cron.ts`) isn't a real midnight timer — it's
idempotent per `(retainerId, month)` and polls **once immediately on API startup,
then every hour**, so whichever tick lands after the 1st does the real work and every
other tick is a cheap no-op. For a retainer you just created, that means either
waiting up to an hour or restarting the API dev server to force the immediate run.
Open the retainer (`/retainers/[id]`) afterward and confirm the current month card
exists with its templated tasks already assigned.

### Step 7b — If it was a Project

Click **Create project from this**. The value and company carry over. Pick a
**Billing** pattern: Standard (40% advance / 30% design sign-off / 30% launch),
Single invoice, or Custom milestones.

**What happens:** a `Project` plus its `Milestone` rows are created in one call.
Open it at `/projects/[id]` — or via **Live work → Projects tab**, which is the one
and only place to browse and create projects now (the old standalone `/projects` list
page was folded in here, on purpose, because having two separate "find a project"
screens was confusing — you're reading the fixed version).

### Step 8 — Tasks and the clock (§11.4)

From either the Month card or the Project page, click the **+ Task** button. Assign it,
set a due date.

- `assignedAt` is stamped the moment you assign it — **nobody starts a timer**.
- Log in as the assignee and open **My Work** (`/my-work`). The task shows its own
  elapsed time climbing, and once enough same-type tasks exist historically, a
  "usually ~2h" comparison against the median for that task type.
- Click the status dropdown and set it to **On hold** (`waitingOn: Client` or
  `Another person`). This pauses the person's own clock and starts a separate
  waiting clock — check that re-opening it later correctly folds the waited time into
  `waitingTotalMinutes` rather than losing it.
- Mark it **Done**, then **reopen** it. `reopenCount` should increment — this is the
  brief's explicit anti-gaming mechanism ("what stops people marking work done early
  to stop the clock").

**Also test task creation from the other two entry points** and confirm they all
converge on the same record: the global **+ Quick Create → New task** (opens "Task
for myself" with a Company → Project/Retainer picker), and **Team → Assign** (assigns
to someone else, same picker).

### Step 9 — Costs (§6, `Cost`)

On the Project or Month card, click the **+ Cost** button (only visible with
`cost.enter`). The very first field is
**type** — `Direct` (belongs to this job), `Company` (overhead), or `Capital` — by
design, per the brief, that's "the first question on the form." Pick `Direct`,
a category (e.g. "Photography and video"), an amount.

**Why this matters:** `workId` on a Direct cost is, per §6, *"the single field the
current spreadsheet does not have, and it is why profit per job cannot be produced
today."* Everything downstream — job profit, margin, quote-vs-actual — depends on
this one link existing.

### Step 10 — Invoicing and payment

On Money (`/money`) or the Project/Month card, click **+ New invoice**, enter the
number **by hand** — this is deliberate (§6: "entered by hand. Comes from Tally").
Flowzen never talks to Tally; it only mirrors the commercial fact (number, date,
amount, paid or not) for tracking. Mark it **Record payment** once done.

**Test the guard:** try recording a payment on an invoice already marked `Cancelled`
— the button should not appear at all (a real bug earlier this session let you do
this; confirm it's still fixed).

### Step 11 — Close and profit

For a Project: mark it **Delivered**. For a Month card: it closes automatically once
its period ends (closing locks costs and allocations — no further edits after that).

Open **Money → Profit & Costs** and find this client. Confirm:
`profit = revenue − directCost − peopleCost`, and that **overheads are excluded from
job profit on purpose** (§8) — they only show up in the separate company-wide profit
figure, so salary is never counted twice.

---

## 3. The daily-use screens (not linear — these run continuously)

### My Work (`/my-work`)
The brief calls this "the one screen ~25 people open" (§3, principle 4) and insists
it **stays trivial** — three verbs only: change status, add a note, create a task for
yourself. Log in as `sneha@` and confirm this really is all she sees.

### Team (`/members`)
Head/Management only. Load bars, overdue counts, average close time — **no money at
all**, even for a Head. Confirm a flagged row (>130% of that person's own trailing
8-week median open-task count) actually corresponds to `PERSON_OVERLOADED` in the
alerts, not a hardcoded threshold.

### Live work (`/live-work`)
Tabbed Retainers / Projects, the org's live-work dashboard. The Projects tab has its
own status filter (defaults to Live) and the **+ New project** button — test that
switching the filter to "All statuses" reveals Delivered/Cancelled projects without
changing the KPI cards above it, which stay pinned to *live* work regardless of the
table filter.

---

## 4. Money, reporting, and the weekly brief

### Money (`/money`) — `money.figures` only
Profit by client, company costs, capital/loan positions, the collections list,
the cost register. Log in as `priya@` (Accounts) and confirm she sees figures but
**not** salaries (`User.monthlyCost` is gated to `setup.admin` specifically, tighter
than `money.figures` — a real bug this got fixed to, worth re-checking).

### Forecast (`/forecast`)
Committed revenue (signed retainers + due milestones) plotted against weighted
pipeline, three months forward, split Retainer vs. One time — **never summed into
one figure** (§8, explicit). Try the **"what if"** picker: forcing one open deal to
"assume won" should shift the projected numbers without actually touching that
proposal's real state.

### Monday brief (`/brief`) — `reports.read` only
Four quadrants: contract risk, pipeline momentum, money owed, team capacity — all
real computed data, refreshed live when you open the screen. **It also now actually
emails itself** — like the other workers it polls hourly, but only actually sends
once a week, on the first tick that lands on a Monday, to everyone with
`reports.read` (`apps/api/src/workers/brief.cron.ts` + the org's SMTP settings in
Setup → Mail) — that part used to be a gap where the brief was real but nothing ever
mailed it. (§13 specifies 07:00 sharp; the real implementation isn't that precise —
it fires on whichever hourly tick happens to be the first one after midnight Monday,
which in the worst case could be up to an hour late.)

**What's genuinely not there yet:** the text is template-composed from the numbers,
not AI-written prose, and there's no "ask a question" box. Both are explicitly
deferred — see §5.

---

## 5. Admin and operations

`/settings` (`setup.admin` only) — People & salaries, permission matrix (per-person
switches, preset plus overrides — confirm a switch flipped for one person doesn't
affect anyone else), task templates, numbering, Mail (SMTP), and **Trash**
(soft-deleted Projects/Costs/TaskTemplates — nothing in this app hard-deletes; confirm
Restore actually brings a record back rather than just hiding the trash row).

`/allocations` ("Time split", gated on `cost.enter` — Head, Accounts, and
Management, not exclusively admin) — the 25th-of-month allocation confirmation
screen. Proposed percentages come from completed task counts, not typed in; a Head
confirms in **percentages only** — log in as a Head and confirm no rupee figure is
visible anywhere on this screen, even though the server is computing one underneath
(§6: "a head confirming a split must never see a rupee value, otherwise six people
learn each other's salaries").

---

## 6. Alerts — how to trigger each one for testing

All 12 brief rules (§12) exist, plus 6 more the app added beyond spec. They
re-evaluate on an interval in dev (hourly in production) via
`apps/api/src/workers/scanner.cron.ts`.

| Rule | How to make it fire |
|---|---|
| `PROPOSAL_STALLED` | Leave a Proposal sent / In negotiation proposal untouched 5+ days |
| `PROFORMA_UNPAID` | Raise a proforma, leave it Unpaid 7+ days |
| `INVOICE_OVERDUE` | Raise an invoice with a past due date, don't mark it paid |
| `PROJECT_OVER_ESTIMATE` | Log Direct costs on a project exceeding its `estimatedCost` before it's 100% done |
| `PROJECT_BEHIND_SCHEDULE` | Let a project's elapsed time outpace its % complete by 15+ points |
| `PERSON_OVERLOADED` / `PERSON_UNDERLOADED` | Assign someone well above/below their trailing 8-week median open-task count |
| `TASK_AGING` | Leave a task open more than 2× the median time for that task type |
| `RETAINER_NO_CONTRACT` | Create a retainer with no term months |
| `RETAINER_EXPIRING` | Set a renewal date within 45 days |
| `CLIENT_QUIET` | No task, meeting, or invoice on a company for 21 days |
| `MONTH_CARD_NOT_INVOICED` | Close a month card, don't raise its invoice within 5 days |

Check that resolving the underlying condition (e.g. paying the overdue invoice)
actually **auto-resolves** the alert on the next scan rather than requiring you to
dismiss it by hand.

---

## 7. Known gaps — don't file these as bugs

- **No AI features anywhere** (§15, Stage 7): no "ask the business a question," no
  AI-drafted proposals/follow-ups, no AI expense categorization, and the Monday
  brief's prose is template text, not model-written. Deliberately deferred — the
  `openai` package is installed but never imported, no API key is configured. This
  is the one honestly incomplete stage; everything before it (Stages 1–6) is built.
- **Pipeline's "Talking" column is nearly always empty.** Only the auto-created
  placeholder proposal from directly creating a Company populates it (§2 above) —
  every proposal you raise yourself starts at Proposal sent. This needs a product
  decision (wire in `OutreachEntry` conversations, or drop the column) — it isn't
  broken, just not wired to anything that fills it in normal use.
- **No "discount given" figure** (`version1.value − wonVersion.value`) surfaced
  anywhere, even though every version is stored and the math is trivial. Flagged as
  worth doing, not yet built.
- **No self-service password reset.** The login screen says so directly — an admin
  issues a new one from Team instead. The mailer that would carry a reset link now
  works for other purposes (alerts digest, Monday brief), so this is revivable if
  wanted, just not wired up.

---

## 8. Quick route map

| Route | Screen | Gate |
|---|---|---|
| `/my-work` | My Work | `work.own` |
| `/members` | Team | `work.team` |
| `/companies`, `/companies/[id]` | Companies | `company.read` |
| `/outreach` | Outreach list | `company.read` |
| `/pipeline` | Sales pipeline | `pipeline.read` |
| `/quotations` | Proposals + Proforma register | `pipeline.read` |
| `/live-work` | Live work (Retainers/Projects, tabbed) | `work.all` |
| `/projects/[id]` | Project detail | `work.all` |
| `/retainers/[id]` | Month card | `work.all` |
| `/brief` | Monday brief | `reports.read` |
| `/money` | Money | `money.figures` (or `money.status` for status only) |
| `/forecast` | Forecast | `reports.read` |
| `/allocations` | Time split | `cost.enter` |
| `/settings` | Setup | `setup.admin` |
| `/profile` | Your own profile | anyone signed in |

---

*Written from a full re-read of `docs/PROJECT_BRIEF.md`, `docs/BRIEF_AUDIT.md`,
`docs/PARITY_LEDGER.md`, and direct inspection of the running schema, routes, and UI
as of 2 September 2026. If something here doesn't match what you click through,
trust the running app and tell me — this doc describes it, it doesn't define it.*
