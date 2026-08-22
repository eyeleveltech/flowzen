/**
 * Custom field values.
 *
 * `CustomField`, `StageField`, and `CustomFieldValue` tables exist in the schema
 * and are seeded, but nothing was reading or writing values. This service
 * provides the read/write layer.
 *
 * Values belong to the RECORD (deal, company, contact), not the stage. The
 * answer survives the deal moving on — a detail entered at Qualification does
 * not vanish at Negotiation.
 */

import type { CustomFieldType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Which fields a stage prompts for when a deal enters it.
 *
 * Some prompts are hard rules of the stage KIND — Won always asks for
 * engagement type and start date — and live in code, not in StageField.
 * This returns the CONFIGURED prompts, ordered by position.
 */
export const getFieldsForStage = async (stageId: string) =>
  prisma.stageField.findMany({
    where: { stageId },
    include: {
      field: {
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
          options: true,
          helpText: true,
          entity: true,
          archivedAt: true,
        },
      },
    },
    orderBy: { position: 'asc' },
  });

/** All custom field values on a deal, keyed by field key. */
export const getValuesForDeal = async (dealId: string) => {
  const values = await prisma.customFieldValue.findMany({
    where: { dealId },
    include: {
      field: { select: { key: true, label: true, type: true } },
    },
  });
  return values.map((v) => ({
    fieldId: v.fieldId,
    key: v.field.key,
    label: v.field.label,
    type: v.field.type,
    value: extractValue(v),
  }));
};

/** All custom field values on a company. */
export const getValuesForCompany = async (companyId: string) => {
  const values = await prisma.customFieldValue.findMany({
    where: { companyId },
    include: {
      field: { select: { key: true, label: true, type: true } },
    },
  });
  return values.map((v) => ({
    fieldId: v.fieldId,
    key: v.field.key,
    label: v.field.label,
    type: v.field.type,
    value: extractValue(v),
  }));
};

/** Read the typed value out of a CustomFieldValue row. */
const extractValue = (v: {
  valueText: string | null;
  valueNumber: unknown;
  valueDate: Date | null;
  valueBool: boolean | null;
  valueOptions: string[];
  field: { type: CustomFieldType };
}): unknown => {
  switch (v.field.type) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'LINK':
      return v.valueText;
    case 'NUMBER':
      return v.valueNumber !== null ? Number(v.valueNumber) : null;
    case 'DATE':
      return v.valueDate;
    case 'CHECKBOX':
      return v.valueBool;
    case 'SELECT':
      return v.valueOptions[0] ?? null;
    case 'MULTI_SELECT':
      return v.valueOptions;
    default:
      return v.valueText;
  }
};

/**
 * Set or update a custom field value on a deal.
 *
 * Upserted on the unique `(fieldId, dealId)` index — setting the same field
 * twice overwrites rather than duplicating.
 */
export const setDealFieldValue = async (
  fieldId: string,
  dealId: string,
  value: unknown,
) => {
  const field = await prisma.customField.findUniqueOrThrow({
    where: { id: fieldId },
    select: { type: true },
  });

  const data = valueToColumns(field.type, value);

  return prisma.customFieldValue.upsert({
    where: { fieldId_dealId: { fieldId, dealId } },
    update: data,
    create: { fieldId, dealId, ...data },
  });
};

/** Convert a raw input value to the correct column for this field type. */
const valueToColumns = (type: CustomFieldType, value: unknown) => {
  const base = {
    valueText: null as string | null,
    valueNumber: null as number | null,
    valueDate: null as Date | null,
    valueBool: null as boolean | null,
    valueOptions: [] as string[],
  };

  if (value === null || value === undefined) return base;

  switch (type) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'LINK':
      return { ...base, valueText: String(value) };
    case 'NUMBER':
      return { ...base, valueNumber: Number(value) };
    case 'DATE':
      return { ...base, valueDate: new Date(value as string) };
    case 'CHECKBOX':
      return { ...base, valueBool: Boolean(value) };
    case 'SELECT':
      return { ...base, valueOptions: [String(value)] };
    case 'MULTI_SELECT':
      return { ...base, valueOptions: Array.isArray(value) ? value.map(String) : [String(value)] };
    default:
      return { ...base, valueText: String(value) };
  }
};

/**
 * Validate that all required stage fields are present in the provided values.
 *
 * Returns an array of field errors. Empty means "all good".
 */
export const validateStageFields = async (
  stageId: string,
  values: Record<string, unknown>,
): Promise<Array<{ field: string; message: string }>> => {
  const stageFields = await getFieldsForStage(stageId);
  const errors: Array<{ field: string; message: string }> = [];

  for (const sf of stageFields) {
    if (!sf.required) continue;
    if (sf.field.archivedAt) continue; // archived fields are no longer enforced

    const val = values[sf.field.key];
    const blank =
      val === null ||
      val === undefined ||
      (typeof val === 'string' && val.trim() === '') ||
      (Array.isArray(val) && val.length === 0);

    if (blank) {
      errors.push({
        field: sf.field.key,
        message: `${sf.field.label} is required to enter this stage.`,
      });
    }
  }

  return errors;
};
