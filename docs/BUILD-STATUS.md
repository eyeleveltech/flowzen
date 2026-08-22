# Flowzen v2 — Build Status

**Where the rewrite has got to, and what is left.** Written as a handover: enough to
pick this up cold.

| | |
|---|---|
| **`FLOWZEN-MASTER-PLAN.md`** | The design and every decision, with reasoning |
| **`FLOWZEN-JOURNEY.md`** | The story, for anyone non-technical |
| **`FLOWZEN-WORKFLOW.md`** | The reference — every screen, every field |
| **This file** | What is built, what is not, and how to run it |

Last updated: 2026-08-17.

---

## Getting it running

```bash
cd apps/api && npx tsx src/index.ts     # API — http://localhost:4000
cd apps/web && npx next dev             # Web — http://localhost:3000
```

Sign in with **`admin@eyelevel.local`** / **`ChangeMe123!`** (created by the seed).

```bash
cd apps/api
npx vitest run                    # 147 unit tests
npx tsx test/journey.ts           # 52 checks, end to end against the real database
npx tsx prisma/seed.ts --config   # re-seed configuration; idempotent
npx tsc --noEmit                  # 0 errors expected
```

**To fill an organisation with a working agency:**

```bash
npm run seed:demo -- --org "Eyelevel"           # clients, deals, quotes, money, work
npm run seed:demo -- --org "Eyelevel" --reset   # clear what it made, then refill
```

`--org` is required whenever more than one organisation exists — it will not guess.
It refuses to run twice without `--reset`, because "one more Blinkit every time"
is worse than stopping. `--reset` never touches `doc_counters`.

> **`EADDRINUSE`** means something is already on the port. On this machine port
> 3000 is usually taken by an unrelated project, so the web app tends to land on
> 3001 — that is fine, the API URL is what matters and it defaults to
> `http://localhost:4000/api` (override with `NEXT_PUBLIC_API_URL`).
>
> **Restart the API after pulling.** A running instance does not pick up new
> routers, and the symptom is a 404 on an endpoint that exists in the source.

---

## What is built

### The database

**29 models, 23 enums**, three migrations, and **10 constraints the application
cannot violate** — every one verified rejecting bad data:

- a task belongs to exactly one of a project or a deal
- at most one ACCEPTED quote per deal
- exactly one WON and one LOST stage per pipeline
- one primary contact per company
- money is never negative; an engagement cannot end before it starts
- a company with engagements **cannot be deleted** — "nothing is deleted, only
  retired" holds at the database, not in a code review

### API — every route below is live and exercised

| Area | Endpoints |
|---|---|
| `auth` | login · logout · me · register · accept-invite · reset-password · link · unlink |
| `config` | org settings · stages · lost reasons · sources · services · next document number · module on/off · audit log · **mail settings · send a test** |
| `companies` | list · get · create · update · archive · check-duplicate · contacts |
| `deals` | board · get · create · update · **stage** · **win** · lose · hold · unhold |
| `quotes` | list · get · preview · create · send · **accept** · decline · awaiting-reply |
| `revenue` | engagements · attention · terms · pause/resume/end · billing due · raise invoice · invoices · send · payments · summary |
| `projects` | list · get · create · tasks · my tasks · update task |
| `users` | list · invite · resend invite · reset link · **change role** · edit · deactivate · activate |
| `profile` | get · edit · set password |
| `activities` | log · list *(append-only — PATCH and DELETE return 405)* |
| `dashboard` | one call, assembled per role |
| `notifications` | list · mark read · mark all read *(reading only — nothing writes rows yet)* |
| `search` | one box over clients, deals, projects, tasks, quotations, invoices |
| `stream` | SSE |

### Web — every page is on `lib/api-v2.ts`

`dashboard` · `pipeline` · `pipeline/[id]` · `clients` · `clients/[id]` ·
`quotations` · `projects` · `projects/[id]` · `tasks` · `revenue` · `members` ·
`settings` · `profile` · `modules` · `login` · `register` · `accept-invite` ·
`reset-password`

`src/lib/api.ts` (the v1 client) has no consumers left.

**Settings has seven tabs**: Organisation · Tax & numbering · Email · Team ·
Modules · Lists · Activity.

### Sending mail

`services/mail.ts` (delivery) and `services/mail-templates.ts` (wording), kept
apart because one is plumbing and the other is the agency's voice reaching a
client.

Configured **per organisation** under Settings → Email — server, port, username,
password, from-name, from-address, reply-to — with **Send a test to me**, which
authenticates first and then sends a real message, so "it says it worked" and
"something arrived" are the same claim.

`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` in `.env` are
the **fallback** for a single-agency install. When they are in use the Email tab
says so and names the mailbox — otherwise an admin sees an empty form marked
"On" and no way to find out whose account their invitations leave from.

The password is write-only: never returned by any endpoint, and a blank field on
save means "keep what is stored" rather than "clear it", so correcting the port
cannot wipe a working password. Clearing the **host** clears the credential with
it.

Three messages exist today: the invitation, the password reset, and the
quotation. The quotation carries its figures in the body — PDFs are backlog item
2, and a client reading on a phone should see the number without downloading
anything. When the PDF arrives it attaches alongside this, it does not replace it.

### The component library

Screens are assembled from `components/ui/`, never from raw markup:

| Added | Already there |
|---|---|
| `Button` `Badge` `Modal` `Table` `EmptyState` `Note` `ErrorNote` | `Select` `Field`/`FieldSelect`/`FieldCheckbox` `Toggle` `Card` `Drawer` `Icon` `PageHeader` skeletons |

Note there is **no shadcn** in this project — no `components.json`, no Radix.
The set above is hand-written and is the house style.

### Tests

**147 unit + 52 journey**, typecheck clean on both apps, and every route renders.

---

## What is left

### Nothing is on the v1 client

The twenty pages that were are either rebuilt or deleted. Deleted outright,
because the new design folds them into `/revenue`, `/clients` and `/quotations`:

`contracts` · `subscriptions` · `invoice-drafts` · `invoices` · `payments` ·
`receivables` · `expenses` · `renewals` · `lost-deals` · `revenue/pnl` ·
`calendar` · `departments` · `reports` · `forgot-password` · `verify-email` ·
`setup-password`

Along with their components and the orphans they left behind — `useQueries.ts`
and its 300 lines of dead hooks, `activity-feed`, `stage-config`,
`intelligence-config`, `lead-stage`, `status.ts`, `task-status.ts`,
`tax-catalog`, `status-badge`, `client-gantt-view`, `client-timeline-view`.

### Not started

| # | What | Why it matters |
|---|---|---|
| 1 | **The daily scanner** | Nothing in the application writes a `Notification` — only `seed:demo` does, so the bell has something in it but nothing keeps it current. Reading works; producing does not. Upsert on `(userId, dedupeKey)`, the way the seed already keys them: re-inserting gives thirty identical lines a month and the bell stops being read |
| 2 | **Quote and invoice PDFs** | `pdfKey` columns exist. Generation, compression and object storage are unbuilt (`quotePdf.service.ts` is archived) |
| 3 | **Editing the lists** (backlog B8) | Stages, lost reasons, sources and services are rows, shown read-only under Settings → Lists. Changing one is still a seed edit |
| 4 | **Stage form values** (§3.5 step 10) | `CustomField`, `StageField` and `CustomFieldValue` exist and are seeded, but nothing reads or writes a value |
| 5 | **Google OAuth** | `accept-invite` and `link` accept a `googleId`, but nothing verifies a Google ID token |
| 6 | **Expenses** | Model exists and `seed:demo` writes rows, but there are no routes and no screen — so the data is there and gross margin is still revenue-only |
| 7 | **Reports** | No endpoint, and the page is deleted. The dashboard and `/revenue` carry the numbers |
| 8 | **Who is on a project** | `ProjectMember` has a model, a unique index and seeded rows, but **no routes** — nobody can be added to or removed from a project. The plan specifies it (§3.12) and the seed fills it, so this is a missing endpoint rather than a missing decision |
| 9 | **Repeating tasks** | `Task.recurrence` is in the schema and read by nothing. It is there for retainer work that repeats monthly — the same twelve tasks a year that somebody currently re-types |

### Deliberately not built

Backlog from master plan §7.1, unchanged: recurring invoices (B2), payment
reminders (B3), milestone billing (B4), onboarding checklist (B1), job functions
(B7).

---

## Things to know before touching it

**Old code is archived, not deleted.** `apps/api/src/routes-v1-archived/`,
`services-v1-archived/`, `prisma/migrations-v1-archived/` and
`prisma/schema.v1-archived.prisma`. The first two are excluded from
`tsconfig.json` — add anything you port back to the build.

### The invariants

**`Company.status` has exactly one writer**: `syncCompanyStatus` in
`services/companyStatus.ts`. Nothing else may assign to it. This is what stopped
the "dashboard says 1, list says 5" class of bug.

**`Invoice.status` follows its payments**, decided only in `invoice.service.ts`.
Same discipline.

**Winning goes through `winDeal`, never a stage move.** `POST /deals/:id/stage`
refuses a WON stage on purpose — a drag that quietly creates billing is the
original bug.

**The billing date advances only when an invoice is actually raised.** Never on
a timer, so an unbilled month keeps showing as due.

**No rule may identify a stage by name.** Stages are rows and can be renamed.
Rules read `kind` and `requiresForecast`.

**Roles are a ladder.** `requireRole('MANAGER')` admits Manager, Admin and Super
Admin. On the web, `atLeast()` and `canSee()` do the same and are **presentation
only** — the server enforces everything.

**Never compare a role with `===`.** `role === 'MEMBER'` catches one rung and
lets every rung above it through — which is how a salesperson ended up able to
close and rename other people's delivery work. Use `atLeast(role, minimum)` from
`middleware/auth.ts` inside a handler, or `requireRole` as middleware. There is
no case where an exact comparison is the right answer, because the ladder means
each rung contains the one below.

**Gate reads on the ROUTER, not per route.** Every write on `/deals` and
`/quotes` carried its own `requireRole('SALES')` and the LIST carried nothing, so
any signed-in account could read the whole pipeline and every quotation total. A
gate that must be remembered per route is a gate that gets forgotten on the next
route added.

**Money is enforced where it is ASSEMBLED, not only where it is asked for.**
`/revenue/invoices` correctly refuses a Member — and `GET /companies/:id` handed
over the same invoices and the retainer amount, because it builds the client page
from the company. The front door was locked and the side door was open. The rule
is §3.10's field level: strip before sending, wherever the figures are gathered.

**A row filter needs applying to the DETAIL route too.** A Member sees only the
clients they are working on. Filtering just the list is decoration — ids are not
secret, they are in every URL that person legitimately visits, so `/companies/:id`
carries the same `OR` clause.

**Rate limits are keyed on the ACCOUNT.** An agency is behind one office IP; a
single per-IP counter meant a few fumbled passwords on a Monday morning locked
out whoever signed in seventh. Ten attempts per email per 15 minutes, with a
loose per-network ceiling of 100 behind it. IPv6 is counted by /64 prefix — a
single machine owns more addresses than any counter can outlast.

**Money crosses the wire as a string** and stays one until `Intl` formats it.

**Dates are computed in the organisation's timezone**, never the server's or the
browser's. `utils/orgDay.ts`, with tests covering daylight saving.

**Document counters only ever move forward.** `doc_counters` is the sole source
of a number and nothing may reset or delete a row. `journey.ts` used to clear
them on cleanup, which rolled the sequence back to zero while documents raised
outside the test were still there — so the next real quotation asked for a
number already taken and came back as a 500. A gap costs nothing; a reused
number breaks the unique index. If it happens again, set each counter to the
highest number actually issued for that scope and period.

**A rule the database enforces still needs a message.** `QuoteRuleError`,
`UserRuleError`, `ProfileRuleError` and `DealRuleError` exist so a broken rule
arrives as a sentence with a 4xx, not as a constraint violation nobody can read.
When you add a partial unique index, add the guard that explains it.

**An organisation's configuration is defined once**, in `src/lib/orgDefaults.ts`.
`bootstrapOrganization` is called by both the seed and `/auth/register`. The seed
used to own its own copy, so a registered organisation got modules and nothing
else — no pipeline, so the board answered "No pipeline configured", and no stage
for a deal to point at. Add a default here, never in one caller.

**Nothing is "sent" unless it left.** `sendMail` returns a result and never
throws, and every caller moves a status only on `delivered: true`. A quotation
marked SENT that never arrived is worse than one still marked draft, because
everybody stops chasing it while the client waits for something that does not
exist. `POST /quotes/:id/send` with `via: FLOWZEN_EMAIL` answers **422** and
leaves the quotation untouched when the mail server refuses.

**Invitations and resets are emailed, and still hand back the link.**
`/users/invite`, `/users/:id/resend-invite` and `/users/:id/reset-link` return
`emailed: true|false` alongside the raw token. The token is in the response
either way, because a screen that hid it on the assumption delivery worked would
leave an admin unable to invite anybody the first time SMTP refused a connection.
Tokens are stored hashed, so a leaked database does not hand over live
invitations. Invites last seven days, resets one hour.

**There is no fallback transport.** The v1 service quietly opened a throwaway
Ethereal mailbox whenever SMTP was unconfigured, so mail "sent" successfully to
an inbox nobody owns — the worst of the three outcomes, because the screen says
delivered and there is nothing to find. Unconfigured now reports
`NOT_CONFIGURED` and the screens fall back to showing the link.

### The web side

**`/auth/me` answers `{ user: … }`.** Passing the envelope to `setAuth` stores an
object with no `role` and no `name`, which hides every nav item that names a role
and renders the avatar as `??` — with nothing in the console, because nothing
threw. Always `setAuth(fresh?.user ?? fresh)`.

**The sidebar lists ONE section at a time**, chosen with the switcher at the top
and remembered in `useModuleStore`. Two independent gates decide an item:
`canSee` (does your role reach it — the ladder) and `inActiveModule` (does it
belong to the section you are in). Both must pass.

> Merging the three sections into one list was tried and reverted. Keep them
> separate: a person selling wants a short list of selling screens, not every
> screen in the product.

`moduleForPath` maps a route to its section. `/clients`, `/settings`, `/profile`
and `/modules` map to `null`, meaning shared, so opening one keeps whichever
section you were already in rather than silently moving you.

**The client page is the same record seen from a different job.** One route,
three shapes, decided by the active module:

| | What it shows |
|---|---|
| **CRM** | the whole record — what they pay, their deals, their people |
| **Revenue** | the commercial record — what they pay, and what they have been billed |
| **PM** | who they are, who to talk to, what is being delivered. **Nothing commercial, and no route from here to the version that has it** |

The module is **not a permission** — it says what the section is FOR. A
salesperson in the delivery section sees the short version too, because in that
moment they are looking at delivery. What their ROLE allows is decided
separately, on the server, and **both gates apply**: an Admin in PM sees no
invoices on this page, and a Member in CRM sees no money on it either.

**The project screens carry no price for any role.** `engagementContext` sends
the TYPE and frequency — retainer work keeps arriving, project work ends, which
is what delivery needs — and the amount is not selected from the database at all.
Whoever needs the number opens the client in CRM or Revenue.

Below Sales, a client's engagements keep their **shape** and lose their
**amount** rather than disappearing. Removing the row answered "nothing running"
for an active client, which is a wrong answer rather than a quiet one.

**Use the components.** A native `<select>` in a screen is a regression — the
shared `Select` is portal-based with search, avatars, flip-up positioning and a
mobile drawer. `Modal` becomes a `Drawer` on a phone, closes on Escape and locks
the page behind it; hand-rolled overlays did none of that.

**Badge tones are named for what they MEAN** — `good` `warn` `bad` `info`
`neutral` — so a status cannot be green on one screen and grey on another.
`COMPANY_TONE` in `ui/badge.tsx` is the single source for a client's status.

---

## Test data currently in the database

**There are two organisations, both kept, and they share nothing.**

| | |
|---|---|
| **EyeLevel** — `admin@eyelevel.local` | the seeded one. Blinkit, one quotation, one invoice |
| **Eyelevel** — `harish.s@eyelevelstudio.in` | the one created by registering. **Filled by `seed:demo`** |

Data never crosses between them, so signing in as one and looking for the
other's clients shows an empty app that is working correctly.

Both carry the full configuration (8 stages, 8 lost reasons, 10 sources, 8
services, 3 modules, 2 custom fields) and both are set to Tamil Nadu, prefix
`EL`, financial year from April. Settings → Tax & numbering edits all of this.

> Both use the prefix `EL`, so the two issue documents with the SAME numbers —
> `EL/QT/2026-27/003` exists in each. Legal, because the unique index is per
> organisation, and confusing if you ever look at both at once. Changing one
> prefix in Settings fixes it; nothing else has to change.

### What `seed:demo` puts in Eyelevel

An agency mid-flight, written out rather than generated — every record exists to
put one specific state on a screen:

- **9 clients** covering every status: 3 active, 1 on hold, 1 project completed,
  1 churned, 3 prospects. Six are in Tamil Nadu and three are not, so both GST
  rules are exercised — CGST + SGST within the state, IGST outside it
- **11 deals** across the whole board, with stage history, so "24 days in this
  stage" is real. One parked, one gone quiet, one lost with a reason
- **6 quotations** — accepted, sent-with-no-reply, declined and draft. Numbers
  span two financial years, which is what a real April-start year looks like
- **6 engagements** — rolling retainers with no end date, a project on 50/50
  terms, one paused, two ended. Nova's price rose at its six-month review, and
  the old figure is still there
- **20 invoices** and their payments: 16 paid, 2 part-paid, 1 overdue, 1 just
  issued — so outstanding and overdue are different numbers, as they should be
- **4 projects, 20 tasks**, including work that is late, due today and sitting
  with a reviewer, so the morning screen is not empty
- **53 timeline entries**, 6 expenses, and 5 notifications

The open deals are owned by whoever signs in, not by a demo account. The
dashboard addresses its stall signals to the deal's OWNER — a warning shown to
the whole team is one nobody acts on — so seeded ownership would leave the real
person looking at three empty cards.

**Four demo team accounts**, password `ChangeMe123!`, one per rung of the ladder
— useful for seeing what a role actually hides:

`priya@demo.eyelevel.local` (Admin) · `arjun@…` (Manager) · `sneha@…` (Sales) ·
`vikram@…` (Member)

**Blinkit**, in the other organisation, is unrelated — created by hand while
testing. Delete it whenever.

The document counters run ahead of the documents that exist. That is correct:
journey runs and reset runs consume numbers, and a counter never goes backwards.

`npx tsx test/journey.ts` creates and cleans up its own data. **Do not pipe it
through `head`** — the broken pipe kills it before cleanup and leaves records
behind.

---

## Suggested order from here

Every screen in the navigation works, so what remains is the list above.
Sending mail is done, so the next one is **the daily scanner** — the bell has
content only because the seed put it there, and nothing keeps it current. After
that PDFs, which is the last thing a quotation is missing.
