# Flowzen — Product Gap & UX Audit (2026-07-30, updated 2026-07-31 after fixes)

Three-angle audit: (A) compliance with the owner's standard (`corrections.md`, 65 items),
(B) user-journey friction found by walking the code, (C) feature gaps vs industry tools
(HubSpot/Pipedrive · Asana/ClickUp · Zoho-lite). Every finding is code-verified with file references.

---

## ✅ FIXED 2026-07-31 — pushed to main as `00ad3bd`

Six of the audit's highest-impact findings are closed (details struck through in the body below):

| Fixed | What changed |
|---|---|
| **B1 — stage modal on every drag** | Stages that ask for nothing (→ Outreach, → On Hold, backward → New Lead) commit **instantly** on drag / stage-menu / detail-select. Skipped stages no longer pile up intermediate fields — the destination stage defines the form. Won/Lost/Active keep their full forms. |
| **B3 — Quick Create "New Lead" dead end** | `?create=true` honored at pipeline page level — the header "+" opens the Add Lead modal from any tab; param cleaned after open. |
| **B10 — two invoice pages, wrong CTA** | `/invoices` (read-only twin) now redirects to `/invoice-drafts`; duplicate nav entry removed; Quotations' "Move to Invoice Draft" lands on the editable screen. |
| **B13 — invoice locked forever after PDF** | Root cause fixed: generating the PDF no longer force-flips DRAFT→SENT. Drafts stay editable + regenerable (file overwritten, Download always latest) until an explicit **Mark Sent** — then the FZ-037 lock applies. |
| **B14 — command palette dead links / no keyboard / leads unsearchable** | Task links fixed (`?taskId=`), real ↑↓/↵/Esc navigation with visible highlight, **leads + quotation numbers indexed** in global search (admin+CRM gated — also closes roadmap item C-1). |
| **QA partials batch** (same push) | FZ-048/051/054/067/073/077/097 + payments-status endpoint + prod seed guard — see BUGS_UPDATED.md (97/98). This also closed B-list items 11-partial (receivables still pending month view), the fake-PAID auto-billing, and report-total corruption (B-adjacent FZ-073). |

**Week 1 is now closed.** The last two items — the dead time-tracking UI and the corrections
one-liners (#53 / #10) — are done. Everything remaining is Sprint 2 or later; the receivables
month view (B11) is the highest-value of those and stays the owner's core unanswered question.

---

## A. Against our own standard — corrections.md scorecard

**51 DONE · 10 PARTIAL · 2 OPEN · 2 N/A** (~78% implemented — the doc's all-OPEN status column is
badly stale; it should be updated so Akmal sees real progress).

### Highest-impact remaining items
| # | Item | State | Gap |
|---|---|---|---|
| 61 | **Won→Active "Contract Closed" gate** | PARTIAL | Owner asked for a MANDATORY check; today it's an advisory banner, all fields optional (`stage-config.ts:12-15`). Deals can go Active — auto-creating revenue records — without a signed contract. |
| 34 | **Add Column "+" from ALL DB fields** (marked TOP PRIORITY) | PARTIAL | "+" toggles only ~6 hardcoded columns, not every captured field. |
| 33 | **View Settings panel** (the other TOP PRIORITY) | PARTIAL | Panel exists but no Filters/Sort-by inside it, no manage-sharing, no true multiple saved views, absent on pipeline. |
| 29 | Manager sees own team's tasks | PARTIAL | Managers see the whole org default-filtered to self; the team-scoped rule isn't built. |
| 41/42 | Advance + with/without-tax retainer capture | PARTIAL | `advanceAmount` / `taxIncluded` exist in the schema but **no UI exposes them** — the monthly money picture can't actually be recorded. |
| 39 | Drive Link on tasks | DONE | Implemented in API schema, Task forms, and Detail drawer. |
| 57 | Proposal auto-link + 14-day validity | PARTIAL | No backend automation sets validity/expiry. |
| 26 | Custom fields on tasks | OPEN | No custom-field capability anywhere. |
| 53 | LinkedIn still asked in Edit Lead | PARTIAL | One-line removal (`EditLeadModal.tsx:125`). |
| 10 | Client Overview hides captured fields | DONE | Surfaced gstNumber, state, assetLinks, and contractValue on Overview tab & Edit modal. |

(#18 "Client Payment in CRM" is formally OPEN but looks superseded by the Revenue-module decision — confirm with Akmal before building.)

---

## B. What users actually hit — top friction by role

### The sales rep (works the pipeline 30×/day)
1. ~~Stage modal interrupts every forward drag~~ — **FIXED `00ad3bd`**: no-input stages (→ Outreach, → On Hold, backward) commit instantly on drag/menu/select; skipped stages ask only the destination stage's fields (`stageNeedsTransitionInput` in stage-config.ts).
2. ~~Lead form loses everything on a misclick~~ — **FIXED**: Wired `useModalSafety` to `EditLeadModal` (backdrop, X, Cancel, focus trap, dirty-guard) and closed the Cancel button safety gap in `LeadModal`. Relaxed lead validation in client forms, API `leadSchema`, and bulk import to require `contactName` + (`contactEmail` OR `contactPhone`).
3. ~~Quick Create → New Lead dead end~~ — **FIXED `00ad3bd`**: `?create=true` handled at pipeline page level, opens the Add Lead modal from any tab; param cleaned after open.
4. ~~The kanban has zero search/filter~~ — **FIXED**: Search input (300ms debounced) + Owner `MultiSelect` filter added to Kanban header in `PipelineBoardView.tsx`; per-column totals, weighted deal values, counts and drag-and-drop all reflect filtered state.
5. **MED — Won celebration shows stale data** on the board path (pre-transition lead passed, no client attached; Create Project loses the prefill) (`PipelineBoardView.tsx:272`).

### The team member (delivery)
6. ~~Time tracking display-only~~ — **OWNER DECISION (2026-07-30): no employee time tracking.** Due time is the accountability mechanism; prompting for hours discourages the team. Resolution is to REMOVE the dangling time UI (⏱ chips, "logged hrs" in Reports, the never-called TimeTrackingPrompt), not wire it up.
7. **MED — Managers' Tasks page silently self-filters** (`tasks/page.tsx:152-157`) — "where did my team's tasks go?" week-one confusion; needs a visible My/Team toggle.
8. **MED — Mobile swipe-right instantly completes a task, no undo** (`tasks/page.tsx:994`).
9. **MED — Board view vs pagination**: kanban renders only loaded pages; column counts lie until you spot the "Load More" button *below* the board.

### The owner (money)
10. ~~"Invoices"/"Invoice Drafts" duplicate pages + wrong CTA~~ — **FIXED `00ad3bd`**: `/invoices` redirects to `/invoice-drafts`, duplicate nav entry removed, Quotations CTA lands on the editable screen.
11. **MED-HIGH — Receivables can't answer "who owes me this month"** (corrections #40): flat lifetime table, no month filter, no totals row, no due dates, rows not clickable; Payments page similar. This is the owner's core question.
12. ~~Money pages render fake empty states on error~~ — **FIXED**: `ErrorPanel` + retry mechanism added to all 7 money pages (receivables, payments, invoice-drafts, contracts, subscriptions, expenses, PnL) following the reference pattern in `revenue/page.tsx`.
13. ~~Invoice draft locks forever after PDF generation~~ — **FIXED `00ad3bd`**: generating no longer force-flips DRAFT→SENT; Edit + Regenerate stay available until an explicit "Mark Sent" (FZ-037 lock applies only then).

### Everyone
14. ~~Command palette dead links / no keyboard / CRM unsearchable~~ — **FIXED `00ad3bd`**: task links use `?taskId=`, real ↑↓/↵/Esc navigation with visible highlight, leads + quotation numbers indexed in `/api/search` (admin+CRM gated).
15. ~~No modal safety anywhere~~ — **FIXED**: `useModalSafety` hook added (Escape key, dirty-guard confirmation via `useConfirmStore`, focus trap, focus restoration on unmount); adopted in LeadModal, StageTransitionModal, QuoteFormModal & TaskFormDrawer (B2/B15).
16. ~~Per-keystroke API refetch with full skeleton swap~~ — **FIXED**: 300ms debounce via `useDebouncedValue` + `placeholderData: (prev) => prev` across all 5 search surfaces (tasks/projects/clients/leads/quotes).
17. ~~Refetch-the-world after every mutation~~ — **FIXED**: Split `useDashboardData` into 11 per-widget queries (`stats`, `activity`, `deadlines`, `velocity`, `my-tasks`, `lead-tasks`, `status-distribution`, `team-workload`, `pending-approvals`, `client-health`, `my-projects`), removed 60s auto-polling, mapped SSE events to targeted slice invalidations, and added ~250ms debouncing.
18. ~~IST date-shift bug pattern~~ — **FIXED**: Shared `toDateInput` helper added to `utils.ts` (using `date-fns` `format` in local timezone); replaced 25 UTC `toISOString()`/`substring()` date-input call sites across 9 files.
19. ~~Notifications capped at latest 10 forever~~ — **FIXED**: Removed `.slice(0, 10)` limit in `top-nav.tsx` so all notifications fetched from API (up to 50) render in scrollable drawer/dropdown panels.
20. **MED — Hidden-but-navigable role gaps**: PM hitting `/pipeline` by URL gets a silently empty board; Revenue pages have no client-side guard and show fake-empty tables to non-authorized navigators.
21. **MED-HIGH — New org sees a wall of zeros**: no onboarding checklist; the projects desktop table has NO empty state at all (header-only blank table, `projects/page.tsx:452`).

---

## C. Feature gaps vs the market (what agency users expect and won't find)

| Gap | Severity | Evidence / note |
|---|---|---|
| **No email to clients** — marking a quote SENT sends nothing; email is transactional-only (reset/invite/digest) | HIGH | `services/email.ts`; no mail call in `quotes.ts` |
| ~~Leads not in global search~~ — **FIXED `00ad3bd`**: leads (company/contact/email/phone/leadId) + quotes (doc number/client) now indexed, role-gated | ✅ | `search.ts` |
| **No file attachments** anywhere — URL strings only (driveLink/folderLink/assetLinks/receiptUrl) | HIGH | no multer/S3 in API; only server-generated quote PDFs |
| ~~TimeEntry/rates~~ — **rejected by owner**: no employee time tracking; due dates drive accountability | N/A | decision 2026-07-30 |
| **Workflow engine is PM-notifications-only** — no lead-stage triggers, no auto-assign/round-robin; `CHANGE_TASK_STATUS`/`REASSIGN_TASK` are dead enum values | MED-HIGH | `workflowEngine.ts:42-74` |
| **Recurring billing mints payment rows, not sendable invoices** | MED-HIGH | `processSubscriptionBilling` creates PENDING payments; no invoice PDF/email |
| **No public lead-capture form** — website forms can't post without an API key | MED-HIGH | public API is key-gated server-to-server |
| **Funnel conversion report missing though StageHistory records everything** | MED | data captured, report never built |
| **CSV export only for clients + lost deals** — nothing for payments/expenses/invoices (accountant pain); no GST export | MED | client-side blob pattern exists to copy |
| **PWA shell with empty service worker; no push notifications** | MED | `sw.js` empty fetch handler; no `requestPermission` anywhere |
| Comments/mentions only on tasks+projects; no watchers; leads/clients get bare notes | MED | `Comment` model FKs |
| Timezone hardcoded IST; single-org users; no i18n | LOW (for now) | fine for one Indian agency, blocks growth |
| Half-built flags worth finishing or deleting: `onlineSignature`, `onlinePayment`, WHATSAPP source | LOW | set wrong expectations |

---

## D. Recommended plan — in order

### Week 1 — quick wins, mostly ≤1 day each (trust + daily friction)
1. [x] ~~Remove the dead time-tracking UI (⏱ chips, "logged hrs" in Reports, TimeTrackingPrompt + store) per the owner's no-time-tracking decision; keep due-date/overdue signals as the accountability surface (B6).~~ **DONE 2026-08-04** — the prompt and its store were imported in five files and called from none, so nothing was ever recorded and every ⏱ chip and "Time Logged" column read 0. Removed the store, the prompt component, its mount in `providers.tsx`, three ⏱ chips (tasks + project detail ×2), and the Reports "Time Logged" column and "Xh logged" subtitle. The reports API no longer aggregates it either. `avgUtilization` survives — it is derived from active task COUNT, not hours. Due dates remain the accountability surface.
2. [x] ~~Skip the stage modal when the target stage requires nothing; stop accumulating skipped-stage fields (B1).~~ **DONE `00ad3bd`**
3. [x] ~~Merge Invoices/Invoice Drafts into one page; fix the "Move to Invoice Draft" destination (B10 + B13).~~ **DONE `00ad3bd`**
4. [x] ~~Command palette: fix `taskId` param, add ↑↓/↵, index leads + quote numbers (B14 + C).~~ **DONE `00ad3bd`**
5. [x] ~~Fix Quick Create "New Lead" dead end (B3).~~ **DONE `00ad3bd`** (the "New Client" quick-create contradiction with the born-from-deals rule remains a product question for Akmal)
6. [x] ~~Shared modal primitive: Escape + focus trap + confirm-on-dirty-close; adopt in LeadModal/StageTransition first (B2/B15).~~ **DONE**
7. [x] ~~Corrections one-liners: remove LinkedIn from EditLeadModal (#53), show the missing client-overview fields (#10).~~ **DONE** — #53 went with the lead-contacts consolidation (LinkedIn belongs to a person, so it lives on the contact row); #10 was already closed and is marked DONE in the section-A table above.
8. [x] ~~Debounce all search inputs (300ms + keepPreviousData) (B16).~~ **DONE**
9. [x] ~~Error-panel + retry on the money pages instead of fake empties (B12).~~ **DONE**

### Sprint 2 — the owner's money picture + the standard's TOP PRIORITY items
10. Receivables month view: month selector, totals row, due dates, row links; "Log payment" action (B11, corrections #40).
11. Expose `advanceAmount` + `taxIncluded` in contracts/subscriptions UI (corrections #41/42).
12. Enforce the Won→Active contract gate as Akmal specified — make it mandatory, with an explicit override permission if needed (corrections #61).
13. Email quote/invoice PDF to the client on SEND (address + PDF already exist) (C2).
14. Add-column "+" listing all captured fields; View Settings with Filters/Sort (corrections #33/34).
15. Manager team-scoped task view (My/Team toggle backed by real team scoping) (corrections #29).

### Sprint 3+ — capability gaps
16. File attachments (Attachment model + local uploads reusing the org-check pattern) — tasks, leads, expenses first.
17. CRM automations: LEAD_STAGE_CHANGE/LEAD_CREATED triggers, round-robin assignment; implement or delete the dead action enums.
18. ~~TimeEntry model~~ — rejected (owner decision: no employee time tracking).
19. Public lead-capture endpoint (rate-limited, org-token) for website forms.
20. Funnel conversion report from StageHistory; CSV exports for payments/expenses/invoices.
21. Recurring billing → auto invoice-draft PDF + email; push notifications on the existing PWA shell.
22. Onboarding: first-run checklist + real empty states everywhere (projects table has none).

---

## Also outstanding (from the QA track)
- FZ-021: prod migration-ledger check before next deploy (only remaining QA item). Note the
  pending prod migrations (currency_support, api_key_hash, money_float_to_decimal) have never
  been applied to production.
- ~~QA fix batch uncommitted~~ — **everything is pushed**: all session work through 2026-07-31 is
  on `main` at `00ad3bd` (QA partials + stage-modal + invoice merge + search/palette).
- Update `corrections.md` status column (49 items are DONE but marked OPEN — Akmal can't see progress).
