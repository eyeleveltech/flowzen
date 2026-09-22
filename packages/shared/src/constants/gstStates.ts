/**
 * India's GST state codes.
 *
 * The first two digits of every GSTIN are the state code of the registration,
 * and whether a supply is intra- or inter-state — CGST+SGST or IGST — is
 * decided by comparing two of these, never by comparing state *names*, which
 * are spelt half a dozen ways in practice ("Tamilnadu", "TN", "Tamil Nadu").
 *
 * The list is the statutory one published with the GST Acts, including the
 * union territories and 97 "Other Territory" (used for supplies outside any
 * state, e.g. an offshore installation). 96 (Foreign Country) is deliberately
 * excluded: an export is a zero-rated supply that this app bills through
 * `gstApplicable: false`, not through a place of supply.
 */

export type GstState = { code: string; name: string };

export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
] as const;

const BY_CODE = new Map(GST_STATES.map((s) => [s.code, s]));

/** Two digits, or null. Accepts "3" as "03" — a hand-typed code loses the zero. */
export function normaliseStateCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = String(code).replace(/\D/g, '');
  if (!digits) return null;
  const padded = digits.padStart(2, '0').slice(0, 2);
  return BY_CODE.has(padded) ? padded : null;
}

/** The statutory name for a code, so a document never prints someone's spelling of it. */
export function gstStateName(code: string | null | undefined): string | null {
  const normalised = normaliseStateCode(code);
  return normalised ? BY_CODE.get(normalised)!.name : null;
}

/** The state a GSTIN is registered in, read off its first two digits. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  return normaliseStateCode(gstin.trim().slice(0, 2));
}
