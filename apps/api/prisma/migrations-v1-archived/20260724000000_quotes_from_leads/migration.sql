-- Quotations can now be raised against a Lead, before any Client account exists.
--
-- Background: a Client used to be auto-created the moment a card was dragged to OUTREACH,
-- purely because a quotation needed a clientId. That produced two records for the same
-- company while the deal was still being chased, and a backward drag then hard-deleted the
-- client. Quotes already snapshot the billing party (clientName, billingAddress, clientGst,
-- clientState...) at save time, so they never actually needed a Client row — only a link.
--
-- A quote is now raised against exactly one party: a lead OR a client. On conversion, quotes
-- raised against the lead are re-pointed to the new client (see clientConversion.service.ts).

-- 1. clientId becomes optional
ALTER TABLE "public"."quote_documents" ALTER COLUMN "clientId" DROP NOT NULL;

-- 2. leadId is added
ALTER TABLE "public"."quote_documents" ADD COLUMN "leadId" TEXT;

-- 3. SetNull, not Cascade: deleting a lead must never destroy a document that was sent to a
--    customer and may already have been accepted.
ALTER TABLE "public"."quote_documents"
  ADD CONSTRAINT "quote_documents_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "quote_documents_leadId_idx" ON "public"."quote_documents"("leadId");

-- 4. Every quote must hang off at least one party, so none is ever orphaned.
--
--    Deliberately OR, not XOR: a quote is *raised* against one party (the route layer
--    enforces that), but after conversion it carries both — leadId records which deal it
--    came from, clientId records who is being billed. Requiring exactly one would make
--    re-pointing a lead-quote at conversion impossible.
--
--    NOT VALID so the migration cannot fail on pre-existing rows; validate once clean:
--      ALTER TABLE "public"."quote_documents" VALIDATE CONSTRAINT "quote_documents_one_party";
ALTER TABLE "public"."quote_documents"
  ADD CONSTRAINT "quote_documents_one_party"
  CHECK ("clientId" IS NOT NULL OR "leadId" IS NOT NULL)
  NOT VALID;
