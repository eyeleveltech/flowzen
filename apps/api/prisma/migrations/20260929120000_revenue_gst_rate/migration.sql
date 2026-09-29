-- The GST rate on a project's quote and on a retainer's monthly fee.
--
-- Recorded BESIDE the value, never inside it — which is the opposite of what
-- the same field does on a cost, and deliberately so. GST charged to a client
-- is not the studio's money: it is collected for the government and paid over.
-- So `quotedValue` and `monthlyValue` stay the revenue, before tax, exactly as
-- every profit and margin figure already reads them; the rate says what the
-- client pays on top. Folding it in would have inflated every margin in the
-- app by 18%, silently, and on the day this shipped.
--
-- Null, not a default. Every project and retainer already in the table has a
-- value and nobody recorded a rate for it, and "we did not say" is a different
-- fact from "no GST applies". A default of 18 would have asserted the rate on
-- every row that exists, including any for a client outside GST.
--
-- Additive: two nullable columns. No row changes.

ALTER TABLE "projects" ADD COLUMN "gstPercent" INTEGER;

ALTER TABLE "retainers" ADD COLUMN "gstPercent" INTEGER;
