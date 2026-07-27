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

// Normalize a phone number to digits only, for duplicate detection.
export function normalizePhone(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '');
}
