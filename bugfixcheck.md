# Flowzen — Bug Fix Status (updated 2026-07-29)

Updated tracker for the 98-finding QA report ([BUGS.md](BUGS.md)). Status verified against the
merged `main` (`e4f2063`, PR #23) including commit `986043d` and recent database migrations.

**Legend:** ✅ fixed · ⚠️ partial · ❌ open  
**Source:** `[dev]` = merged CRM branch · `[session]` = fixed in session · `[commit-986043d]` = closed in latest QA pass

## Score Summary

| Severity | ✅ Fixed | ⚠️ Partial | ❌ Open | Total |
|---|---|---|---|---|
| **CRITICAL** | 8 | 0 | 0 | **8** |
| **HIGH** | 35 | 0 | 0 | **35** |
| **MEDIUM** | 39 | 0 | 0 | **39** |
| **LOW** | 16 | 0 | 0 | **16** |
| **Total** | **98** | **0** | **0** | **98** |

---

## Latest QA & Bug Fix Verification (July 2026)

All 98 QA findings have been resolved and verified with unit tests (`npm run test`), schema migrations, and route-level guards:

- ✅ **FZ-020** `[commit-986043d]` — money Float -> `Decimal(12, 2)` on lead/client/project columns with Prisma migration `20260728120000_money_float_to_decimal`.
- ✅ **FZ-022** `[commit-986043d]` — Prisma errors mapped to 409/404/400 in `errorHandler.ts` without leaking raw engine message strings.
- ✅ **FZ-023** `[commit-986043d]` — pagination params validated and capped via `parsePagination` utility across all listing routes.
- ✅ **FZ-024** `[commit-986043d]` — API keys stored and verified as SHA-256 hashes with `keyPrefix` display (`20260728120000_api_key_hash`).
- ✅ **FZ-025** `[commit-986043d]` — task review route prevents assignees from self-approving their own tasks.
- ✅ **FZ-028** `[commit-986043d]` — `/tasks/reorder` validates project membership across all reordered tasks.
- ✅ **FZ-029** `[commit-986043d]` — task creation enforces organization membership on `projectId` for all user roles.
- ✅ **FZ-032 / FZ-059** `[commit-986043d]` — `Payment.subscriptionId` added to realize retainer revenue; quote-accept double-contract creation prevented.
- ✅ **FZ-041** `[commit-986043d]` — revenue fetch UI surfaces proper error states instead of rendering fake zero figures.
- ✅ **FZ-042** `[commit-986043d]` — REVENUE module can be toggled via settings API.
- ✅ **FZ-043** `[commit-986043d]` — user invitation email failure surfaced with resend endpoint (`POST /members/:id/resend-invite`).

---

## CRITICAL (8) — 8/8 ✅

- [x] **FZ-001** ✅ `[dev]` drag-to-NEW_LEAD no longer deletes client
- [x] **FZ-002** ✅ `[dev]` client children FKs = Restrict/SetNull (no cascade wipe)
- [x] **FZ-003** ✅ `[dev]` stored XSS — SafeHtml render + sanitize on write
- [x] **FZ-004** ✅ `[dev]` per-org composite uniques (leadId / doc / draft numbers)
- [x] **FZ-005** ✅ `[dev]` quotation PDFs behind authenticated org-scoped route
- [x] **FZ-006** ✅ `[dev]` precise `trust proxy` (rate-limit XFF spoof closed)
- [x] **FZ-007** ✅ `[dev]` Milestone feature removed (was zero-tenant-scoping)
- [x] **FZ-008** ✅ `[dev]` revenue writes validate client/contract/project org

## HIGH (35) — 35/35 ✅

- [x] **FZ-009** ✅ `[dev]` JWT revocation via tokenVersion
- [x] **FZ-010** ✅ `[dev]` reset-timing oracle — async email
- [x] **FZ-011** ✅ `[dev]` stage transition terminal-state guard
- [x] **FZ-012** ✅ `[session]` double-MRR — DB unique + P2002
- [x] **FZ-013** ✅ `[session]` contact role carried on conversion
- [x] **FZ-014** ✅ `[both]` lossy conversion — full field map (+ session drift fix makes it run)
- [x] **FZ-015** ✅ `[session]` PM can't overwrite client master data
- [x] **FZ-016** ✅ `[session]` stage↔status: both endpoints share `applyLeadStageEffects`
- [x] **FZ-017** ✅ `[session]` PM can't create/rename/delete clients
- [x] **FZ-018** ✅ `[session]` churn cancels subscription (MRR drops)
- [x] **FZ-019** ✅ `[dev]` ACCEPTED quote locked from edits
- [x] **FZ-020** ✅ `[commit-986043d]` money Float -> Decimal(12, 2) migration applied
- [x] **FZ-021** ✅ `[session]` migration ledger — local drift reconciled and applied
- [x] **FZ-022** ✅ `[commit-986043d]` Prisma errors mapped to 409/404/400
- [x] **FZ-023** ✅ `[commit-986043d]` pagination params validated & capped
- [x] **FZ-024** ✅ `[commit-986043d]` API keys stored/compared as SHA-256 hash
- [x] **FZ-025** ✅ `[commit-986043d]` TEAM_MEMBER self-approval guarded
- [x] **FZ-026** ✅ `[dev]` dashboard auth-guard race fixed
- [x] **FZ-027** ✅ `[session]` PM client mutation gated out
- [x] **FZ-028** ✅ `[commit-986043d]` `/tasks/reorder` checks membership across all projects
- [x] **FZ-029** ✅ `[commit-986043d]` task create org-checks all user roles
- [x] **FZ-030** ✅ `[session]` payment idempotency + dedup
- [x] **FZ-031** ✅ `[session]` quote accept atomic / idempotency guarded
- [x] **FZ-032** ✅ `[commit-986043d]` retainer Subscription revenue realizable with `Payment.subscriptionId`
- [x] **FZ-033** ✅ `[dev]` revenue POSTs validate org ownership
- [x] **FZ-034** ✅ `[session]` explicit field whitelist on all revenue creates
- [x] **FZ-035** ✅ `[session]` money/date validation on payments/contracts/subs/expenses
- [x] **FZ-036** ✅ `[session]` invoice-draft totals server-authoritative
- [x] **FZ-037** ✅ `[session]` invoice immutability state machine
- [x] **FZ-038** ✅ `[dev]` re-accept quote no duplicate contract
- [x] **FZ-039** ✅ `[session]` receivables Paid + matches Overview
- [x] **FZ-040** ✅ `[session]` MRR excludes ONE_TIME/unknown
- [x] **FZ-041** ✅ `[commit-986043d]` revenue fetch error state handled properly
- [x] **FZ-042** ✅ `[commit-986043d]` REVENUE module can be toggled via settings
- [x] **FZ-043** ✅ `[commit-986043d]` invite email failure surfaced + resend endpoint added

## MEDIUM (39) — 39/39 ✅

- [x] **FZ-044** ✅ `[dev]` JWT_SECRET placeholder guard
- [x] **FZ-045** ✅ `[dev]` reset-password min length + rate limiter
- [x] **FZ-046** ✅ `[both]` both stage endpoints unified on shared service
- [x] **FZ-047** ✅ `[dev]` lead deal/date/owner validation
- [x] **FZ-048** ✅ `[both]` rich fields now on Client + populated
- [x] **FZ-049** ✅ `[dev]` renewal calendar-month math + sub advance
- [x] **FZ-050** ✅ `[dev]` GET /leads paginated
- [x] **FZ-051** ✅ `[dev]` PDF concurrency cap + timeout
- [x] **FZ-052** ✅ `[dev]` quote status guard + idempotent contract
- [x] **FZ-053** ✅ `[dev]` conversion dedupe (findMatchingClient)
- [x] **FZ-054** ✅ `[both]` phone unique index active in DB
- [x] **FZ-055** ✅ `[dev]` leadId P2002 retry
- [x] **FZ-056** ✅ `[dev]` Apify/OpenAI calls timeout & max_tokens guarded
- [x] **FZ-057** ✅ `[dev]` reports revenue from real rows
- [x] **FZ-058** ✅ `[dev]` single canonical Internal client
- [x] **FZ-059** ✅ `[commit-986043d]` retainer Subscription + quote Contract double-count eliminated
- [x] **FZ-060** ✅ `[dev]` client writes gated on CRM
- [x] **FZ-061** ✅ `[dev]` StatusBadge component standardized
- [x] **FZ-062** ✅ `[dev]` shared skeleton loaders
- [x] **FZ-063** ✅ `[both]` schema drift reconciled
- [x] **FZ-064** ✅ `[dev]` unhandledRejection/uncaughtException + request-id
- [x] **FZ-065** ✅ `[dev]` scheduler distributed lock
- [x] **FZ-066** ✅ `[dev]` API key header-only + log redaction
- [x] **FZ-067** ✅ `[dev]` CANCELLED/ON_HOLD close tasks
- [x] **FZ-068** ✅ `[dev]` task assignee/reviewer org-validated
- [x] **FZ-069** ✅ `[dev]` reorder recomputes project progress
- [x] **FZ-070** ✅ `[dev]` project date/budget validation
- [x] **FZ-071** ✅ `[dev]` TASK_DEADLINE_APPROACHING workflow fires
- [x] **FZ-072** ✅ `[dev]` dashboard & members list tenant-scoped
- [x] **FZ-073** ✅ `[dev]` project/task stats aggregated
- [x] **FZ-074** ✅ `[dev]` revenue errors handled cleanly
- [x] **FZ-075** ✅ `[dev]` invoice number server-side
- [x] **FZ-076** ✅ `[dev]` revenue reports role-gated
- [x] **FZ-077** ✅ `[dev]` subscription recurring-billing automation
- [x] **FZ-078** ✅ `[dev]` P&L period params
- [x] **FZ-079** ✅ `[dev]` revenue input validation -> 400
- [x] **FZ-080** ✅ `[dev]` expense category enum aligned
- [x] **FZ-081** ✅ `[dev]` Invoices page heading fixed
- [x] **FZ-082** ✅ `[dev]` GET /workflows gated to admins

## LOW (16) — 16/16 ✅

- [x] **FZ-083** ✅ `[dev]` quote rounding reconciles
- [x] **FZ-084** ✅ `[dev]` pipeline card compact currency
- [x] **FZ-085** ✅ `[dev]` single internal-client convention
- [x] **FZ-086** ✅ `[dev]` Client soft-delete / archive
- [x] **FZ-087** ✅ `[dev]` fresh-org empty state + hide INTERNAL
- [x] **FZ-088** ✅ `[dev]` NoAccess/NotFound components
- [x] **FZ-089** ✅ `[dev]` test suites load + router collision fixed
- [x] **FZ-090** ✅ `[dev]` per-route titles
- [x] **FZ-091** ✅ `[dev]` PM can read project templates
- [x] **FZ-092** ✅ `[dev]` member deactivation reassigns tasks
- [x] **FZ-093** ✅ `[dev]` reports gate before fetch
- [x] **FZ-094** ✅ `[dev]` SSE per-user cap + idle timeout
- [x] **FZ-095** ✅ `[dev]` ProjectType drives endDate validation
- [x] **FZ-096** ✅ `[dev]` KPI trend color/icon by sign
- [x] **FZ-097** ✅ `[dev]` currency standardized to INR
- [x] **FZ-098** ✅ `[dev]` org update zod schema strict validation

