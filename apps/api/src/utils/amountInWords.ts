/**
 * Indian numbering (lakh / crore) amount in words.
 *
 * Matches the exact phrasing the business's real invoices already use —
 * e.g. 165200 -> "Rupees One Lakh Sixty Five Thousand Two Hundred Only."
 *
 * CR-02 §7 adds paise: "Rupees Two Lakh Twenty Thousand and Fifty Paise Only".
 * A document total is rounded to the whole rupee (§6's round off), so on a
 * finished invoice the paise are always zero and the wording is unchanged from
 * every document already issued. The paise branch exists for the places a
 * figure legitimately isn't rounded — a part payment receipt, a line amount
 * quoted back to a client — and so that this function is never the reason a
 * caller has to round first.
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

/** The words for a whole number, no "Rupees" and no "Only" — 0 gives "Zero". */
function wholeToWords(value: number): string {
  let n = Math.floor(value);
  if (n <= 0) return 'Zero';
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
  return parts.join(' ');
}

export function amountInWords(amount: number): string {
  const clean = Number(amount);
  if (!Number.isFinite(clean) || clean <= 0) return 'Rupees Zero Only.';

  // Round to paise first. Without this, 47199.999999999996 — which is what
  // 39999.99 * 1.18 actually evaluates to in a double — floors to 47199 and
  // the words disagree with the figure printed two lines above them.
  const totalPaise = Math.round(clean * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const rupeeWords = `Rupees ${wholeToWords(rupees)}`;
  if (paise === 0) return `${rupeeWords} Only.`;
  return `${rupeeWords} and ${twoToWords(paise)} Paise Only.`;
}
