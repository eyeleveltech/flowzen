# Browser-agent test prompt — Flowzen

Paste everything below the line into Strawberry Companion (or any browser-control AI).
It is written to be self-contained: the agent does not need the repo, only the browser.

Before starting, confirm both dev servers are up:
- Web → http://localhost:3000/login should load
- API → http://localhost:4000/api/health should return 200

---

You are a meticulous QA tester with full control of my browser. You are testing a
local web app called **Flowzen** (an agency management system) at
**http://localhost:3000**. Its API runs at http://localhost:4000.

Work through EVERY section below in order. Do not skip sections. Do not stop at the
first bug — record it and keep going. This is a local development database, so you
are allowed to create, edit and delete data freely.

## Ground rules

1. **Name every record you create with the prefix `QA-`** (e.g. company `QA-Zenith
   Motors`, person `QA-Ravi`, task `QA-Landing page copy`). This makes your test data
   identifiable afterwards. Keep a running list of everything you create.
2. **Never delete or edit records that do not start with `QA-`.** The seeded demo data
   must survive the test run.
3. **Verify, don't assume.** After every action, confirm the result actually appeared
   on screen (row added, toast shown, number changed, URL changed). "The button
   clicked" is not a pass; "the record exists on reload" is.
4. **Reload the page after important writes.** A value that only exists until refresh
   is a bug.
5. **Watch for errors continuously.** Keep the browser console and network tab in mind:
   any red console error, any 4xx/5xx API response, any blank screen, any spinner that
   never resolves, any "undefined"/"NaN"/"Invalid Date"/"[object Object]" rendered on
   screen is a bug — report it even if the page otherwise looks fine.
6. **Do not use devtools to fake state.** Only interact the way a human would.
7. **Screenshot every bug** and note the exact URL, the exact steps, what you expected
   and what happened.
8. If something is genuinely ambiguous or you are blocked, note it as **BLOCKED** with
   the reason and move to the next step rather than stalling.

## Logins

All accounts are in the org "EyeLevel Growth Studio". **Every password is written out
below — copy it exactly, including the punctuation.** Note that Harish's password is
different from everyone else's.

### The six accounts the test sections use

| # | Email | Password | Role | Should see |
|---|---|---|---|---|
| 1 | `harish.s@eyelevelstudio.in` | `Harish143@` | Management | Everything — all 12 screens |
| 2 | `akmal@eyelevelstudio.in` | `ChangeMe123!` | Management | Everything — same as Harish |
| 3 | `tanuja@eyelevelstudio.in` | `ChangeMe123!` | Business Development | Companies, Outreach, Pipeline, Proposals — deal values yes, cost/margin no |
| 4 | `dilshad@eyelevelstudio.in` | `ChangeMe123!` | Head, Digital Marketing | My Work, Team, Live work — no money at all |
| 5 | `priya@eyelevelstudio.in` | `ChangeMe123!` | Accounts | Money figures + cost entry, but NOT salaries |
| 6 | `sneha@eyelevelstudio.in` | `ChangeMe123!` | Employee | My Work only |

### The remaining accounts (spares — use if a section asks for a second person of the same role)

| Email | Password | Role |
|---|---|---|
| `janani@eyelevelstudio.in` | `ChangeMe123!` | Head, Design |
| `charles@eyelevelstudio.in` | `ChangeMe123!` | Head, Video & Production |
| `varsha@eyelevelstudio.in` | `ChangeMe123!` | Business Development |
| `ramya@eyelevelstudio.in` | `ChangeMe123!` | Employee (Designer) |
| `shyam@eyelevelstudio.in` | `ChangeMe123!` | Employee (Digital Marketing) |
| `shakila@eyelevelstudio.in` | `ChangeMe123!` | Employee (Digital Marketing) |
| `naif@eyelevelstudio.in` | `ChangeMe123!` | Employee (Developer) |
| `vikram@eyelevelstudio.in` | `ChangeMe123!` | Employee (Developer) |

**Do not change any of these passwords during the test run** — you will lock yourself
out of the remaining sections.

Sign out via the sidebar's sign-out control between roles. **Ignore the "Continue with
Google" button entirely** — it is not configured locally. Use the email + password form.

---

# SECTION 1 — Login and auth boundaries

1. Go to http://localhost:3000. Note where an unauthenticated visitor lands.
2. While logged out, type these URLs directly into the address bar one at a time:
   `/money`, `/settings`, `/members`, `/companies`, `/brief`, `/allocations`.
   **Expected:** every one bounces you to the login screen. Any page that renders real
   data while logged out is a **critical** bug.
3. Log in with a wrong password. **Expected:** a clear inline error, no crash, no
   redirect.
4. Log in as `harish.s@eyelevelstudio.in` / `Harish143@`. **Expected:** you land on
   My Work.
5. Reload the page. **Expected:** you stay logged in, not thrown back to login.
6. Check whether the login screen offers a "forgot password" link, and whether
   `/reset-password` and `/register` load. Report what each one actually does — if a
   link leads to a page that cannot complete, say so.

# SECTION 2 — Navigate every screen as Management

Still as `harish.s@`. Visit each of these in turn and, for each one, report: does it
load, how long does it take, is it empty or populated, any console/network errors,
anything visually broken (overlapping text, cut-off tables, buttons off-screen).

`/my-work`, `/members`, `/companies`, `/outreach`, `/pipeline`, `/quotations`,
`/live-work`, `/brief`, `/money`, `/forecast`, `/allocations`, `/settings`, `/profile`

Also open one record of each kind by clicking into it from its list: a company, a
project, a retainer/month card. Report broken detail pages.

# SECTION 3 — The main journey, part 1: cold name → company (as BD)

Sign out and log in as `tanuja@eyelevelstudio.in` / `ChangeMe123!`.

1. First, note which sidebar items Tanuja can see. Then try typing `/money` and
   `/settings` into the address bar. **Expected:** she is refused (blocked page or
   redirect), NOT shown the data. Being merely hidden from the nav but reachable by URL
   is a **critical** bug — report it.
2. Go to `/outreach`. This is a list of cold, scraped names — deliberately separate
   from real companies. Note the total count.
3. Pick any row and click **Mark as replied**. A dialog appears asking who replied —
   fill the contact name in as `QA-Ravi` and confirm.
   **Expected:** the row leaves the outreach list, and a real Company is created with
   status **Prospect**. A toast should link to it.
4. Go to `/companies` and confirm that company now exists there with status Prospect.
   Reload to confirm it persists.
5. Now create a second company the other way: on `/companies` click **+ New** and make
   `QA-Zenith Motors`.
   **Expected:** it is created. (Note: this path also auto-creates a placeholder ₹0
   proposal in the pipeline's "Talking" column — that is intended, not a bug.)

# SECTION 4 — The company record

Open `QA-Zenith Motors` (`/companies/[id]`). It has four tabs: **Overview & People**,
**Proposals**, **Invoices & Proformas**, **Audit Trail**.

1. On Overview & People, click **Add Person** and add `QA-Meera` with the role
   **Approver**. Confirm she appears in the list and survives a reload.
2. Try adding a person with an empty name, and with a clearly invalid email like
   `abc@`. **Expected:** validation stops you with a readable message — not a silent
   failure and not a 500.
3. Open **Audit Trail**. **Expected:** it lists the create/update events you just
   performed (company created, person added), with who and when. If your actions are
   missing from the audit log, that is a bug.
4. Click through the other two tabs and confirm they render (they will be empty for now).

# SECTION 5 — Proposal → versions → proforma → won

Stay on `QA-Zenith Motors`, Proposals tab. This is the core money flow — test it slowly.

1. Click **+ New Proposal**. Choose kind **Project — one time, start and end**, value
   `500000`, and save.
   **Expected:** a proposal is created at stage **Proposal sent** automatically. There
   should be NO dropdown anywhere letting you set the stage by hand. If you find one,
   report it.
2. Open `/pipeline`. **Expected:** the same proposal appears as a card in the
   **Proposal sent** column, tagged "One time". Confirm the card shows the company name
   and value.
3. Back on the Proposals tab, click **Add version** and enter a lower value, `450000`.
   **Expected:** version 2 is created and **version 1 is still visible and unchanged**.
   If version 1's value was overwritten, that is a serious bug.
4. Click **Raise proforma**. Fill in a billing name, a GSTIN (`29ABCDE1234F1Z5`), a GST
   rate (18), and a description. Save.
   **Expected:** a proforma is created with its own number (format like
   `EL/PI/26-27/001`) and the proposal's stage moves to **Proforma issued** by itself.
5. Open the proforma's **PDF** from the Invoices & Proformas tab. Check carefully:
   - Does the CGST/SGST split match the 18% you entered (9% + 9%)?
   - Do the terms shown match what you typed?
   - Is the total arithmetic correct?
   - Are the company name, GSTIN and description the ones you entered?
   Report any figure on the PDF that does not match what you entered.
6. Go back to `/pipeline` and try dragging the card straight to **Won** skipping stages,
   and to **Verbal yes**. **Expected:** invalid moves are refused with an explanation,
   not silently accepted. Report exactly which drags were allowed and which were
   refused.
7. Drag it to **Verbal yes** (valid now that a proforma exists), then mark version 2 as
   **Won**.
   **Expected, all at once:** the proposal shows outcome Won, and the **company's status
   flips from Prospect to Client by itself**. Reload and confirm. If you had to set
   "Client" manually anywhere, report it.
8. Confirm the company page now offers **Create project from this** (because the kind
   was Project). Confirm the won value carried across.

# SECTION 6 — Repeat the flow for a Retainer

Do the same on the FIRST company (the one promoted from Outreach in Section 3), but
choose kind **Retainer — ongoing monthly work**, value `75000/month`. Take it all the way
to **Won**.

**Expected:** after winning, the company offers **Create retainer from this** — not
"create project". If the button offered does not match the proposal kind, that is a bug.

# SECTION 7 — Delivery: project and retainer

Sign out; log in as `harish.s@eyelevelstudio.in` / `Harish143@` (BD cannot manage
delivery).

1. On `QA-Zenith Motors`, click **Create project from this**. Choose the **Standard**
   billing pattern (40% advance / 30% design sign-off / 30% launch).
   **Expected:** the project is created with three milestones whose amounts add up
   exactly to the won value. Check the arithmetic — report it if the milestones don't
   sum to the total.
2. Open the project at `/projects/[id]`. Confirm value, company and milestones are right.
3. Open `/live-work` → **Projects** tab. Confirm your new project is listed. Change the
   status filter from "Live" to "All statuses".
   **Expected:** Delivered/Cancelled projects appear in the table, but the **KPI cards
   above the table do not change** (they stay pinned to live work). If the KPIs move
   when you change the table filter, report it.
4. On the other company, click **Create retainer from this** and deliberately leave the
   **term (months) blank**.
   **Expected:** it is allowed, but it should later raise a risk alert called
   `RETAINER_NO_CONTRACT` (you will check alerts in Section 11).
5. Open the retainer at `/retainers/[id]`. Report whether a month card for the current
   month exists. (A background job creates these — if none exists yet, note it as an
   observation, not a bug.)

# SECTION 8 — Tasks and the clock

1. From the project page, click **+ Task**. Create `QA-Landing page copy`, assign it to
   **Sneha**, set a due date a few days out.
2. Create a task from two other entry points and confirm all three produce the same kind
   of record:
   - the global **Quick Create → New task**
   - **Team (`/members`) → Assign**
3. Sign out; log in as `sneha@eyelevelstudio.in` / `ChangeMe123!`.
   - **Expected:** she sees My Work and essentially nothing else. Try `/money`,
     `/members`, `/live-work`, `/pipeline` by URL. Every one must refuse her. Report
     ANY screen she can reach that shows other people's work or any money figure.
   - Open `/my-work`. Confirm `QA-Landing page copy` is there and shows elapsed time
     (a clock nobody had to start).
   - Set the task to **On hold**, waiting on **Client**. Confirm the UI reflects that.
   - Set it back to In progress. **Expected:** the time it spent waiting is preserved,
     not lost.
   - Add a note to the task.
   - Mark it **Done**. Then **reopen** it. **Expected:** a reopen count increments and
     is visible somewhere. If reopening silently loses history, report it.
4. Report exactly what actions Sneha can perform on My Work. The design intent is only
   three: change status, add a note, create a task for herself. Anything beyond that is
   worth flagging.

# SECTION 9 — Costs, invoices and payment

Log back in as `harish.s@eyelevelstudio.in` / `Harish143@`.

1. On the project, click **+ Cost**. **Expected:** the very first field is the cost
   **type** — Direct / Company / Capital. Choose **Direct**, a category, amount `40000`.
   Save and confirm it appears against this project.
2. Add a **Company** (overhead) cost of `10000` as well.
3. Go to `/money` (or the project page) and click **+ New invoice**. The invoice number
   is typed by hand on purpose — enter `QA-INV-001`, an amount, and a due date **in the
   past**.
4. Click **Record payment** on it and mark it paid. Confirm the status changes and
   persists after reload.
5. Create a second invoice `QA-INV-002` and **cancel** it. Then try to record a payment
   against it. **Expected:** the record-payment action is not available at all on a
   cancelled invoice. If you can pay a cancelled invoice, that is a bug.
6. Try to create an invoice with a negative amount, and one with a blank number.
   **Expected:** both are rejected with a readable message.
7. Open **Money → Profit & Costs** and find `QA-Zenith Motors`. Check the arithmetic:
   `profit = revenue − direct cost − people cost`. **The company overhead cost you added
   must NOT be subtracted from this job's profit** — overheads belong only to the
   company-wide figure. If the ₹10,000 overhead reduced this job's profit, report it.

# SECTION 10 — Role-based money masking (do this carefully)

This is the most important security section. For each role below, log in and check both
what is *shown* and what is *reachable*.

1. **`priya@eyelevelstudio.in` / `ChangeMe123!` (Accounts):** she should see money figures. Go to `/money` and confirm.
   Then go to `/members` and `/settings` and check whether **any staff salary /
   monthly cost figure** is visible to her. **Salaries must be admin-only, tighter than
   money access.** If Priya can see anyone's salary, that is a critical bug.
2. **`dilshad@eyelevelstudio.in` / `ChangeMe123!` (Head):** open `/members` — load bars, overdue counts, average close
   times, and **no money at all**, not even masked-looking placeholders. Then open
   `/allocations` (Time split). **Expected:** he confirms percentage splits only — there
   must be no rupee figure anywhere on that screen. Scan the whole page carefully,
   including tooltips and hover states. A rupee value here leaks salaries.
3. **`tanuja@eyelevelstudio.in` / `ChangeMe123!` (BD):** she may see deal values, but must not see cost or margin
   anywhere. Check the company pages and pipeline for any cost/profit figure.
4. For each of these three, pick one URL they should NOT reach and enter it directly.
   Report the exact behaviour (blocked page, redirect, or — bad — real data).

# SECTION 11 — Alerts, brief and forecast

As `harish.s@eyelevelstudio.in` / `Harish143@`:

1. Find where risk alerts are displayed (check `/brief` and the dashboard/home area).
   List every alert currently firing.
2. You created a retainer with no term in Section 7 and an overdue invoice in Section 9
   — check whether `RETAINER_NO_CONTRACT` and `INVOICE_OVERDUE` (or similarly named
   alerts) appear. They are generated by a background scan, so if they are not there
   yet, note it as "not yet scanned" rather than a bug.
3. You marked `QA-INV-001` paid. If an overdue alert exists for it, confirm it clears
   itself rather than needing manual dismissal.
4. Open `/brief`. **Expected:** four quadrants — contract risk, pipeline momentum, money
   owed, team capacity — filled with real numbers, not placeholders. Report any quadrant
   showing zero/empty when you know data exists.
5. Open `/forecast`. **Expected:** retainer revenue and one-time revenue are shown
   **separately and never added into a single total**. If you find one combined figure,
   report it. Then use the **"what if"** picker to force an open deal to "assume won" —
   the projection should change, but go back to the pipeline and confirm the actual
   proposal's real state was NOT modified.

# SECTION 12 — Admin, settings and trash

As `harish.s@eyelevelstudio.in` / `Harish143@`, open `/settings`.

1. **Permission matrix:** flip one permission OFF for `sneha@` only. Confirm no other
   person's row changed. Log in as Sneha, confirm the effect is real, then log back in
   as Harish and **switch it back on**. Do NOT change Harish's or Akmal's own
   permissions — you could lock yourself out.
2. **Task templates:** create `QA-Template`, then soft-delete it.
3. **Numbering** and **Mail (SMTP)**: open both, confirm they load and show current
   settings. Do not send a test email unless the screen makes clear it is safe.
4. **Trash:** confirm your deleted `QA-Template` is listed. Click **Restore**.
   **Expected:** it genuinely comes back in the task templates list — not just
   disappears from the trash view. Go and verify it is back.
5. Confirm nothing in this app hard-deletes: anything you delete should be recoverable.

# SECTION 13 — General robustness sweep

1. **Browser back/forward:** navigate several screens deep, then use back and forward
   repeatedly. Report any blank page, stale data, or crash.
2. **Deep links:** copy a project URL, open it in a fresh tab. It should load directly.
3. **Empty states:** find at least two lists with no data and report whether they show a
   helpful empty message or just a blank area.
4. **Long input:** paste a 300-character name into any text field and save. Report if it
   breaks the layout or errors unhelpfully.
5. **Double-submit:** click a save button twice quickly. Report if it creates two records.
6. **Narrow window:** resize the browser to roughly phone width (~400px) and visit
   `/my-work`, `/companies` and `/money`. Report anything unusable — off-screen buttons,
   horizontal scroll, overlapping text.
7. **Search / command palette:** if there is a global search or ⌘K/Ctrl+K palette, search
   for `QA-Zenith` and confirm it finds the company, and that clicking the result
   navigates correctly.

---

# Do NOT report these — they are known and deliberate

- **No AI features anywhere.** No "ask a question" box, no AI-written text. The Monday
  brief's wording is template text on purpose.
- **The pipeline's "Talking" column is almost always empty.** Only a directly-created
  company puts a placeholder there.
- **No "discount given" figure** anywhere, even though proposal versions are stored.
- Invoice numbers are typed by hand and the app never connects to Tally — that is
  intended, not missing integration.
- The Google sign-in button not working locally.

---

# Final report format

When you have finished all 13 sections, give me one report with:

**A. Summary** — how many sections passed cleanly, how many bugs found, split by
severity.

**B. Bug list**, most severe first. For each:
- Severity: **Critical** (data loss, wrong money figure, or someone seeing data their
  role must not see) / **High** (a core flow cannot be completed) / **Medium** (works but
  wrong or confusing) / **Low** (cosmetic)
- Screen + exact URL
- Numbered steps to reproduce
- What I expected vs what actually happened
- Screenshot
- Any console error or failed network request that accompanied it

**C. Things that worked** — a short list, so I know what you actually verified rather
than skipped.

**D. UX observations** — anything that worked correctly but would confuse a real user:
unclear labels, missing confirmation, no feedback after an action, a screen where you
could not tell what to do next. Be honest and specific here; this is as valuable as the
bug list.

**E. Test data you created** — the list of `QA-` records, so I can clean them up.
