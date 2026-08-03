import type { Prisma } from '@prisma/client';

/**
 * The lead's primary contact.
 *
 * A lead is a COMPANY; the people on it live in `lead_contacts`, each with their own details and
 * role, one flagged primary. This is the ONLY home for them — the lead row used to carry a second
 * copy in flat columns (contactName / contactEmail / contactPhone / jobTitle / linkedinUrl), so
 * the same human existed twice and the copies could disagree. Those columns are gone.
 *
 * Duplicate-phone detection lives here too, because the `@@unique([organizationId, contactPhone])`
 * constraint went with the columns. LeadContact has no organizationId of its own to rebuild it
 * from, so uniqueness is now enforced in the application rather than by the database.
 */

type Tx = Prisma.TransactionClient;

export interface PrimaryContactInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  linkedinUrl?: string | null;
}

/**
 * The include every lead read needs.
 *
 * `withPrimaryContactFields` can only re-derive contactName/contactEmail/... from a lead that
 * actually carries its `contacts`, and the flat columns are gone — so a query that forgets this
 * returns a lead with NO person on it at all. Ordered so the primary is first, which is also the
 * order `primaryContactOf` relies on for its "no isPrimary flagged anywhere" fallback.
 *
 * Exported as a constant rather than written out per call site because that is exactly how the
 * board, the list view, the detail page and the quote picker drifted apart in the first place.
 */
export const primaryContactInclude = {
  contacts: { orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
};

/**
 * Lighter variant for LIST endpoints: the board pulls every lead in the org, and the dossier JSON
 * on a contact can be kilobytes each. Carries exactly the fields the shaper reads, plus enough to
 * render a contact chip.
 */
export const primaryContactListInclude = {
  contacts: {
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true, name: true, email: true, phone: true,
      designation: true, linkedinUrl: true, role: true, isPrimary: true,
    },
  },
};

/** Normalized view of whoever the main person on a lead is. */
export interface PrimaryContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  linkedinUrl: string | null;
}

/**
 * Resolve a lead's main person. Pass a lead loaded with its `contacts`. Returns all-nulls for a
 * company with nobody attached yet, which is a legitimate state.
 */
export function primaryContactOf(lead: any): PrimaryContact {
  const contacts: any[] = Array.isArray(lead?.contacts) ? lead.contacts : [];
  const primary = contacts.find((c) => c.isPrimary) || contacts[0];
  if (primary) {
    return {
      name: primary.name ?? null,
      email: primary.email ?? null,
      phone: primary.phone ?? null,
      designation: primary.designation ?? null,
      linkedinUrl: primary.linkedinUrl ?? null,
    };
  }
  return { name: null, email: null, phone: null, designation: null, linkedinUrl: null };
}

/**
 * Every phone number already in use by a lead in this org, normalized to digits.
 *
 * Returned as a Set of digit-strings because numbers are stored however they were typed
 * ("+91-98400-00001" vs "9840000001"), so equality has to be on digits, not on the raw text.
 * That is also why this can't be a simple indexed WHERE — same cost as the code it replaces.
 */
export async function loadUsedLeadPhones(
  tx: Tx,
  orgId: string,
  normalize: (v: string | null | undefined) => string,
): Promise<Set<string>> {
  const contacts = await tx.leadContact.findMany({
    where: { lead: { organizationId: orgId }, phone: { not: null } },
    select: { phone: true },
  });
  const used = new Set<string>();
  for (const c of contacts) {
    const d = normalize(c.phone);
    if (d) used.add(d);
  }
  return used;
}

/**
 * The lead already using this phone number, if any — for the "duplicate phone" error, which names
 * the offending Lead ID so a rep can go and look at it.
 */
export async function findLeadByPhone(
  tx: Tx,
  orgId: string,
  digits: string,
  normalize: (v: string | null | undefined) => string,
): Promise<{ id: string; leadId: string | null } | null> {
  if (!digits) return null;

  const contacts = await tx.leadContact.findMany({
    where: { lead: { organizationId: orgId }, phone: { not: null } },
    select: { phone: true, lead: { select: { id: true, leadId: true } } },
  });
  const contactHit = contacts.find((c) => normalize(c.phone) === digits);
  return contactHit ? { id: contactHit.lead.id, leadId: contactHit.lead.leadId } : null;
}

/**
 * Re-derive the legacy flat contact fields on a lead from its primary contact.
 *
 * The web app reads `lead.contactName` / `contactEmail` / `contactPhone` in sixteen files. Shaping
 * responses here keeps those fields arriving now that the underlying columns are gone, so the
 * migration stayed invisible to the frontend instead of being a sixteen-file rewrite.
 * Pass a lead loaded with its `contacts`.
 */
export function withPrimaryContactFields<T extends Record<string, any>>(lead: T): T {
  const person = primaryContactOf(lead);
  return {
    ...lead,
    contactName: person.name,
    contactEmail: person.email,
    contactPhone: person.phone,
    jobTitle: person.designation,
    linkedinUrl: person.linkedinUrl,
  };
}

/**
 * Create or update the lead's primary contact row to match the person just written to the lead.
 *
 * Only fields actually supplied are changed, so a partial edit (e.g. just the phone) doesn't wipe
 * the rest. Does nothing when there is no person at all — a company with no contact is valid, and
 * an empty contact row would be noise.
 *
 * Never demotes: if a contact list already exists, the one flagged primary is updated in place
 * rather than a second primary being introduced.
 */
export async function syncPrimaryContact(
  tx: Tx,
  leadId: string,
  input: PrimaryContactInput,
): Promise<void> {
  const provided = (v: unknown) => v !== undefined;
  const clean = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s || null;
  };

  const existing = await tx.leadContact.findFirst({
    where: { leadId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  if (existing) {
    const data: Record<string, unknown> = {};
    if (provided(input.name) && clean(input.name)) data.name = clean(input.name);
    if (provided(input.email)) data.email = clean(input.email);
    if (provided(input.phone)) data.phone = clean(input.phone);
    if (provided(input.designation)) data.designation = clean(input.designation);
    if (provided(input.linkedinUrl)) data.linkedinUrl = clean(input.linkedinUrl);
    if (!existing.isPrimary) data.isPrimary = true;
    if (Object.keys(data).length === 0) return;
    await tx.leadContact.update({ where: { id: existing.id }, data });
    return;
  }

  const name = clean(input.name);
  const email = clean(input.email);
  const phone = clean(input.phone);
  // A contact needs a name. Fall back to the email's local part so details aren't stranded, and
  // give up entirely when there is nothing to record.
  const resolvedName = name || (email && email.includes('@') ? email.split('@')[0] : null);
  if (!resolvedName && !email && !phone) return;
  if (!resolvedName) return;

  await tx.leadContact.create({
    data: {
      leadId,
      name: resolvedName,
      email,
      phone,
      designation: clean(input.designation),
      linkedinUrl: clean(input.linkedinUrl),
      // The flat contact never carried a role, and guessing DECISION_MAKER would put words in the
      // customer's mouth. CC_ONLY is the neutral "we know they exist" value.
      role: 'CC_ONLY',
      isPrimary: true,
    },
  });
}
