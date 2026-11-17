-- Perf Plan 2, decision 7: indexes for the hot filters. Additive only.
-- TaskReview(organizationId, submittedAt) is left out: approvals were removed
-- on 28 Oct and nothing reads that table any more.

-- CreateIndex
CREATE INDEX "tasks_organizationId_status_completedAt_idx" ON "tasks"("organizationId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "tasks_organizationId_dueDate_idx" ON "tasks"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "invoices_organizationId_raisedAt_idx" ON "invoices"("organizationId", "raisedAt");

-- CreateIndex
CREATE INDEX "payments_receivedAt_idx" ON "payments"("receivedAt");

-- CreateIndex
CREATE INDEX "activities_organizationId_at_idx" ON "activities"("organizationId", "at");
