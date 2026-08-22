-- Sequential document numbers, per organisation / scope / period.
--
-- Allocated by a single atomic INSERT … ON CONFLICT DO UPDATE … RETURNING, so two
-- people raising an invoice in the same instant cannot receive the same number.
-- There is no read-then-write gap to lose a race in.

CREATE TABLE "doc_counters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "doc_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "doc_counters_organizationId_scope_period_key"
    ON "doc_counters"("organizationId", "scope", "period");

ALTER TABLE "doc_counters"
    ADD CONSTRAINT "doc_counters_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- A counter only ever goes up. A decrement means a number was reissued, and two
-- documents sharing a number is the kind of thing an auditor finds, not you.
ALTER TABLE "doc_counters"
    ADD CONSTRAINT "doc_counters_non_negative" CHECK ("counter" >= 0);
