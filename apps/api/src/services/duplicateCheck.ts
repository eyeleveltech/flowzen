/**
 * Is this company already in the system?
 *
 * Two records for one company always drift apart, and then two screens tell you
 * different things — which is the failure this whole rewrite is organised around
 * (§5). The cheapest place to prevent it is at the moment somebody types a name.
 *
 * The rule (§3.12):
 *
 *   exact email or phone  ->  BLOCK, and show them the existing record
 *   similar company name  ->  WARN, let them continue or open it
 *   no match              ->  create
 *
 * Import never blocks the file. It flags the rows instead — a spreadsheet that
 * refuses to load because row 40 looks familiar is one nobody uses twice.
 */

export type DuplicateMatch = {
  id: string;
  name: string;
  /** Why we think it is the same company. */
  reason: 'email' | 'phone' | 'name';
  matchedOn: string;
};

export type DuplicateVerdict =
  | { action: 'CREATE' }
  | { action: 'BLOCK'; matches: DuplicateMatch[] }
  | { action: 'WARN'; matches: DuplicateMatch[] };

export type ExistingCompany = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type CandidateCompany = {
  name: string;
  email?: string | null;
  phone?: string | null;
};

/** Case and whitespace are not identity. */
export const normaliseEmail = (email: string | null | undefined): string | null => {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
};

/**
 * Compare phone numbers by their last ten digits.
 *
 * `+91 98765 43210`, `09876543210` and `9876543210` are one number typed three
 * ways, and a literal string comparison treats them as three companies. Ten
 * digits is the significant part of an Indian number; taking the tail also makes
 * a country code optional rather than significant.
 */
export const normalisePhone = (phone: string | null | undefined): string | null => {
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (digits.length < 7) return null; // too short to identify anyone
  return digits.slice(-10);
};

/**
 * Strip a company name down to the part that identifies it.
 *
 * "Zomato", "Zomato Pvt Ltd" and "ZOMATO PRIVATE LIMITED" are the same customer,
 * and the legal suffix is the part people type inconsistently.
 */
export const normaliseCompanyName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(
      /\b(private limited|pvt\.? ?ltd\.?|pvt|private|limited|ltd|llp|inc|incorporated|corp|corporation|co|company|technologies|technology|solutions|services|group|holdings|india)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Whether two names are close enough to be worth a warning.
 *
 * Deliberately a WARNING and never a block: "Sharma Traders" and "Sharma Trading"
 * really might be two customers, and a system that refuses to create the second
 * one is a system people route around by misspelling it on purpose.
 */
export const namesAreSimilar = (a: string, b: string): boolean => {
  const x = normaliseCompanyName(a);
  const y = normaliseCompanyName(b);
  if (!x || !y) return false;
  if (x === y) return true;

  // One contained in the other — "Zomato" vs "Zomato Media". Guarded by a length
  // floor so a two-letter name does not match half the database.
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;

  return false;
};

/**
 * Decide what to do about a candidate company.
 *
 * `existing` is the set already checked against — the caller narrows it with a
 * query; this function holds the rule.
 */
export const checkForDuplicates = (
  candidate: CandidateCompany,
  existing: ExistingCompany[],
): DuplicateVerdict => {
  const email = normaliseEmail(candidate.email);
  const phone = normalisePhone(candidate.phone);

  const blocking: DuplicateMatch[] = [];
  const warnings: DuplicateMatch[] = [];

  for (const other of existing) {
    if (email && normaliseEmail(other.email) === email) {
      blocking.push({ id: other.id, name: other.name, reason: 'email', matchedOn: email });
      continue;
    }

    if (phone && normalisePhone(other.phone) === phone) {
      blocking.push({ id: other.id, name: other.name, reason: 'phone', matchedOn: phone });
      continue;
    }

    if (namesAreSimilar(candidate.name, other.name)) {
      warnings.push({ id: other.id, name: other.name, reason: 'name', matchedOn: other.name });
    }
  }

  if (blocking.length) return { action: 'BLOCK', matches: blocking };
  if (warnings.length) return { action: 'WARN', matches: warnings };
  return { action: 'CREATE' };
};

/**
 * The same rule, softened for import.
 *
 * A block becomes a flagged row. The file still loads, and the person importing
 * decides afterwards — because the alternative is a spreadsheet that refuses at
 * row 40 and has to be edited blind.
 */
export const checkForImport = (
  candidate: CandidateCompany,
  existing: ExistingCompany[],
): { flagged: boolean; matches: DuplicateMatch[] } => {
  const verdict = checkForDuplicates(candidate, existing);
  return verdict.action === 'CREATE'
    ? { flagged: false, matches: [] }
    : { flagged: true, matches: verdict.matches };
};
