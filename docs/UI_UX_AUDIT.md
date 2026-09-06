# UI & UX audit

**4 September 2026** · Flowzen web app (`apps/web`), 23 pages, 59 components, audited against the running local app with 20 companies / 82 tasks / 72 activity rows of real data.

Every finding was reproduced before it was written down — in a browser against the live app, or by a script over the source — and re-verified in the browser after being fixed. The section near the end lists what I checked and found *clean*, because an audit that only reports problems tells you nothing about its own coverage.

The sections below keep the diagnosis in the present tense: they describe the app as it was, which is what makes the fix legible. **Summary** and **What changed** carry the current state.

Two of the fourteen were mine — one a regression from the `/companies` fix a day earlier, one a severity call I got wrong and have corrected in place.

---

## Summary

All twelve are fixed and verified against the running app. Two further bugs
surfaced while fixing, and are fixed too.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Assets tab counts collapse under the filter — the `/companies` bug again | **High** | Fixed — server facets |
| 2 | Activity feed capped at 20 for a whole timeline | Medium *(was High — see correction)* | Fixed — 200 when scoped |
| 3 | Clickable table rows are keyboard dead ends | **High** | Fixed — real links in 5 lists |
| 4 | No pagination controls anywhere in the app | Medium | Fixed — `ShowMore` on the two lists that grow |
| 5 | 30 form controls have no programmatic label | Medium | Fixed — all 30, plus a test |
| 6 | 21 failures handled by `console.error` and nothing else | Medium | Fixed — toasts and error states |
| 7 | Six pages have no error state at all | Medium | Fixed |
| 8 | "Overdue 0" painted danger red | Low | Fixed |
| 9 | "Rest of the week — nothing at risk" is a hardcoded claim | Low | Fixed |
| 10 | Pluralisation: "across 1 tasks" | Low | Fixed — `plural()` at 13 sites |
| 11 | Two different loading languages | Low | Fixed — `TableRowsSkeleton` |
| 12 | Pipeline content runs under the mobile nav | Low | Fixed |
| 13 | **Invoice and proposal rows were styled clickable and did nothing** | Medium | Fixed — found while fixing #3 |
| 14 | Outreach tile counted 7 where `/outreach` showed 5 | Medium | Fixed — my own regression |

### A correction to #2

I first reported the activity cap as "live today, 72 rows truncated to 20".
That was wrong, and the error was mine: 72 is the count across the *whole
organisation*, while the only feed in the app renders **one project's** history
— and the busiest single entity has **9** events. Nothing is truncated today.

The ceiling was still real, so it is still fixed: a request naming one entity
now gets 200, while the unfiltered feed keeps its small page. But the severity
was Medium, not High, and I should have checked the per-entity distribution
before writing the first number down.

---

## 1. Assets tab counts collapse under the filter — **High**

The same defect as `/companies`, in code written three days ago, in a screen where I had already read the tab logic.

[`assets/page.tsx:68`](../apps/web/src/app/(dashboard)/assets/page.tsx#L68) narrows the *fetch* by the open tab:

```ts
if (tab === 'REPAIR') params.status = 'IN_REPAIR';
```

and then [`assets/page.tsx:188-196`](../apps/web/src/app/(dashboard)/assets/page.tsx#L188-L196) counts the tabs from what came back:

```ts
const count =
  t.key === 'ALL'
    ? assets.filter((a) => !['RETIRED','SOLD','LOST'].includes(a.status)).length
    : ...
```

So opening **In repair** leaves `assets` holding only in-repair items, and the tabs then report **All = the repair count** and **Retired = 0**. Choosing a category narrows all four counts to that category as well.

The KPI strip is safe — it comes from a separate `api.assets.summary()` call — so this is the tab row only.

**Invisible today**: the register has 0 assets. It will appear the first afternoon somebody enters kit.

**Fix**: the same shape as `/companies` — have `GET /assets` return facet counts computed without the status filter.

---

## 2. Activity feeds are truncated at 20 rows, with no way to page — **High**

[`activities.ts:131`](../apps/api/src/routes/activities.ts#L131) sets `defaultLimit: 20`. There are **72 activity rows** in the database right now, and no screen sends a `page` parameter or renders a "load more" control.

So every project timeline, client timeline and deal history shows the newest 20 events and simply stops. There is no visual indication that more exist. This is live today, not a future problem.

**Fix**: either raise the limit for the single-entity case (a project's own history is naturally bounded) or add a "Show earlier" control. The endpoint already returns `meta.totalPages`; nothing consumes it.

---

## 3. Clickable table rows are keyboard dead ends — **High**

Five list screens navigate on a row click, and the rows contain **zero** focusable children — no `<Link>`, no `<a>`, no `<button>`:

| Screen | Line | Opens |
|---|---|---|
| Live work — retainers | [`live-work/page.tsx:238`](../apps/web/src/app/(dashboard)/live-work/page.tsx#L238) | a retainer |
| Live work — projects | [`live-work/page.tsx:314`](../apps/web/src/app/(dashboard)/live-work/page.tsx#L314) | a project |
| Money — invoices | [`money/page.tsx:266`](../apps/web/src/app/(dashboard)/money/page.tsx#L266) | an invoice |
| Proposals | [`quotations/page.tsx:210`](../apps/web/src/app/(dashboard)/quotations/page.tsx#L210) | a proposal |
| Companies | `companies/page.tsx` (`router.push` on the row) | a client |

You cannot Tab to a table row. A keyboard-only or screen-reader user therefore **cannot open a company, retainer, project, invoice or proposal from any list in the app** — that is the primary navigation path of the product, and it is mouse-only.

**Fix**: wrap the first cell's text in a real `<Link href>`. The row keeps its click handler for the convenience of a mouse; the link makes the destination reachable, announceable, and middle-clickable into a new tab — which is a mouse-user benefit too.

---

## 4. No pagination controls anywhere — Medium

Every list endpoint paginates ([`utils/query.ts:33`](../apps/api/src/utils/query.ts#L33)), and **no page in the web app sends `page` or `limit`, or renders a next-page control.** A grep for `totalPages`, `setPage` or `nextPage` across `app/` and `components/` returns nothing.

| Endpoint | Cap | Rows today |
|---|---|---|
| activities | 20 | **72 — truncated** |
| assets | 100 | 0 |
| companies, tasks, invoices, costs, projects, proposals, retainers, outreach | 200 | 20 / 82 / 10 / 26 / 10 / 20 / 6 / 7 |

Only activities is over the line today. The structural point stands: at company 201, the list silently stops and — because several screens still derive figures from the rows they hold — the totals stop with it. The `/companies` fix moved that screen's figures server-side; the others have not been moved.

---

## 5. 30 form controls have no programmatic label — Medium

[`components/ui/field.tsx`](../apps/web/src/components/ui/field.tsx) does this correctly: `useId()`, `htmlFor`, `aria-invalid`, and an `aria-live` error region. It is used **226 times**.

Thirty controls are hand-rolled around it, with a visible `<label>` carrying no `htmlFor` and an input carrying no `id`. A screen reader announces them as unlabelled, and clicking the label does not focus the field.

The concentration matters more than the count — **the entire authentication funnel is in the list**:

- [`login/page.tsx:83,108`](../apps/web/src/app/login/page.tsx#L83)
- [`register/page.tsx:74,85,96,109`](../apps/web/src/app/register/page.tsx#L74)
- [`reset-password/page.tsx:77,99`](../apps/web/src/app/reset-password/page.tsx#L77)
- [`accept-invite/page.tsx:79,101`](../apps/web/src/app/accept-invite/page.tsx#L79)

Plus `outreach` (7), `companies/[id]` people form (4), and singles in `allocations`, `assets`, `live-work`, `members`, `TaskTemplatesTab`, `NewProjectModal`, `command-palette`.

Three further hits are hidden file inputs behind a visible button (`ImportAssetsModal`, `ImportClientsModal`, `ImportOutreachModal`) — those are fine as they are.

**Fix**: replace with `<Field>` / `<FieldSelect>`. Most are a one-line swap.

---

## 6. Twenty-one failures are handled by `console.error` and nothing else — Medium

Across 11 files, eleven of them the exact one-liner `} catch (e) { console.error(e); }`. Two distinct problems live in there:

**Loads that fail silently** — [`money/page.tsx:100,109,160`](../apps/web/src/app/(dashboard)/money/page.tsx#L100), [`live-work/page.tsx:106`](../apps/web/src/app/(dashboard)/live-work/page.tsx#L106), [`outreach/page.tsx:100,109`](../apps/web/src/app/(dashboard)/outreach/page.tsx#L100), [`allocations/page.tsx:56`](../apps/web/src/app/(dashboard)/allocations/page.tsx#L56). The screen renders its empty state, so a server error is indistinguishable from "you have no invoices."

**Actions that fail silently** — worse, because the user is mid-task and gets no signal at all:

- [`allocations/page.tsx:67`](../apps/web/src/app/(dashboard)/allocations/page.tsx#L67) — confirming a person's time split
- [`money/page.tsx:118`](../apps/web/src/app/(dashboard)/money/page.tsx#L118) — confirming a cost
- [`outreach/page.tsx:144,156`](../apps/web/src/app/(dashboard)/outreach/page.tsx#L144) — changing status, promoting an entry to a company

Click "Confirm", nothing happens, no error. The natural response is to click again.

**Fix**: `toast.error(...)` on the action handlers — `react-hot-toast` is already wired and used correctly elsewhere in the same files.

---

## 7. Six pages have no error state — Medium

`companies`, `companies/[id]`, `live-work`, `members`, `money`, `outreach`, `quotations` have no `ErrorNote`, no error banner, no `setError`. Related to #6 but distinct: even where a failure *is* caught, there is nowhere on these screens to say so.

`allocations`, `assets`, `brief`, `my-work`, `pipeline`, `profile`, `projects/[id]`, `retainers/[id]`, `settings` all do this properly — the pattern exists, it just is not everywhere.

---

## 8. "Overdue 0" is painted danger red — Low

[`my-work/page.tsx:202`](../apps/web/src/app/(dashboard)/my-work/page.tsx#L202) sets `tone="danger"` unconditionally. Verified in the browser: with zero overdue tasks the figure renders `rgb(168,64,46)` — `--color-danger`.

Zero overdue is the *good* outcome, shown as an alarm. It is also the first thing on the first screen of the app, so it is the first thing everybody sees each morning.

Three other screens get this right and make it conditional — [`members:113`](../apps/web/src/app/(dashboard)/members/page.tsx#L113), [`money:224`](../apps/web/src/app/(dashboard)/money/page.tsx#L224), [`assets:142`](../apps/web/src/app/(dashboard)/assets/page.tsx#L142). The note on the very same tile is already conditional (`counts.overdue > 0 ? oldestOpen : '—'`), so the author knew zero was reachable.

---

## 9. "Rest of the week — nothing at risk" is a hardcoded claim — Low

[`my-work/page.tsx:204`](../apps/web/src/app/(dashboard)/my-work/page.tsx#L204). The note is a string literal. It says *nothing at risk* whether or not anything is at risk — a statement about the data that never reads the data. Either compute it or make it descriptive ("due Thu–Sun").

---

## 10. Pluralisation — Low

Live example on My Work today: **"across 1 tasks"**.

Thirteen sites interpolate a count in front of a hardcoded plural, all of which read wrong at 1:

`my-work:205` tasks · `companies:121` records, `:157-158` retainers · `money:186,206,211` invoices · `quotations:96` records · `assets:101` items · `assets/[id]:338` months · `live-work:261` tasks · `pipeline:396` months

The app already does it correctly in places — `forecast/page.tsx` writes `retainer${count === 1 ? '' : 's'}` — so this is drift, not an absent convention. A small `plural(n, 'task')` helper next to `formatMoney` would settle it, matching how `formatMoney` and `StatTile` were settled.

---

## 11. Two loading languages — Low

Seven detail and settings surfaces use `<PageSkeleton />`. Twelve list surfaces use a bare `Loading…` line inside a table cell. Walking from a list to a detail page changes what "loading" looks like.

Skeletons on the lists too would be the stronger choice — a table's shape is exactly what a skeleton is good at.

---

## 12. Pipeline runs under the mobile bottom nav — Low

At 390 × 844, scrolled to the bottom, a deal card's value overlaps the fixed bottom bar by 4px — measured, `navTop 785` vs element bottom `789`. Pipeline is the **only** one of 14 screens where this happens; the shell's `pb-24` ([`layout.tsx:106`](../apps/web/src/app/(dashboard)/layout.tsx#L106)) clears it everywhere else, and the kanban's own scroll container escapes that padding.

---

## Fixed during this audit

**The outreach tile disagreed with the outreach screen.** Yesterday I replaced a hardcoded `outreachCount: 380` with a real `outreachEntry.count()`. That counted all 7 entries; `/outreach` shows **5**, because [`outreach/page.tsx:160`](../apps/web/src/app/(dashboard)/outreach/page.tsx#L160) hides entries already promoted into Companies — which is right, and matches the tile's own note, "kept out of this list."

Fixed by counting `promotedCompanyId: null` only, with a regression test asserting the filter is applied. My bug, one day old.

---

## Checked and clean

Worth stating, so the coverage is legible:

- **No console errors and no failed or 4xx/5xx requests** across all 14 dashboard screens, logged in as Management. (This was noisy before the earlier permission-guard fix; it is silent now.)
- **No horizontal overflow at 390px** on any of the 14 screens. The tables scroll inside their own containers, as intended.
- **Destructive actions all confirm.** Six real deletions (`removeCost`, `removeMilestone`, `removeProject`, asset `remove`, `removeRow`, template `remove`) go through `useConfirmStore`. The seven that do not are draft-row removals inside unsaved forms and `DeactivateModal`, which is itself the confirmation — correct as written.
- **Icon-only buttons** are labelled; the seven flagged by the sweep are false positives with expression-based labels.
- **Both avatars agree.** I thought the sidebar and header initials differed in a screenshot; the DOM says both are "AF". I misread a low-resolution image.
- **The assets empty state is the best in the app** — icon, headline, a sentence explaining what entering kit gets you, and a primary action. Worth copying to the screens whose empty state is a bare sentence in a table cell.

---

## What changed

**New shared pieces**, each replacing a pattern that had drifted across screens:

| File | What it settles |
|---|---|
| `components/ui/show-more.tsx` | The way to reach row 201, and the row count stated even when nothing is hidden |
| `components/ui/skeleton-loaders.tsx` → `TableRowsSkeleton` | Loading inside a table that already has its head |
| `lib/utils.ts` → `plural(n, noun)` | The count/noun agreement the app wrote out longhand in some places and not others |

**Server-side**, because a count taken from filtered rows can only ever be wrong:

- `GET /assets` returns `counts` computed without the status filter (mirrors the `/companies` fix).
- `GET /activities` gives a named entity 200 rows instead of 20; the general feed keeps 20.
- `GET /outreach` excludes promoted entries — the screen always hid them *after* the fetch, which is what made `meta.total` and the visible row count disagree, and what made the Companies tile read 7 against the list's 5. `?includePromoted=true` brings them back for an export.

**Two bugs found while fixing #3.** The invoice table and the proposals table
both set `cursor-pointer` on their rows with **no click handler at all** — a
mouse dead end, not just a keyboard one. Neither has a detail page to open, so
the false affordance is gone and the client, which does have a page, is now the
link.

**Three new rules in `config/design.test.ts`**, each probed by planting a
deliberate violation and confirming the rule goes red, then removing it and
confirming green:

- every form control carries an accessible name;
- the figure block comes from `StatTile`, not hand-rolled;
- warning *words* use `--color-warning-ink`, not the shape gold.

The accessibility rule needed a real tag scanner rather than `<input[^>]*>` —
`onChange={(e) => …}` contains a `>`, so the regex stops at the arrow and never
sees the `aria-label` after it. That is exactly how the first version of this
audit came to report twenty-one unlabelled controls when several were labelled
perfectly well; the count in #5 is from the corrected scanner.

## Verified

A scripted browser pass against the running app, signed in as Management:

- **Keyboard**: 20 focusable links to `/companies/…` on Companies, 6 to `/retainers/…` on Live work, 10 each on Money and Proposals. Before: zero on all four.
- **False affordances**: 0 pointer-cursor rows remaining on Money and Proposals.
- **My Work**: "Overdue 0" now renders `rgb(22,48,39)` — the normal ink, not `--color-danger` — with the note "nothing late", and "across 1 task" reads singular.
- **Agreement**: Companies tile 5 · Outreach rows 5 · Outreach footer "5 names".
- **Mobile**: no content behind the bottom nav on any of the 14 screens, pipeline included.
- **Clean**: no console errors, no 4xx/5xx.

API 227 tests, web 93, both typecheck clean, production build clean.

## The notification system — audited separately, 4 September

Checked on request after the twelve above. Four findings, all fixed.

### N1. Every role received every alert — **High**

`notifications.ts` was organisation-scoped and otherwise ungated: `router.use(authenticate)` and nothing else. Verified against the live database — the founder, a department head, business development and a designer with only `work.own` each received an **identical** payload of twenty alerts. Among them:

| Rule | Message | Normally gated by |
|---|---|---|
| `PROJECT_OVER_ESTIMATE` | "…has spent past its estimate of **190000**." | `money.figures` |
| `INVOICE_OVERDUE` | client, invoice number, days past due | `money.status` |
| `PERSON_UNDERLOADED` | "Akmal (Founder) is at 20% of a normal load." | `work.team` |
| `PROPOSAL_STALLED` | named client, days stalled | `pipeline.read` |

This is the same leak `activities.ts` had, in a second endpoint. A designer refused `/money`, `/forecast` and every figures gate could read a project's cost estimate and the founder's utilisation out of the bell.

**Fixed**: every one of the 21 scanner rules names the permission its own screen requires, failing closed for a rule nobody has claimed. Asset alerts stay open to everybody, because the register is.

After: Management 44 · Head 34 · BD 11 · Accounts 4 · Employee 0. No message containing a rupee figure reaches anyone without `money.figures`.

### N2. One person's "Mark all read" cleared the badge for the whole company — **High**

`Alert.acknowledgedById` is a single column on a row the organisation shares, and the endpoint wrote the reader's id into it. On the live database **41 of 44** open alerts carried one manager's id — which is why all four roles reported an unread count of exactly 3. It was one shared flag.

**Fixed**: a new `AlertRead` join table, one row per person per alert. `acknowledgedById` keeps its real meaning — the organisation recording that somebody has taken an alert on — which is a different fact from having seen it.

Verified: the Head presses "Mark all read" and goes 34 → 0; the founder stays at 44.

### N3. Thirty-six of forty-four notifications led to a 404 — Medium

The link was built as `` `/${entityType.toLowerCase()}s/${entityId}` ``, which produces a real page for two of the eight entity types in use. Following every one:

| Entity | Old link | Result |
|---|---|---|
| Company | `/companys/…` | **404** — wrong plural |
| Task, Proforma, User, Proposal, Invoice | `/tasks/…` etc. | **404** — no detail page exists |
| Project, Retainer | `/projects/…`, `/retainers/…` | 200 |

**Fixed**: a record with a page opens that record; a record without one opens the screen where you can act on it — a workload alert opens Team, an overdue invoice opens Money, a stalled proposal opens Proposals. Unknown types return `null` rather than a dead link.

### N4. The panel was mouse-only, and its heading was wrong twice — Medium

Rows were `<div onClick>` with nothing focusable inside — the same defect as the tables in #3, in the one surface that exists to tell you something is wrong. The heading read **"In-App Notifications / Real-time activity logs"**: the scanner runs hourly and the bell refetches once a minute, so it is not real-time; and these are rule-raised alerts, not a log of what people did — that is the activity feed, elsewhere.

**Fixed**: rows are real buttons, the bell announces "Notifications, 44 unread" with `aria-expanded`, and the heading reads **"Needs attention / Raised by rule, checked hourly"**.

Verified by keyboard: Tab from the bell reaches "Mark all read", Tab again reaches the first alert, Enter opens `/members` — the right destination for "Sneha is carrying 1000% of a normal load", where the same fact is shown live.

### N5. A row never said what it was about — Medium

Each row carried the sentence and nothing else, so a bell holding forty-four of them read as one undifferentiated column: an overdue invoice, a lens that had not come back and somebody's workload all looked alike until you had read each one.

Every row now carries its source in the house label style — **TEAM · 1d ago**, **PROJECTS · 2d ago**, **MONEY**, **PIPELINE**, **TASKS**, **CLIENTS**, **ASSETS**, **RETAINERS**, **TIME SPLIT**.

The label is derived from the same `entityType` that `linkFor` uses, so what a person reads and the screen they land on cannot drift apart — asserted by a test that walks every notification and checks the label against the destination.

Two things fell out of doing it:

- **The four asset rules had no icon.** They fell through to the generic circle — and asset alerts are the only ones open to an Employee, so every notification a designer could see was a featureless dot. They have the register's own icon now, and `MONTH_CARD_NOT_INVOICED` takes the rupee rather than a warning triangle.
- **The scanner wrote money as a bare number.** "finishes at 454545" against `₹4,54,545` everywhere else in the product. The API had five separate copies of that one-liner — `brief.ts` twice, `companies.ts`, `proformaPdf.ts`, `brief.cron.ts` — and the scanner, the one place a figure is written into a sentence read on a dashboard, had none of them. `utils/money.ts` now holds it. (The other four still have their own copies; worth folding in, not done here.)

### Also corrected while in there

`unreadCount` was counted from the twenty rows fetched, so the badge under-reported the moment more than twenty were unread. It is now a count over everything the person may see. The feed itself carries 50 and reports `total`.

## Suggested order

1. **#3 keyboard dead ends** — the largest group of people affected, and mechanical to fix.
2. **#6 silent action failures** — smallest change, removes a class of "I clicked it twice and it made two" bugs.
3. **#1 assets tab counts** — fix before the register has data, since it is the exact defect already fixed once.
4. **#2 activity truncation** — live today and invisible to the user.
5. **#8, #9, #10** — one afternoon together; all three are on the first screen everybody opens.
6. **#4, #5, #7, #11, #12** — real, none urgent.
