/**
 * The request shape a proforma and an invoice share (CR-02 §4, §5).
 *
 * Both routes validate against exactly these, so the two documents cannot
 * drift into accepting different things — which is the same reason the
 * renderer and the arithmetic are each written once.
 */

import { z } from 'zod';

/**
 * §5. `serialNo` is deliberately not accepted: it is array position, assigned
 * server-side, so a client cannot send rows numbered 1, 1, 7. `amount` is not
 * accepted either — it is units x unit cost, and a document whose stated
 * amount disagrees with its own two columns is the defect this prevents.
 */
export const lineItemSchema = z.object({
  particulars: z.string().trim().min(1, 'Every line needs a description'),
  units: z.number().positive('Units must be more than zero'),
  unitCost: z.number().min(0, 'Unit cost cannot be negative'),
  hsnSac: z.string().trim().optional().nullable(),
  /**
   * Per-row rate. The schema carries it because §9's DocumentLineItem does,
   * but nothing sends it yet: this app bills one rate per document, and a
   * document with two GST rates needs its tax rows grouped by rate before the
   * totals block could honestly print them.
   */
  gstRate: z.number().int().min(0).max(28).optional().nullable(),
});

/** §4 — an open list of label/value pairs, not fixed columns. */
export const customFieldSchema = z.object({
  label: z.string().trim().max(60, 'Keep a custom field label short'),
  value: z.string().trim().max(300),
});

/**
 * §4 — "must be its own field and must not be auto-filled without being
 * editable". Both halves optional so a caller can send just the code (the
 * only part that decides the tax) and let the name be resolved from it.
 */
export const placeOfSupplySchema = z.object({
  state: z.string().trim().optional().nullable(),
  code: z.string().trim().max(2).optional().nullable(),
});

/** The block both create and edit accept, all of it optional. */
export const documentFieldsSchema = {
  lineItems: z.array(lineItemSchema).min(1, 'A document needs at least one line item').max(200).optional(),
  customFields: z.array(customFieldSchema).max(20).optional(),
  placeOfSupply: placeOfSupplySchema.optional(),
  billingStateName: z.string().trim().optional().nullable(),
  billingStateCode: z.string().trim().max(2).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
};

export type LineItemPayload = z.infer<typeof lineItemSchema>;
export type CustomFieldPayload = z.infer<typeof customFieldSchema>;

/** Drops rows the user added and left blank rather than rejecting the save. */
export const cleanCustomFields = (fields: CustomFieldPayload[] | undefined): CustomFieldPayload[] =>
  (fields ?? []).filter((f) => f.label.trim() || f.value.trim());

/** The org columns every document write needs to build its seller snapshot. */
export const ORG_DOCUMENT_SELECT = {
  name: true,
  legalName: true,
  address: true,
  state: true,
  gstNumber: true,
  gstStateCode: true,
  pan: true,
  contactEmail: true,
  declarationText: true,
  defaultPaymentTerms: true,
  defaultProformaValidityDays: true,
  bankAccountHolderName: true,
  bankName: true,
  bankBranch: true,
  bankAccountNumber: true,
  bankIfscCode: true,
} as const;
