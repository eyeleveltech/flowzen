# Flowzen Master Bug & Issue Tracker

This document tracks all identified bugs, authorization vulnerabilities, route mismatches, schema validation discrepancies, and UI/UX issues across the Flowzen platform.

---

## Summary Status

| Total Issues | Fixed | In Progress | Pending |
| :--- | :--- | :--- | :--- |
| **9** | **9** | **0** | **0** |

---

## Detailed Issue Registry

### ✅ Bug 1: Authorization Hole in Task Deletion
- **Location**: `apps/api/src/routes/projects.ts:672-687`
- **Severity**: Critical (Security Vulnerability)
- **Description**: `DELETE /api/projects/tasks/:id` only checked `where: { id, organizationId }` with no role or ownership check. Any authenticated user (including `MEMBER`) could delete any task in the organization.
- **Expected Behavior**: Only users with role `MANAGER`, `ADMIN`, `SUPER_ADMIN`, or the task's direct assignee are permitted to delete a task.
- **Status**: ✅ **FIXED**
- **Resolution**: Added role and ownership check:
  ```ts
  const canStaff = atLeast(req.user!.role, 'MANAGER');
  const isOwn = existing.assigneeId === req.user!.userId;
  if (!canStaff && !isOwn) {
    res.status(403).json({ success: false, error: 'You can only delete your own tasks.' });
    return;
  }
  ```
- **Verification**: `npm --workspace=apps/api run test` (Passed 143/143 tests).

---

### ✅ Bug 2: Engagement Revision 404 Route Mismatch
- **Location**: `apps/web/src/lib/api-v2.ts:583` & `apps/web/src/app/(dashboard)/clients/[id]/page.tsx:693`
- **Severity**: High (Broken User Action)
- **Description**: `ReviewPriceDialog` called `api.companies.reviseEngagement()` which sent `POST /api/engagements/:id/revisions`. This endpoint did not exist, resulting in 404 errors.
- **Expected Behavior**: Changing commercial terms from the client detail page updates engagement terms and logs revision history.
- **Status**: ✅ **FIXED**
- **Resolution**: Aligned `api-v2.ts` to call `POST /revenue/engagements/${id}/terms` with required `reason` and `amount`. Made `reason` field required on client form.
- **Verification**: `npx tsc --noEmit` & `npm --workspace=apps/web run test` (0 errors).

---

### ✅ Bug 3: Custom Fields Silently Dropped & Validation Failure on Stage Move
- **Location**: `apps/web/src/app/(dashboard)/pipeline/[id]/components/StageMoveModal.tsx:9-62`, `CustomFieldsPanel.tsx:47-61`, and `apps/api/src/routes/deals.ts:276-307`
- **Severity**: High (Data Loss & Validation Gap)
- **Description**:
  1. `StageMoveModal` checked `sf.isRequired`, but Prisma schema returns `sf.required`. Required fields were never enforced on the client.
  2. `StageMoveModal` and `CustomFieldsPanel` called `api.deals.update(dealId, { customFields: values })`. `PATCH /deals/:id` stripped `customFields` through Zod validation, discarding field updates.
  3. `api.deals.moveStage` sent only `{ stageId }`, omitting custom fields.
- **Expected Behavior**: Required custom fields must be validated before stage movement, and custom field values must be persisted to the database.
- **Status**: ✅ **FIXED**
- **Resolution**:
  1. Updated `dealsRouter.patch('/:id')` in `deals.ts` to parse and persist `customFields` via `setDealFieldValue()`.
  2. Updated `api.deals.moveStage()` in `api-v2.ts` to accept and send `customFields`.
  3. Updated `StageMoveModal.tsx` to check `sf.required ?? sf.isRequired` and execute an atomic `api.deals.moveStage(dealId, stage.id, values)`.
  4. Updated `CustomFieldsPanel.tsx` with inline `ErrorNote` and proper saving.
- **Verification**: API & Web test suites passed.

---

### ✅ Bug 4: Calendar View Grid Padding Glitch & Timezone Shift
- **Location**: `apps/web/src/components/ui/calendar-view.tsx:57-92`
- **Severity**: Medium (UI Glitch & Date Misalignment)
- **Description**:
  1. In `CalendarView`, `padNext` was computed as `42 - cells.length`. When a month exactly spanned 35 days (5 full weeks of 7 days), `padNext = 7`, forcing a 6th completely empty row.
  2. Event date parsing used local `.getFullYear()`, `.getMonth()`, `.getDate()` on ISO strings, risking date boundary shifts across timezones.
- **Expected Behavior**: Calendar renders 5 weeks when 35 days are covered, and dates remain accurately aligned with the organization timezone.
- **Status**: ✅ **FIXED**
- **Resolution**:
  1. Updated padding logic: computed target cell count dynamically (35 if `<= 35`, otherwise 42), avoiding blank rows.
  2. Standardized date parsing for ISO strings (`YYYY-MM-DD`).
- **Verification**: `npm --workspace=apps/web run test` (Passed).

---

### ✅ Bug 5: Invoice Status Lifecycle Edge Case with Advance Payments
- **Location**: `apps/api/src/services/invoice.service.ts` & `apps/api/src/routes/revenue.ts:316-338`
- **Severity**: Medium (Accounting & Status Invariant)
- **Description**: When an advance payment was linked to a draft invoice (balance = 0), sending the invoice via `sendInvoice` transitioned status to `SENT` rather than `PAID`.
- **Expected Behavior**: Sending a fully paid draft invoice transitions its status directly to `PAID`.
- **Status**: ✅ **FIXED**
- **Resolution**: In `revenueRouter.post('/invoices/:id/send')`, calculated `statusFromPayments(invoice.total, paid, 'SENT')` using the attached payments to assign `PAID`, `PARTIALLY_PAID`, or `SENT`.
- **Verification**: Backend tests passed, `npx tsc --noEmit` clean.

---

### ✅ Bug 6: Contact Edit & Delete Endpoints Missing in API
- **Location**: `apps/api/src/routes/companies.ts` & `apps/web/src/lib/api-v2.ts`
- **Severity**: Medium (Feature Gap)
- **Description**: The API supported adding contacts with `POST /companies/:id/contacts`, but lacked `PATCH` and `DELETE` endpoints for contacts.
- **Expected Behavior**: Full CRUD operations for contacts with primary contact constraint handling.
- **Status**: ✅ **FIXED**
- **Resolution**: Added `PATCH /companies/:id/contacts/:contactId` and `DELETE /companies/:id/contacts/:contactId` with role validation (`SALES`+) and automatic primary contact promotion in transaction. Added `updateContact` and `deleteContact` in `api.companies`.
- **Verification**: API tests passed and TypeScript typecheck clean.

---

### ✅ Bug 7: Missing "Record Payment" UI & PDF Download in Revenue
- **Location**: `apps/web/src/app/(dashboard)/revenue/page.tsx` & `apps/web/src/lib/api-v2.ts`
- **Severity**: Medium (UX & Operational Gap)
- **Description**: Backend supported recording payments and generating GST invoice PDFs (`GET /api/revenue/invoices/:id/pdf`), but `/revenue` lacked UI actions to record payments or download PDFs.
- **Expected Behavior**: Admins can record payments directly from the invoice table and download invoice PDFs.
- **Status**: ✅ **FIXED**
- **Resolution**:
  1. Created `RecordPaymentDialog` component (`apps/web/src/components/revenue/RecordPaymentDialog.tsx`).
  2. Integrated "Record payment" button on unpaid invoices in `/revenue`.
  3. Added "PDF" download button linking to `/api/revenue/invoices/:id/pdf`.
- **Verification**: Web app builds with 0 errors.

---

### ✅ Bug 8: PM Dashboard Stubs & Dead Links
- **Location**: `apps/web/src/app/(dashboard)/dashboard/page.tsx:305-460`
- **Severity**: Low (UI Polish & UX)
- **Description**: "View All" in Pending Tasks was an unlinked span; "Pending Approvals" and "Upcoming Deadlines" contained static mock text; "Activity Feed" was static.
- **Expected Behavior**: Active navigation links, dynamic deadline/review counts, and real-time activity feed loading.
- **Status**: ✅ **FIXED**
- **Resolution**:
  1. Connected "View All" with `<Link href="/tasks">`.
  2. Computed dynamic upcoming deadlines for next 7 days from `data.work.tasks`.
  3. Wired pending reviews from `data.work.awaitingMyReview`.
  4. Fetched real activity feed via `api.activities.list({ take: '10' })`.
- **Verification**: Web test suite passed.

---

### ✅ Bug 9: Settings Organisation Tab Stale Copy & Duplicate Email Fields
- **Location**: `apps/web/src/app/(dashboard)/settings/page.tsx:268-315` & `apps/web/src/components/layout/top-nav.tsx:355-375`
- **Severity**: Low (UI Cleanup & Polish)
- **Description**: Stale copy stating "nothing sends mail yet" and duplicate `mailFromName` / `mailFromEmail` fields on Organisation tab created confusion. Top nav showed `??` during session hydration.
- **Expected Behavior**: Clear settings layout pointing to the dedicated Email tab, and graceful top-nav avatar loading.
- **Status**: ✅ **FIXED**
- **Resolution**:
  1. Replaced duplicate email fields on Organisation tab with an Outbound Mail Server section linking directly to the Email tab.
  2. Replaced `??` avatar initials fallback in `top-nav.tsx` with user icon fallback.
- **Verification**: Web app compile check clean.
