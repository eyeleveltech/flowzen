// GST tax TYPES (mode only — the rate is entered separately, editable per line).
//   GST  -> CGST + SGST (each rate/2)   | IGST -> IGST (rate)
//   ZERO -> no tax (EXP-LUT / SEZ-LUT / Exempt)   | RC -> no tax on invoice (reverse charge)
export type TaxMode = 'GST' | 'IGST' | 'ZERO' | 'RC';

export interface TaxType { value: string; label: string; mode: TaxMode; }

export const TAX_TYPES: TaxType[] = [
  { value: 'GST_S', label: 'GST S', mode: 'GST' },
  { value: 'IGST_S', label: 'IGST S', mode: 'IGST' },
  { value: 'IGST_EXP', label: 'IGST S (EXP)', mode: 'IGST' },
  { value: 'IGST_EXPLUT', label: 'IGST S (EXP-LUT)', mode: 'ZERO' },
  { value: 'IGST_SEZLUT', label: 'IGST S (SEZ-LUT)', mode: 'ZERO' },
  { value: 'IGST_RC', label: 'IGST RC', mode: 'RC' },
  { value: 'GST_RC', label: 'GST RC', mode: 'RC' },
  { value: 'EXEMPT', label: 'Exempt', mode: 'ZERO' },
];

export const DEFAULT_TAX_TYPE = 'IGST_S';
const BY_VALUE = new Map(TAX_TYPES.map((t) => [t.value, t]));
export function resolveTaxType(value?: string | null): TaxType {
  return (value && BY_VALUE.get(value)) || BY_VALUE.get(DEFAULT_TAX_TYPE)!;
}
