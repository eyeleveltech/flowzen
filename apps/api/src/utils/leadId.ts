import { prisma } from '../lib/prisma.js';

/**
 * Synchronize lead counter for an organization so it never falls behind
 * existing leads in the database (e.g. after seeds or migrations).
 */
export async function syncLeadCounter(organizationId: string, yearMonth?: string): Promise<number> {
  const now = new Date();
  const ym = yearMonth || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `FL-${ym}-`;

  const highestLead = await prisma.lead.findFirst({
    where: {
      organizationId,
      leadId: { startsWith: prefix }
    },
    orderBy: { leadId: 'desc' },
    select: { leadId: true }
  });

  let maxSeq = 0;
  if (highestLead?.leadId) {
    const parts = highestLead.leadId.split('-');
    if (parts.length >= 3) {
      maxSeq = parseInt(parts[2], 10) || 0;
    }
  }

  const existingCounter = await prisma.leadIdCounter.findUnique({
    where: { organizationId_yearMonth: { organizationId, yearMonth: ym } }
  });

  if (!existingCounter || existingCounter.counter < maxSeq) {
    await prisma.leadIdCounter.upsert({
      where: { organizationId_yearMonth: { organizationId, yearMonth: ym } },
      update: { counter: maxSeq },
      create: { organizationId, yearMonth: ym, counter: maxSeq }
    });
    return maxSeq;
  }

  return existingCounter.counter;
}

// Generate the next human-readable Lead ID: FL-YYYYMM-XXXXXX.
// Sequential per organization per month. The INSERT ... ON CONFLICT is atomic,
// so concurrent lead creations never collide.
export async function generateLeadId(organizationId: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  await syncLeadCounter(organizationId, yearMonth);

  const rows = await prisma.$queryRaw<{ counter: number }[]>`
    INSERT INTO "lead_id_counters" ("id", "organizationId", "yearMonth", "counter")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${yearMonth}, 1)
    ON CONFLICT ("organizationId", "yearMonth")
    DO UPDATE SET "counter" = "lead_id_counters"."counter" + 1
    RETURNING "counter";
  `;

  const seq = String(rows[0].counter).padStart(6, '0');
  return `FL-${yearMonth}-${seq}`;
}

/**
 * Canonical key for a phone number, used ONLY to compare two numbers for duplicate detection.
 * Never stored — numbers are kept exactly as they were typed.
 *
 * Stripping non-digits is not enough on its own. The same person written as "+91 98400 00001",
 * "098400 00001" and "9840000001" produced three different keys, so all three were accepted as
 * separate leads. That was survivable while the database held a unique index on the phone column;
 * that index went with the column when a lead's contact details moved to lead_contacts, so this
 * function is now the ONLY thing standing between a rep and a duplicate lead.
 *
 * The subscriber number is what identifies a person, so anything longer than 10 digits is reduced
 * to its last 10 — which covers a country code (91…), an international prefix (0091…) and a
 * national trunk prefix (0…) in one rule, without needing to know which one it was.
 *
 * The trade-off is deliberate: two numbers from different countries that happen to share their
 * last 10 digits would be treated as one. For an agency working in Indian numbers that is far
 * rarer than the duplicate it prevents, and a wrong "this number already exists" is visible and
 * recoverable, whereas a duplicate lead is silent.
 */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
