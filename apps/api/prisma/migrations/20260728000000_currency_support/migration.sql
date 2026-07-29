-- FZ-097: Add currency field to all monetary models
-- All existing rows auto-backfill to 'INR' via the DEFAULT value.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "quote_documents" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "invoice_drafts" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR';

-- Also add schema-drift columns: subscriptionId and billingPeriod on payments
-- (these are in schema.prisma but have no migration yet)
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT;

-- AddForeignKey for payments.subscriptionId -> subscriptions
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_subscriptionId_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique index on (subscriptionId, billingPeriod)
DROP INDEX IF EXISTS "payments_subscriptionId_billingPeriod_key";
CREATE UNIQUE INDEX "payments_subscriptionId_billingPeriod_key" ON "payments"("subscriptionId", "billingPeriod");
