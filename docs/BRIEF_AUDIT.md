# Brief Audit — Frontend Focus

**Flowzen vs. `docs/PROJECT_BRIEF.md`** — full re-read of the brief (all 795 lines), re-verified against current code. This version records the state after a full build-out pass that closed every gap the audit below found, except the AI-scope items deliberately deferred per the brief's own Stage 7 sequencing.

**Method:** three parallel research passes — (1) all 12 screens + 3 detail views + 9 forms against §10, (2) §11 core workflows and §16 NFRs re-verified line by line against the stale audit's claims, (3) alerts UI, soft-delete UX, AI scope (§15), and the out-of-scope check (§18) — cross-checked against `apps/web/src` and `apps/api/src` with file:line citations throughout. Every item below was then either fixed or explicitly deferred by user decision.

---

## Fixed during the audit (bugs, not gaps)

1. **Salary leak to Accounts-preset users on Time Split.** `apps/api/src/routes/allocations.ts` gated `monthlyCost`/`salaryCost` behind `money.figures`, which the `ACCOUNTS` preset holds without `setup.admin`. §6 requires `User.monthlyCost` to be "readable only with `setup.admin`." **Fixed** — now gated on `setup.admin`, matching `team.ts`/`projects.ts`.
2. **Stale, incorrect delete-confirmation copy on Project.** Told users deletion was permanent; the route had already become a soft delete this session. **Fixed** — copy now accurate.

---

## Confirmed FIXED since the stale (2026-09-01) audit

- Meeting logging 400s, Allocation Confirm button 404s, Outreach → Company manual promotion, PeopleAllocation proposed→confirm workflow, CSV export dead code (8/9 lists), notification bell icon/severity mismatch, alerts never auto-resolved, soft delete added to Cost/Project/TaskTemplate — all verified fixed, all still holding after the build-out pass below.

---

## Built this session — every "still pending" item from the prior audit

1. **Project cost-breakdown-by-person** — new "People" tab on Project detail (`apps/web/src/app/(dashboard)/projects/[id]/page.tsx`), reading the `allocations` the backend already returned, grouped by person with a computed rupee cost (masked to `—` for anyone without `setup.admin`, same as the salary fix above).
2. **Post-creation milestone editing** — full CRUD: `POST/PATCH/DELETE /projects/:id/milestones[/:milestoneId]` (`apps/api/src/routes/projects.ts`), gated on `work.all`, locked to `PENDING` milestones only (billing history is immutable once a proforma is raised, matching ProposalVersion's own "immutable once sent" rule). Frontend: add/edit modal + delete button on the Milestones tab.
3. **Live-work risk flags** — `GET /projects` now joins each project's open `Alert` rows (`PROJECT_OVER_ESTIMATE`, `PROJECT_BEHIND_SCHEDULE`, etc.) and Live-work renders them as badges; retainers now render the backend's real `isExpiringSoon` (45-day, matching `RETAINER_EXPIRING`) and `noFixedTermRisk` flags instead of a client-side 30-day approximation.
4. **Task elapsed time vs. type median** — new shared `apps/api/src/utils/taskTypeMedian.ts` (factored out of the `TASK_AGING` rule so both mean the same "median"), wired into `GET /tasks/my`. My Work now shows "took 3h (usually ~2h)" wherever a same-type baseline exists.
5. **Proforma register CSV export** — Proposals page's export button now targets `/proformas?format=csv` when the Proformas tab is active.
6. **Cost delete UI** — wired into both the Project detail Costs tab and the Money page's cost register, calling the existing (already-gated) soft-delete route.
7. **Restore/trash view** — new Setup → Trash tab (`apps/web/src/app/(dashboard)/settings/components/TrashTab.tsx`) plus `GET .../trash` + `POST .../:id/restore` on Project, Cost, and TaskTemplate, all `setup.admin`-gated.
8. **Two broken buttons** — removed rather than "fixed forward": Setup's "Lists" tab (Pipeline stages/Services/Lost reasons/Lead sources) was 100% non-functional dead UI backed by hardcoded stub arrays, not a real data model, and editable "Pipeline stages" would have directly violated brief principle 3 (stage is derived, never typed) — deleted the tab, `ConfigList.tsx`, and the dead `api.config.post/patch/delete` helpers. Also removed a dead `Company`/`Person` delete-route frontend call that pointed at a route that (correctly, per the brief) was never built.
9. **Mobile responsiveness** — full pass: every fixed 3/4-column stat grid now collapses to 1 column on phone; every data table gained a real `overflow-x-auto` scroll container (the outer rounded/bordered box keeps `overflow-hidden` for the corner radius, an inner div scrolls); every list-page header's button row now wraps instead of forcing the page wider; the two detail-page tab bars (`w-fit`) got `max-w-full overflow-x-auto` so they scroll instead of overflowing. Verified empirically (Puppeteer, real `scrollTo`/`scrollX` check, not just CSS inspection) at a 375px viewport across all 13 top-level screens plus Project/Retainer/Company detail views — zero horizontal page scroll anywhere.
10. **Build spec in-app** — new `/build-spec` screen (Setup-admin nav item), a small dependency-free Markdown-to-React renderer (`apps/web/src/components/BriefMarkdown.tsx`) scoped to exactly what the brief's own markdown uses, served by `GET /brief-doc` reading `docs/PROJECT_BRIEF.md` live. Verified: all 21 headings, 28 tables, and 20 internal anchor links render correctly with real heading `id`s matching the doc's own Contents section links.
11. **Money "Company profit" figure** — §8's `allRevenue − allDirectCost − salaries − overheads`, assembled from data the Profit tab already fetched (`profitTotals` + `overheads`) into one explicit card, closing the brief's "the company's actual month" requirement.
12. **Forecast "what if per deal"** — `GET /forecast/3-month?assumeWon=<proposalId>` forces one proposal's pipeline contribution to its full value; the frontend offers a deal picker and shows the net-cash-flow delta per month.

### Deliberately deferred — user decision, not an oversight

13. **All of §15 AI scope** (Monday brief prose, ask-box, draft generation, expense auto-categorization) — the brief's own Stage 7, meant to come last after Stages 1–6 are in daily use, and the only items here needing a real LLM provider/API-key decision. User chose to skip this for the current pass; nothing else in the build required that decision.

---

## Confirmed complete — matches the brief, nothing further needed here

- **Screens**: all 12 + 3 detail views render real data, including the session-approved real-drag-triggers-real-action deviation on Pipeline (§18's no-dragging rule stays intact — dragging never writes a stage directly).
- **Setup**: all sub-areas are real working UI, now including Trash and Build spec.
- **Forms**: all 9 brief-required forms exist, are reachable, and are coherent.
- **Rules/alerts engine**: severity color-coded, icon map matches real rule names, auto-resolve works, risk flags now surfaced everywhere the brief names a screen that should show them.
- **§18 out-of-scope check**: no subtask/checklist UI, no multiple proposal tiers, no client-portal surface — confirmed compliant.
- **Mobile (§16)**: confirmed compliant app-wide, not just on My Work.

---

*Compiled 2026-09-01, updated 2026-09-02 after the full build-out pass. Both API and web apps typecheck clean; the full API test suite (88 tests) passes; every fix was live-verified in a running browser session, not just read from source.*
