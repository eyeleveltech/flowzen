-- Retainer billing: proformas for retainer months.
--
-- 1. When a retainer's month is billed. In advance (the proforma goes out on
--    the 1st and the fee is paid before the work) is the default — it is how
--    retainers are usually billed, and every existing retainer starts there.
--    Switch one to IN_ARREARS from its edit form if it is billed after the
--    month instead.
--
-- 2. An invoice raised from a proforma now points back at it. The invoice has
--    always recorded its proforma; the proforma never recorded its invoice, so
--    the proforma register's Invoice column stayed empty however many had been
--    converted. This fills that link for the ones already converted. Fills
--    blanks only — both columns are unique, so it is one-to-one.

CREATE TYPE "RetainerBilling" AS ENUM ('IN_ADVANCE', 'IN_ARREARS');

ALTER TABLE "retainers" ADD COLUMN "billing" "RetainerBilling" NOT NULL DEFAULT 'IN_ADVANCE';

UPDATE "proformas" p
SET "invoiceId" = i."id"
FROM "invoices" i
WHERE i."proformaId" = p."id"
  AND p."invoiceId" IS NULL;
