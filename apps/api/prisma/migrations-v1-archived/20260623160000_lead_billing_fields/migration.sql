-- Client billing fields used to auto-fill quotations / proforma invoices.
ALTER TABLE "leads" ADD COLUMN "billingAddress" TEXT;
ALTER TABLE "leads" ADD COLUMN "gstNumber" TEXT;
