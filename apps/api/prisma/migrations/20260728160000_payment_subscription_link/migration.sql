-- FZ-032: let a Payment realize recurring (Subscription) revenue, not only Contract revenue.

ALTER TABLE "payments" ADD COLUMN "subscriptionId" TEXT;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payments_subscriptionId_idx" ON "payments"("subscriptionId");
