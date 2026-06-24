import { prisma } from '../lib/prisma.js';

// Generate the next human-readable Lead ID: FL-YYYYMM-XXXXXX.
// Sequential per organization per month. The INSERT ... ON CONFLICT is atomic,
// so concurrent lead creations never collide (sequence may have gaps if a later
// step fails — that is acceptable, IDs are not required to be contiguous).
export async function generateLeadId(organizationId: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

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
