# Parity Ledger

**Flowzen vs. the EYELEVEL_OS prototype** — a field-by-field comparison of the live app against the prototype: what's now built to spec, what's still genuinely open, and what's on hold.

**Tally:** 2 open · 2 deferred · 17 fixed this session

---

## Open (2)

Real gaps against the prototype that are still unaddressed — ranked by what's worth doing next.

### 1. No "discount given" tracking
**Area:** Proposals · Client detail — **Priority: do next, quick to build**

The prototype's Proposals screen leads with "Given away this year" — `discountGiven = firstAsk − wonValue` — as a headline KPI, and flags it per client. Flowzen already stores every proposal version, so the data exists; nothing computes or shows the gap between what was first asked and what was actually won.

Straightforward to build: a computed field off `versions[0].value − wonVersion.value`, surfaced as a Proposals-list KPI and a per-deal line.

*Evidence: searched for `discount` across `apps/api/src/routes/*.ts` and `apps/web/.../clients/[id]/page.tsx` — no matches outside one unrelated test-fixture string.*

### 2. Pipeline's "Talking" column is structurally dead
**Area:** Sales pipeline — **Priority: needs a product decision, not just code**

Every real Proposal is created directly at **Proposal sent** — nothing in the app ever creates one at **Talking**. The board still renders a Talking column and a "not yet quoted" stat that will always read 0, while the prototype uses a separate list of pre-proposal conversations to populate exactly that column.

This one needs a call from you: either wire the real `OutreachEntry` model into that column so pre-proposal conversations genuinely show up there, or drop the column and stat — a Proposal can't represent "no proposal yet."

*Evidence: `apps/api/src/routes/proposals.ts:207` — every `POST /proposals` creates the record with `stage: PROPOSAL_SENT`. No code path ever sets `TALKING`. Pipeline's `notYetQuoted` stat filters on that stage.*

---

## Deferred (2)

On hold at your own call, waiting on an LLM provider and API key before there's anything real to build against.

### 1. "Ask the business a question" query box
**Area:** Brief

The prototype's Brief screen has a free-text box that answers questions against the business's own data. No UI exists for this yet — there's nowhere for it to send a question to.

### 2. AI-written Monday brief narrative
**Area:** Brief

The current brief is fully real, computed data — pipeline totals, what's worth knowing per client, month figures — just no natural-language summary stitched over it.

*Evidence: `nodemailer` and `openai` are already in `apps/api/package.json` but unused anywhere in the backend. No `OPENAI_API_KEY` is set.*

---

## Fixed this session (17)

Built, or found already broken and repaired, over this session — every line below was confirmed against the running app, not just the source.

### Sales pipeline
*Verified live via a scripted browser check.*

- **Pipeline cards had no click target at all** — now open the client's Proposals tab. (`pipeline/page.tsx`)
- **Win-probability override was read in two backend places but had no UI to ever set it** — added a per-deal override modal, patches `/proposals/:id/probability`.
- **No stage-to-stage conversion analytics** — built a 3-step funnel (sent → revised → proforma → won) computed from durable facts — version count, a linked proforma, outcome === won — because marking a deal Lost overwrites its `stage` and would otherwise erase how far it got. (`GET /proposals/funnel`)
- **`MoveMenu.tsx`** — a manual stage-mover, fully built but never imported anywhere, contradicting the product's own "stage follows the record, not an opinion" — deleted.
- **The entire Proposal lifecycle** — create, add version, win, lose, raise proforma — had no UI before this session. Built from scratch.

### Retainers & cost accuracy
*Verified live via a scripted browser check.*

- **People allocations were silently excluded from cost totals** — a Project's `actualCostTotal` and a Retainer month card's `directCostsTotal` only summed vendor `Cost` rows, ignoring the `PeopleAllocation` rows fetched right alongside them. Both now include allocation-based people cost, matching the brief's formula. (`projects.ts`, `retainers.ts`)
- **`TaskTemplate` had no way to create, edit, or link one, anywhere** — despite the monthly roll job already fully spawning tasks from it. Built full CRUD, a Setup editor, and a picker on retainer creation. (`taskTemplates.ts`)
- **Retainer + Month Card cockpit** built from scratch — KPIs, tasks/costs/allocations/invoice tabs — including a bug that silently dropped the invoice-to-month-card link on creation.

### Money
*Verified live via a scripted browser check.*

- **Record payment, "+ New invoice," and the Costs tab were dead** — no click handler, a toast-only stub, and placeholder text respectively. All now wired to real modals and a real table.
- **No client-profitability view** — built "Profit & Costs": real revenue / external cost / people cost / margin per client, plus company-overhead and capital/loan cost tables.
- **Two response-shape bugs were silently breaking money data in the browser** — `/invoices` and `/costs` auto-unwrapped to the wrong shape, and the company picker crashed or silently failed in six different "New X" modals. Both fixed.

### Team & access
*Verified live via a scripted browser check.*

- **"Assign" and "Invite" were dead ends on Team** — both wired to real modals.
- **No permission-matrix editor and no salary-editing UI** — despite both being explicit in the brief. Built a per-person access drawer: preset plus extra-permission switches, and monthly cost — modeled honestly as additive-only, matching the real permission-resolution logic that can't revoke a preset default for one person. (`AccessModal.tsx`)
- **Load percentage used a flat "open tasks ÷ 5" baseline** instead of the brief's trailing 8-week median — real median-based calculation now live. (`utils/workload.ts`)
- **"Time split" (`/allocations`) was fully built but missing from the nav entirely** — added.

### Cleanup
*Verified via typecheck + full test suite.*

- **Removed the entire legacy v1 API surface** — old deals/quotes/revenue routes, their orphaned components, and dead command-palette actions.
- **Removed the standalone `/build-spec` page**, as asked.

---

*Method — prototype read in full from `01_APPLICATION_UI.html`; app checked against the running dev server (typecheck, full test suite, and a scripted browser session per fixed area) rather than source alone. All test data and scripts created for verification were removed afterward.*

*Compiled 2026-09-01.*
