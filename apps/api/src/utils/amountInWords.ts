/**
 * Indian numbering (lakh / crore) amount in words, whole rupees.
 *
 * Matches the exact phrasing the business's real invoices already use —
 * e.g. 165200 -> "Rupees One Lakh Sixty Five Thousand Two Hundred Only."
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoToWords(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

export function amountInWords(rupees: number): string {
  if (!rupees || rupees <= 0) return 'Rupees Zero Only.';
  let n = Math.floor(rupees);
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoToWords(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoToWords(n));
  return `Rupees ${parts.join(' ')} Only.`;
}
