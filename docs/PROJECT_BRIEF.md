# EyeLevel OS · Project Brief

**Version 1.0 · 29 August 2026**
Prepared for the development team. Companion to the working prototype in `prototype/`.

---

## Contents

1. [Context](#1-context)
2. [What went wrong last time](#2-what-went-wrong-last-time)
3. [Principles](#3-principles)
4. [Terminology](#4-terminology)
5. [The object model](#5-the-object-model)
6. [Data model, all entities](#6-data-model-all-entities)
7. [Relationships](#7-relationships)
8. [Derived values, never stored](#8-derived-values-never-stored)
9. [Permissions](#9-permissions)
10. [Screens](#10-screens)
11. [Core workflows](#11-core-workflows)
12. [The 12 rules](#12-the-12-rules)
13. [Scheduled jobs](#13-scheduled-jobs)
14. [Numbering and settings](#14-numbering-and-settings)
15. [AI scope](#15-ai-scope)
16. [Non functional requirements](#16-non-functional-requirements)
17. [Build stages and acceptance criteria](#17-build-stages-and-acceptance-criteria)
18. [Explicitly out of scope](#18-explicitly-out-of-scope)
19. [Migration](#19-migration)
20. [Open decisions](#20-open-decisions)

---

## 1. Context

EyeLevel Growth Studio is a full service growth studio in Chennai. Roughly 20 to 25
people across Digital Marketing, Design, Video, Development, Business Development
and Art.

Revenue is a mix of **monthly retainers** (₹30,000 to ₹2,20,000 each) and **one time
projects** (websites, shoots, events, films, documentaries, decks).

### The problems this system exists to solve

| Problem today | Root cause |
|---|---|
| No view of which one time projects are live, what they are worth, who owns them | A one time job is not a record anywhere. It exists as a folder and a quote file. |
| No idea what a project cost the company | The expense ledger has no client or project field. The link was never captured. |
| No gross margin or profit per job | Salary, the largest cost, is never allocated to anything. |
| Cannot compare a quote against actual cost | Quotes are documents, not records carrying a value. |
| Leads go cold | Follow up state is spread across six different files and tools. |
| The founder is the bottleneck | Work only exists after he says it out loud. |
| Management reporting is manual | Every number is reassembled by hand each time it is asked for. |

### What success looks like

- An employee opens one screen and sees their work for today
- A department head can see who is drowning and who is free without asking
- Management can answer "did we make money on that job" without a spreadsheet
- A proposal cannot go quiet without something raising a flag
- Nobody creates a project by hand every month just to log routine retainer work

---

## 2. What went wrong last time

The previous system had three modules: Task Management, CRM, Revenue. It is
still technically running and almost nobody uses it.

It failed for two reasons, and neither is aesthetic.

**It was unfinished.** From the API audit dated 28 June 2026:

- No `GET /projects`, no `POST /projects`. Project IDs were hardcoded in client scripts.
- No `GET /users`. All 16 user IDs hardcoded. A joiner or leaver silently broke integrations.
- No `DELETE` on anything. Test records are permanent.
- No comments, no attachments, no activity log, no notifications, no webhooks.
- `tags` present on all 262 task objects and empty on every one of them.
- No server side filtering. Every request returned the full dataset.

**Terminology was never agreed before building.** The same company existed as a
lead, an account and a client, in three modules, under three names, with no shared
backbone. Nobody could get from a task to a rupee.

**Implication for this build:** finishing matters more than features. A smaller
system that is complete will be used. A larger one that is 80% done will not.

---

## 3. Principles

1. **One spine.** Company, then Work, then Task. Everything hangs off it.
2. **Every word means one thing.** The glossary in section 4 is the whole vocabulary.
3. **Status is derived, never typed.** No Convert button, no dragging cards between stages.
4. **The daily screen stays trivial.** About 25 people use My Work. If it gets heavy, the data dies and every number in the system dies with it.
5. **Money is stored once and shown by permission.** Never duplicated per role.
6. **Rules before AI.** If arithmetic can answer it, arithmetic answers it.
7. **Nothing is entered twice.** A value captured on a proposal carries through to the retainer, the invoice and the forecast.
8. **Version one must be finishable.**

---

## 4. Terminology

This is the complete vocabulary of the system. There are no other nouns.

| Word | Means exactly this | Words it replaces |
|---|---|---|
| **Company** | Any organisation. Prospect or client, one record, forever. | account, lead, prospect, client, customer |
| **Person** | A human at that company, tagged Approver, Payer or Contact. | contact, POC |
| **Outreach entry** | A cold scraped name nobody has spoken to. Not a Company yet. | leads, cold leads, master leads |
| **Proposal** | A live number in front of a client. Carries value, date, owner, outcome. | quotation, estimate, deal, opportunity |
| **Version** | A revision of a proposal. Lives inside it. | revised proposal, v2 file |
| **Proforma** | A request for payment before the tax invoice. Own number series. | advance invoice |
| **Retainer** | Ongoing monthly work. No end date until stopped. | monthly project, recurring project |
| **Month card** | One month of a retainer. Created automatically. | monthly project |
| **Project** | One time work with a start, an end and one quoted value. | job, campaign, one-time project |
| **Task** | The smallest unit of work. One owner, one due date. | to-do, subtask, ticket |
| **Cost** | Money out. Direct (belongs to a job), Company (overhead) or Capital. | expense, spend |
| **Invoice** | The Tally tax invoice, mirrored here for tracking only. | bill |

**Deliberately removed:** lead, account, opportunity, quotation, deal. Each one
duplicated something else and forced a human to decide when to convert. That
decision is where the last system got stuck.

---

## 5. The object model

```
COMPANY  (Carlton Wellness)
│
├── PERSON  (Bidya, Approver) · (Accounts desk, Payer)
│
├── PROPOSAL  (Retainer, won)
│   ├── VERSION 1  ₹2,50,000
│   ├── VERSION 2  ₹2,20,000   ← won on this one
│   └── PROFORMA   EL/PI/26-27/012
│
├── RETAINER  ₹2,20,000/month · 12 month term · renews 30 Sept 2027
│   ├── MONTH CARD  October 2026     ← created automatically on the 1st
│   │   ├── TASK × 18                ← created from the retainer template
│   │   ├── COST  (ad spend, photographer)
│   │   ├── ALLOCATION  (Sneha 45%, Shyam 30%, Dilshad 20%)
│   │   └── INVOICE  INV/26-27/0142
│   ├── MONTH CARD  November 2026
│   └── MONTH CARD  December 2026 …
│
└── PROJECT  Website build · ₹1,50,000 quoted · ₹55,000 estimated cost
    ├── TASK × n
    ├── COST
    ├── MILESTONE × 3  (advance 40, design 30, launch 30)
    └── INVOICE
```

**The two rules that matter most:**

**A retainer is not a project.** The previous system forced a task to belong to a
project, so someone hand created four to ten projects every month just to log routine
retainer work. Here a scheduled job creates the month card. Nobody creates anything.

**Does it end?** That is the only test. If yes it is a Project. If no it is a
Retainer. There is no third type.

---

## 6. Data model, all entities

Types: `uuid`, `str`, `int`, `money` (integer paise or decimal, your call, be
consistent), `date`, `ts` (timestamp with timezone), `enum`, `bool`, `fk`.

### Company
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | str | unique per tenant |
| vertical | enum | Healthcare, Real estate, D2C, Sports, IT and SaaS, Retail, B2B, Hospitality |
| status | enum | `Prospect` `Client` `Past`. **Derived, see section 8** |
| source | enum | Outreach, Referral, Inbound, Partner agency, Network |
| ownerId | fk User | |
| city | str | |
| website | str | nullable |
| gstin | str | nullable, needed for proformas |
| billingAddress | text | nullable |
| lostReason | str | nullable, set when the last proposal is lost |
| createdAt | ts | |

### Person
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| companyId | fk Company | |
| name | str | |
| role | enum | `Approver` `Payer` `Contact` |
| email, phone, linkedin | str | all nullable |
| active | bool | POCs change, do not delete |

### OutreachEntry
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name, vertical, source | str/enum | |
| ownerId | fk User | |
| status | enum | `Not contacted` `Contacted` `Replied` `Dead` |
| promotedCompanyId | fk Company | nullable. Set when promoted |
| importedAt | ts | |

Deliberately a separate table. 380 cold names must never pollute the Company list.

### Proposal
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| companyId | fk Company | |
| kind | enum | `Retainer` `Project` |
| ownerId | fk User | |
| stage | enum | `Talking` `Proposal sent` `In negotiation` `Proforma issued` `Verbal yes` `Won` `Lost` `Expired`. **Derived** |
| outcome | enum | nullable. `Won` `Lost` `Expired` |
| wonVersionId | fk ProposalVersion | nullable |
| wonAt | ts | nullable |
| lostReason | str | nullable |
| probabilityOverride | int | nullable, 0 to 100. Overrides the stage default |

**Close rate counts Proposals, never Versions.** A deal fought through three rounds
is one proposal, not three.

### ProposalVersion
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| proposalId | fk Proposal | |
| n | int | 1, 2, 3 … |
| value | money | monthly figure for Retainer, total for Project |
| scopeSummary | str | one line, "scope trimmed, video dropped" |
| sentAt | ts | |
| fileUrl | str | the document attaches here |

**Immutable once sent.** Never overwrite version 1. The discount figure depends on it.

### Proforma
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| number | str | own series, see section 14. Never a Tally number |
| companyId | fk Company | |
| sourceType | enum | `Proposal` `MonthCard` `Project` |
| sourceId | uuid | |
| amount | money | |
| raisedAt, validTill | date | |
| status | enum | `Unpaid` `Paid` `Expired` `Cancelled` |
| invoiceId | fk Invoice | nullable. Set when it becomes a tax invoice |
| billingName, gstin, terms | str | snapshotted at raise time |

### Retainer
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| companyId | fk Company | |
| monthlyValue | money | |
| startDate | date | |
| termMonths | int | **nullable = month to month, which is a flagged risk** |
| renewalDate | date | derived from start + term |
| ownerId | fk User | account owner |
| status | enum | `Active` `Stopped` |
| stoppedAt, stopReason | ts/str | nullable |
| templateId | fk TaskTemplate | nullable |

At most one Active retainer per company.

### MonthCard
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| retainerId | fk Retainer | |
| month | str | `YYYY-MM` |
| revenue | money | snapshotted from monthlyValue at creation |
| status | enum | `Open` `Closed` |
| invoiceId | fk Invoice | nullable |
| closedAt | ts | nullable. Closing locks costs and allocations |

Unique on `(retainerId, month)`. Created by a scheduled job, never by a user.

### Project
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| companyId | fk Company | |
| name | str | |
| quotedValue | money | |
| estimatedCost | money | **nullable but this is the field that makes quote against actual possible** |
| startDate, endDate | date | |
| ownerId | fk User | |
| status | enum | `Live` `Delivered` `Cancelled` |
| sourceProposalId | fk Proposal | nullable |

### Milestone
| Field | Type | Notes |
|---|---|---|
| id, projectId | uuid/fk | |
| label | str | "Advance", "On design sign off", "On launch" |
| percent | int | |
| amount | money | |
| status | enum | `Pending` `Proforma raised` `Invoiced` `Paid` |

### Task
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| title | str | |
| workType | enum | `MonthCard` `Project` `Internal` |
| workId | uuid | nullable when Internal |
| assigneeId | fk User | |
| createdById | fk User | |
| dueDate | date | |
| **assignedAt** | ts | **stamped on assignment. Starts the clock** |
| **completedAt** | ts | nullable. Stops the clock |
| status | enum | `Open` `Waiting` `Done` |
| waitingOn | enum | nullable. `Client` `Another person` |
| waitingSince | ts | nullable |
| waitingTotalMinutes | int | accumulated across hold periods |
| reopenCount | int | default 0 |
| templateItemId | uuid | nullable, if generated from a template |
| notes | text | |
| attachments | json | |

`workId` is how a task carries its client. That is what makes the cost split
possible without a timesheet.

### TaskTemplate
| Field | Type | Notes |
|---|---|---|
| id, retainerId | uuid/fk | |
| items | json | `[{title, team, dayOfMonth, count}]` |

### Cost
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| **type** | enum | **`Direct` `Company` `Capital`. The first question on the form** |
| workType, workId | enum/uuid | required when type is Direct, null otherwise |
| category | enum | see section 14 for the two lists |
| vendor | str | |
| amount | money | |
| incurredAt | date | |
| committedNotPaid | bool | committed gives early overrun warning |
| paidBy | enum | `Company` `Akmal` `Jameel, N J Macson` |
| treatment | enum | `Company expense` `Akmal loan` `N J Macson loan` |
| enteredById | fk User | |
| recurring | bool | rent, internet, software, salaries |

**`workId` on a Direct cost is the single field the current spreadsheet does not
have, and it is why profit per job cannot be produced today.**

### PeopleAllocation
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| userId | fk User | |
| month | str | `YYYY-MM` |
| workId | uuid | month card or project |
| proposedPercent | int | computed from completed task counts |
| percent | int | what the head confirmed |
| confirmedById | fk User | nullable |
| confirmedAt | ts | nullable |

**Percentages only. This table never stores money.** The server multiplies by
`User.monthlyCost` at read time, and only for callers with `money.figures`.
A head confirming a split must never see a rupee value, otherwise six people learn
each other's salaries.

Sum of a user's percent across a month should be 100. Warn, do not block.

### Invoice
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| number | str | **entered by hand. Comes from Tally** |
| companyId | fk Company | |
| workType, workId | enum/uuid | |
| amount | money | |
| raisedAt, dueAt | date | |
| status | enum | `Raised` `Paid` `Overdue` `Cancelled` |
| paidAt | date | nullable |
| proformaId | fk Proforma | nullable |

### Payment
`id`, `invoiceId`, `amount`, `receivedAt`, `mode`, `reference`

### User
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name, email | str | email is the login |
| dept | str | |
| **monthlyCost** | money | **readable only with `setup.admin`. Never leaves the server for anyone else** |
| preset | enum | employee, manager, bd, accounts, admin |
| permissions | json | array of permission keys, overrides the preset |
| active | bool | |

### Alert
`id`, `rule`, `severity` (`high` `med` `low`), `entityType`, `entityId`,
`raisedAt`, `resolvedAt`, `acknowledgedById`, `message`

### Activity
`id`, `entityType`, `entityId`, `actorId`, `verb`, `payload` (json), `at`

Append only. Every create, update and status change writes one row. This is what
powers the History tab on a company and it is the audit trail the last system
lacked entirely.

---

## 7. Relationships

```
User ──owns──> Company ──has──> Person
                  │
                  ├──has──> Proposal ──has──> ProposalVersion
                  │              └──raises──> Proforma ──becomes──> Invoice
                  │
                  ├──has one active──> Retainer ──generates──> MonthCard ──has──> Task
                  │                                                  ├──has──> Cost (Direct)
                  │                                                  ├──has──> PeopleAllocation
                  │                                                  └──has──> Invoice ──> Payment
                  │
                  └──has many──> Project ──has──> Task, Cost, PeopleAllocation, Milestone, Invoice

Cost (Company)  ── no work link, category only
Cost (Capital)  ── no work link, sits outside profit
OutreachEntry   ── promotes into Company
Alert           ── polymorphic pointer to any entity
Activity        ── polymorphic pointer to any entity
```

---

## 8. Derived values, never stored

Computing these at read time is deliberate. Storing them creates drift.

| Value | Formula |
|---|---|
| `Company.status` | `Prospect` on promotion from outreach or manual create. `Client` when any proposal reaches outcome Won. `Past` when no Active retainer and no Live project and last activity older than 90 days. |
| `Proposal.stage` | Follows records, not input. Version exists → `Proposal sent`. Version count > 1 → `In negotiation`. Proforma raised → `Proforma issued`. Manual flag → `Verbal yes`. Outcome set → `Won` or `Lost`. |
| Task elapsed time | `completedAt - assignedAt`, counted in **working hours only** (see section 14), minus `waitingTotalMinutes`. |
| Task type average | Median elapsed for tasks sharing the same `templateItemId`, or the same title pattern when ad hoc. |
| Person load | `openTasks / trailing 8 week median openTasks for that person`, as a percentage. |
| Project `actualCost` | `SUM(Cost where workId = project)` + `SUM(allocation.percent × user.monthlyCost)` for every month the project ran. |
| Job profit | `revenue − directCost − peopleCost`. **Overheads excluded on purpose.** |
| Job margin | `jobProfit / revenue` |
| Company profit | `allRevenue − allDirectCost − salaries − overheads`. **Salary appears once here and is allocated down to jobs. Never added twice.** |
| Weighted pipeline | `currentVersion.value × (probabilityOverride ?? stageDefault)` |
| Committed revenue | `SUM(active retainer monthlyValue)` + `SUM(milestone amount due in the period)`, reported split by Retainer and One time, **never summed into a single figure** |
| Discount given | `version1.value − wonVersion.value` |
| Days in stage | `now − timestamp of the last stage change`, from Activity |

---

## 9. Permissions

Access is granted **per user, per permission**. Never by job title, never by
department. A junior can be given more than a head if the work needs it.

Presets exist so an admin is not flipping twelve switches for every new joiner,
but any switch can be overridden for one person. Store the preset name plus an
explicit permissions array; the array wins.

| Key | Name | Grants |
|---|---|---|
| `work.own` | My Work | See and complete work assigned to me, create my own tasks |
| `work.team` | Team work | See and assign work for my people |
| `work.all` | All work | See every retainer and project in the company |
| `company.read` | Companies | See companies, people and history |
| `company.write` | Edit companies | Add and edit companies and people |
| `pipeline.read` | Pipeline and proposals | See the stage board, proposals and proformas, **including deal values** |
| `pipeline.write` | Create proposals | Create proposals, versions and proformas |
| `money.status` | Money, status only | See paid or unpaid, never an amount |
| `money.figures` | Money, figures | See values, costs, margin and profit |
| `cost.enter` | Enter costs | Record vendor bills and expenses |
| `reports.read` | Reports and brief | Management reports, forecast, Monday brief |
| `setup.admin` | Setup | People, salaries, access, templates, numbering |

### Preset matrix

| Permission | Employee | Head | BD | Accounts | Management |
|---|:--:|:--:|:--:|:--:|:--:|
| work.own | ✓ | ✓ | ✓ | ✓ | ✓ |
| work.team | | ✓ | | | ✓ |
| work.all | | ✓ | | | ✓ |
| company.read | | | ✓ | ✓ | ✓ |
| company.write | | | ✓ | | ✓ |
| pipeline.read | | | ✓ | | ✓ |
| pipeline.write | | | ✓ | | ✓ |
| money.status | | ✓ | ✓ | ✓ | ✓ |
| money.figures | | | | ✓ | ✓ |
| cost.enter | | ✓ | | ✓ | ✓ |
| reports.read | | | | | ✓ |
| setup.admin | | | | | ✓ |

### Two rules that are easy to get wrong

**Deal values are not the same as cost figures.** A BD user has `pipeline.read`
but not `money.figures`. They **must** see proposal and pipeline values, because
they cannot sell without them. They must **not** see cost, margin, profit or
salary. Two separate gates.

**Enforce on the server.** The prototype masks values in the UI for demonstration.
The API must never send a figure the caller is not entitled to. Masking in the
client only is not access control.

---

## 10. Screens

Twelve screens plus three detail views. All are built in
`prototype/01_APPLICATION_UI.html`.

| Screen | Permission | Purpose |
|---|---|---|
| My Work | `work.own` | The only screen ~25 people open. Overdue, today, this week, done. Tick to complete. Own clock visible. |
| Team | `work.team` | Load bars, overdue counts, waiting counts, average close time. No money. |
| Companies | `company.read` | One list, tabbed by status. Row opens the company record. |
| Outreach list | `company.read` | 380 cold names, kept apart. Promote on reply. |
| Pipeline | `pipeline.read` | Six stage board with weighted value per column, plus stage to stage conversion. |
| Proposals | `pipeline.read` | Proposals with version badges, and the proforma register. |
| Live work | `work.all` | Retainers and projects, tabbed. Contract status, progress, risk flags. |
| Monday brief | `reports.read` | Written weekly read, the ask box, and all open alerts grouped. |
| Money | `money.figures` | Profit by client, company costs, the company's actual month, capital and loans, collections, cost register. |
| Forecast | `reports.read` | Committed against weighted, split retainer and one time, three months forward, what if per deal. |
| Setup | `setup.admin` | People and salaries, permission matrix, task templates, monthly time split, numbering. |
| Build spec | `setup.admin` | The developer reference, in app. |
| **Company record** | `company.read` | Four tabs: Overview, Proposals with full version history, Money, History. |
| **Month card** | `work.all` | One month of a retainer. Tasks, costs, allocations, invoice, profit. |
| **Project** | `work.all` | Quoted against estimated against actual, cost breakdown by person, milestone billing. |

### Forms required

task, company, person, proposal, proposal version, project, cost, proforma,
invoice. All nine are built in the prototype with their real fields. Open
**+ New** in the app to see each one.

---

## 11. Core workflows

### 11.1 Cold name to client

1. Names imported into `OutreachEntry`. Not visible anywhere else.
2. Someone replies. BD marks the entry replied.
3. **System** creates a Company with status `Prospect` and archives the outreach row.
4. BD adds a Person with a role.
5. Meeting logged. A follow up task is created for the owner on the next step date.
6. Proposal created with version 1. Stage becomes `Proposal sent`. Follow up clock starts.
7. No outcome after 5 days → **system** raises a follow up task. After 10 days it escalates to management.
8. Client pushes back. BD creates version 2. Version 1 is untouched. Stage becomes `In negotiation`. Clock restarts.
9. Client's accounts ask for a proforma. One click from the proposal. Stage becomes `Proforma issued`.
10. Client agrees. Proposal marked Won against version 2.
11. **System** flips Company status to `Client`, records `wonVersionId`, and offers to create the Retainer or Project using that version's value.

### 11.2 Retainer running

1. Retainer created from the won proposal. Value carries across. Owner, start date and **term** are confirmed. A null term is flagged as a contract risk.
2. On the 1st at 00:05 a job creates the Month card for every Active retainer.
3. The retainer's task template fires. Tasks are created with owners and due dates spread across the month.
4. People work. Tasks are ticked on My Work.
5. Costs are entered against the month card as they are committed.
6. On the 25th the allocation job computes each person's proposed split from completed task counts. Heads confirm on one screen, in percentages only.
7. Accounts raise the invoice in Tally and enter the number, date and amount here.
8. Payment received is marked. If not, the invoice appears in the overdue list weighted by that client's own payment history.
9. Month card closes. Profit is computed and filed against the client, the vertical and the company total.

### 11.3 One time project

1. Project created from an accepted quote. `quotedValue` required, `estimatedCost` optional but strongly encouraged.
2. Milestones set. Default pattern advance 40, design sign off 30, launch 30.
3. Tasks created and assigned.
4. Costs accumulate. **System** compares actual against estimate against percent complete and raises an alert while there is still time to act.
5. Milestone reached → proforma raised → invoice entered → payment marked.
6. On delivery, the project closes with a final profit figure that feeds the next quote for similar work.

### 11.4 The task clock

- `assignedAt` is stamped on assignment. Nobody starts a timer.
- The person sees their own elapsed time climbing while the task is open. They see only their own.
- Setting Waiting pauses their clock and starts a separate waiting clock against the client or the blocking person.
- `completedAt` stops it. Elapsed is shown against the median for that task type.
- Reopening restarts the clock and increments `reopenCount`. This is what stops people marking work done early to stop the clock.

---

## 12. The 12 rules

All arithmetic. No language model in any of them. Every alert must be traceable
back to the record and condition that raised it.

| Rule | Condition | Raises |
|---|---|---|
| Proposal needs follow up | stage in (Proposal sent, In negotiation) and days since last version > 5 and outcome is null | Task to owner, then management at 10 days |
| Proforma unpaid | status = Unpaid and days since raisedAt > 7 | Alert, Money |
| Invoice overdue | today > dueAt and status != Paid | Alert, weighted by that client's median days to pay |
| Project over estimate | actualCost > estimatedCost and percentComplete < 100 | Alert, Delivery |
| Project behind schedule | percentTimeElapsed − percentComplete > 15 | Alert, Delivery |
| Person overloaded | openTasks > 1.3 × that person's trailing 8 week median | Alert, People |
| Person underloaded | openTasks < 0.6 × median | Alert, People |
| Task aging | open working hours > 2 × the median for that task type | Alert, Delivery |
| Retainer with no contract | termMonths is null and status = Active | Alert, Risk |
| Renewal approaching | renewalDate within 45 days | Alert, Risk |
| Client gone quiet | no task, meeting or invoice on that company for 21 days | Alert, Risk |
| Month card not invoiced | month closed and invoiceId is null after 5 days | Alert, Money |

---

## 13. Scheduled jobs

| When | What |
|---|---|
| 00:05 on the 1st | Create a MonthCard for every Active retainer, then fire its task template |
| 00:15 on the 1st | Create recurring Cost rows (rent, internet, software, salaries) in draft, for confirmation |
| Hourly | Re-evaluate all 12 rules. Open new alerts, resolve alerts whose condition no longer holds |
| 00:30 on the 25th | Compute proposed PeopleAllocation percentages from completed tasks, notify heads |
| 07:00 Monday | Compose the Monday brief and mail it to users with `reports.read` |

Jobs must be idempotent. Running the 1st of month job twice must not create two
month cards, hence the unique constraint on `(retainerId, month)`.

---

## 14. Numbering and settings

All configurable in Setup.

| Setting | Default |
|---|---|
| Proforma series | `EL/PI/26-27/NNN`, sequential, never reused |
| Financial year | 1 April to 31 March |
| Working hours | Monday to Saturday, 10:00 to 19:00 IST. Sundays and public holidays excluded |
| Stage probabilities | Proposal sent 30%, In negotiation 60%, Proforma issued 85%, Verbal yes 90% |
| Currency | INR, Indian digit grouping (₹2,20,000 not ₹220,000) |
| Timezone | Asia/Kolkata |

**Client cost categories:** Ad spend, Freelancer, Photography and video, Printing,
Hosting and domain, Stock and licences, Travel client, Venue and events

**Company cost categories:** Salaries, Office rent, Internet and utilities,
Software, Pantry and tea, Travel not client, Professional fees, Marketing our own

---

## 15. AI scope

AI reads **only what is inside this system**. No email, no WhatsApp, no call
transcripts. That is a deliberate decision by the client and it keeps the build
small and private.

### Where a language model is used, four places only

| Use | Control |
|---|---|
| Monday brief, written prose from the week's numbers | Read only. Nothing acts on it |
| Ask the business a question in plain English | Read only. Answers must cite the record ids they came from |
| Draft proposals, scopes, follow up messages, client reports | Always produces a draft. **Never sends anything** |
| Sort free text expense descriptions into categories | Anything below a confidence threshold goes to a human |

Every AI response must respect the caller's permissions. The ask endpoint runs
queries as that user, never as a service account.

### Not being built

Meeting summaries, action items from calls, tasks created from emails or client
messages, scope creep detected from conversations, clients going quiet on
WhatsApp. All four need the conversation, and the conversation stays outside the
system. Nothing in this design blocks adding them later.

---

## 16. Non functional requirements

| Area | Requirement |
|---|---|
| Platform | Phone friendly web application. One build, works in a browser on laptop and phone. No native app in version one. |
| Auth | Email and password, EyeLevel domain accounts. Session based. Password reset by email. |
| Authorisation | Enforced server side on every endpoint. The client masks for presentation only. |
| Audit | Every create, update and status change writes an Activity row. No exceptions. |
| Deletion | Soft delete only. The previous system could not delete at all; the opposite failure is worse. Nothing is ever hard deleted by a user. |
| Filtering | Server side filtering and pagination on every list endpoint. The previous system returned all 262 tasks on every request. |
| Performance | List endpoints under 300ms at 10,000 tasks. |
| Scale | 25 users now, design for 60. |
| Backups | Daily, restorable. |
| Notifications | In app first. Email digest for alerts. No push in version one. |
| Export | CSV export on every list, for management screens at minimum. |

---

## 17. Build stages and acceptance criteria

Ship in this order. Each stage must be genuinely finished before the next starts.

### Stage 1 · Foundations
Users, permissions, auth, Company, Person, OutreachEntry, Activity log.
**Done when:** an admin can create a user, set their permissions per switch, and that
user's API calls are correctly allowed or refused. A cold name can be imported and
promoted to a Company. Every action so far appears in the Activity log.

### Stage 2 · Sales
Proposal, ProposalVersion, Proforma, Pipeline board, stage derivation.
**Done when:** a proposal can be created, revised to version 2 without touching
version 1, have a proforma raised against it, and be marked won. The board reflects
every one of those without anyone setting a stage by hand.

### Stage 3 · Work
Retainer, MonthCard, the 1st of month job, TaskTemplate, Project, Milestone, Task,
My Work, Team.
**Done when:** the month roll job runs on a test clock and creates a month card plus
its template tasks. An employee can complete a task and see the working time it took.
A task can be put on hold and resumed with the waiting clock recorded separately.

### Stage 4 · Money in and out
Cost with the `workId` field, Invoice, Payment, collections.
**Done when:** a cost can be recorded against a client or as a company overhead, an
invoice number from Tally can be entered and linked to a proforma, and a payment
closes it. The overdue list is correct.

### Stage 5 · Margin
PeopleAllocation, the allocation job, the head confirmation screen, job margin, the
company month.
**Done when:** a head can confirm a split in percentages without any rupee value
appearing, and job profit and company profit are both correct with salary counted
exactly once.
**Do not start this stage until stages 1 to 4 are in daily use without anyone being reminded.**

### Stage 6 · Intelligence
The 12 rules, alerts, forecast.
**Done when:** every alert in the prototype fires from real data and can be traced to
its record and condition.

### Stage 7 · Assistance
Monday brief, ask a question, AI drafting, expense categorisation.
**Done when:** the brief generates weekly and the ask endpoint answers within the
caller's permissions, citing record ids.

---

## 18. Explicitly out of scope

Do not build these. They were considered and deliberately excluded.

- **GST, TDS, statutory accounting, ledgers.** Tally stays the legal record and an
  external accounts team runs it. This system records the commercial fact only:
  the invoice number, date, amount and whether it was paid.
- **Timesheets and hour logging.** Rejected on adoption grounds. The allocation
  model replaces it.
- **Kanban boards, sprints, story points, subtasks, checklists.** A task is the
  smallest unit. Anything bigger is more tasks.
- **Multiple proposal tiers.** Business rule: one tier only, always.
- **Client portal or any client login.** Internal system only.
- **Native mobile apps.**
- **Email, WhatsApp or call transcript ingestion.**
- **Dragging cards between pipeline stages.** Stage follows records.

---

## 19. Migration

Import only what is live. Everything else stays in the old system as an archive.

| Source | Import as | Notes |
|---|---|---|
| Existing Flowzen leads | Company (Prospect) or OutreachEntry | Anything never replied to goes to OutreachEntry, not Company |
| Existing Flowzen tasks | Task | Open tasks only. Closed history stays in the archive |
| `CLIENTS/` folders | Company | 37 folders, mostly dormant. The client must confirm which are live |
| `PROPOSALS/` folder | Proposal + ProposalVersion | 30+ files with no value, date or outcome recorded. These need manual entry, there is nothing to script against |
| `EyeLevel_Financial_Consolidated.xlsx` | Cost | Expense Ledger maps to Cost. **There is no client column, so all historical rows import as type Company.** Historical job margin is not recoverable and should not be attempted |
| Team roster | User | Salaries entered manually in Setup |

**Set the expectation clearly with the client:** job profitability begins on the day
the system goes live. It cannot be backfilled, because the client and project link
on historical spend was never captured.

---

## 20. Open decisions

These need a decision from Akmal before or during the relevant stage.

1. **Hosting and stack.** Not yet chosen. Any modern stack is fine; the constraint is that it must be maintainable by whoever inherits it.
2. **Who may enter costs.** Recommendation: a separate `cost.enter` switch given to the founder, the accounts person, and any head chosen. Anyone else can raise a bill for approval but sees only their own entries.
3. **Ad spend passing through EyeLevel's account.** Currently treated as a direct cost reducing margin. Confirm whether it should be a pass through excluded from profitability instead.
4. **Partner loan tracking.** The Money screen shows the N J Macson and founder loan positions. Confirm whether repayment schedules belong here or stay in the spreadsheet.
5. **Vyoma and partner agency deals.** Currently the end client is the Company and Vyoma is recorded as the source. Confirm this is right for revenue attribution.
6. **Events and sports work** (TNPPL, CPPL, leagues) carry sponsorship revenue and a revenue share. Currently modelled as ordinary Projects. May need its own type later.
7. **Old system data.** Confirm what, if anything, must be migrated beyond open tasks and live clients.

---

*End of brief. The prototype is the visual specification. Where this document and
the prototype disagree, ask before choosing.*
