-- Per-line GST tax type (drives the CGST/SGST vs IGST split).
ALTER TABLE "quote_line_items" ADD COLUMN "taxType" TEXT NOT NULL DEFAULT 'IGST_S_18';
