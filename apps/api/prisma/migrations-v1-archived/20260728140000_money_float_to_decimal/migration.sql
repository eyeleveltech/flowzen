-- FZ-020: store money as NUMERIC(12,2) instead of double precision (Float).
-- Only the remaining money columns are converted here — the revenue tables (payments,
-- contracts, subscriptions, expenses, quote/invoice totals) are already Decimal.
-- The USING cast rewrites each existing double value to numeric(12,2); NULLs stay NULL.

ALTER TABLE "clients"
  ALTER COLUMN "contractValue" TYPE DECIMAL(12,2) USING "contractValue"::numeric(12,2),
  ALTER COLUMN "expectedRevenue" TYPE DECIMAL(12,2) USING "expectedRevenue"::numeric(12,2);

ALTER TABLE "projects"
  ALTER COLUMN "budget" TYPE DECIMAL(12,2) USING "budget"::numeric(12,2);

ALTER TABLE "leads"
  ALTER COLUMN "dealValue" TYPE DECIMAL(12,2) USING "dealValue"::numeric(12,2),
  ALTER COLUMN "expectedRevenue" TYPE DECIMAL(12,2) USING "expectedRevenue"::numeric(12,2);
