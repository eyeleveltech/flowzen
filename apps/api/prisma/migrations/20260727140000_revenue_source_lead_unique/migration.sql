-- Make CRM revenue idempotency concurrency-safe.
--
-- The application already checks findFirst({ sourceLeadId }) before auto-creating a
-- subscription/contract, but that check-then-insert races: two overlapping stage-change
-- requests for the same lead both read "none exists" and both insert, producing a second
-- ACTIVE subscription and double MRR. The only concurrency-safe guard is a DB unique
-- constraint on sourceLeadId, added at the end of this migration.
--
-- sourceLeadId is nullable; manually-created revenue rows have it NULL, and Postgres treats
-- NULLs as distinct in a unique index, so manual contracts/subscriptions are never constrained.
--
-- Before the index can be built, any pre-existing duplicates (created by the race this fixes)
-- must be resolved. Policy: keep the EARLIEST auto-created row per lead intact; for the extras,
-- cancel them (so they stop counting toward MRR) AND clear sourceLeadId (so they no longer
-- collide on the new unique index). Nothing is deleted — the duplicate rows remain, auditable.

-- Subscriptions: cancel + unlink every duplicate except the earliest per lead.
UPDATE "subscriptions" s
SET "status" = 'CANCELLED',
    "sourceLeadId" = NULL,
    "updatedAt" = now()
WHERE s."sourceLeadId" IS NOT NULL
  AND s."id" <> (
    SELECT s2."id"
    FROM "subscriptions" s2
    WHERE s2."sourceLeadId" = s."sourceLeadId"
    ORDER BY s2."createdAt" ASC, s2."id" ASC
    LIMIT 1
  );

-- Contracts: same policy. ContractStatus has no CANCELLED, so use TERMINATED.
UPDATE "contracts" c
SET "status" = 'TERMINATED',
    "sourceLeadId" = NULL,
    "updatedAt" = now()
WHERE c."sourceLeadId" IS NOT NULL
  AND c."id" <> (
    SELECT c2."id"
    FROM "contracts" c2
    WHERE c2."sourceLeadId" = c."sourceLeadId"
    ORDER BY c2."createdAt" ASC, c2."id" ASC
    LIMIT 1
  );

-- Replace the plain indexes with unique ones (unique implies an index, so the old ones go).
DROP INDEX IF EXISTS "subscriptions_sourceLeadId_idx";
DROP INDEX IF EXISTS "contracts_sourceLeadId_idx";

CREATE UNIQUE INDEX "subscriptions_sourceLeadId_key" ON "subscriptions"("sourceLeadId");
CREATE UNIQUE INDEX "contracts_sourceLeadId_key" ON "contracts"("sourceLeadId");
