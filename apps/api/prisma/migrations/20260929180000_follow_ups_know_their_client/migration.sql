-- The stalled-proposal chases, filed under the client they are about.
--
-- The scanner has raised a "Follow up — <company> proposal" task for every
-- proposal gone quiet for five days since before a task could name a client.
-- Those made since record it; the older ones read "Internal" on My Work and
-- All tasks, and sat outside the client filter, because nothing said whose
-- proposal they were chasing — except the marker each one carries in its
-- notes, `proposal_followup:<proposal id>`, which is what this reads.
--
-- Fills blanks only. A task that already names a client is left as it is.

UPDATE "tasks" t
SET "companyId" = p."companyId"
FROM "proposals" p
WHERE t."companyId" IS NULL
  AND t."notes" = 'proposal_followup:' || p."id"
  AND t."organizationId" = p."organizationId";
