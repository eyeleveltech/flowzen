/**
 * Flowzen v2 — seed
 *
 * Written by hand rather than ported from the old database (master plan §6.4).
 * A port script would be shaped by the old schema's compromises and would inherit
 * exactly the gaps the rewrite exists to remove — 8 of 9 deals with no owner, 8 of
 * 9 with no close date, 0 of 5 retainers with an end date.
 *
 * It has two jobs:
 *
 *   1. Seed the CONFIGURATION every organisation needs to function — the pipeline,
 *      its stage forms, lost reasons, sources, services. These are rows rather than
 *      constants (§3.4) but there is no settings screen: changing them is an edit
 *      here. That was a deliberate trade — the tables are the cheap half and worth
 *      having; the screens are backlog B8.
 *
 *   2. Optionally seed DEMO DATA so the app opens with something in it. This is
 *      also the honest test of the new schema: if a realistic agency cannot be
 *      expressed in it, that is worth discovering on day one.
 *
 * Idempotent. Safe to run repeatedly.
 *
 *   npm run seed              config + demo data
 *   npm run seed -- --config  configuration only, no demo data
 */

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

// One definition of what an organisation needs, shared with /auth/register — the
// seed having its own copy is why a registered organisation had no pipeline.
import {
  bootstrapOrganization,
  DEFAULT_MODULES,
  STAGES,
  CUSTOM_FIELDS,
  LOST_REASONS,
  LEAD_SOURCES,
  SERVICES,
} from '../src/lib/orgDefaults.js';

const prisma = new PrismaClient();

const CONFIG_ONLY = process.argv.includes('--config');

// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Flowzen v2 seed\n');

  // ── The organisation ───────────────────────────────────────────────────────
  //
  // state and gstNumber matter: an invoice has two parties, and CGST+SGST versus
  // IGST is decided by comparing them. Without the seller's state nothing can
  // work out which rule applies.
  let org = await prisma.organization.findFirst();

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'EyeLevel',
        industry: 'Marketing Agency',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        locale: 'en-IN',
        dateFormat: 'dd MMM yyyy',
        fiscalYearStart: 4,
        documentPrefix: 'EL',
        state: 'Tamil Nadu',
        allowPasswordLogin: true,
      },
    });
    console.log(`  organisation      ${org.name}`);
  } else {
    console.log(`  organisation      ${org.name} (existing)`);
  }

  // ── The first user ─────────────────────────────────────────────────────────
  //
  // Roles are a ladder and a person holds one; it is stored as a set so the move
  // to checkboxes later is a UI change rather than a migration (§3.10).
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@eyelevel.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Super Admin',
        password: await bcrypt.hash(adminPassword, 10),
        status: 'ACTIVE',
        organizationId: org.id,
      },
    });
    console.log(`  user              ${adminEmail}  /  ${adminPassword}`);
  } else {
    console.log(`  user              ${adminEmail} (existing)`);
  }

  await prisma.userRole.upsert({
    where: { userId_role: { userId: admin.id, role: Role.SUPER_ADMIN } },
    update: {},
    create: { userId: admin.id, organizationId: org.id, role: Role.SUPER_ADMIN },
  });

  // ── Configuration ──────────────────────────────────────────────────────────
  const { stagesByName } = await bootstrapOrganization(prisma, org.id);

  console.log(`  modules           ${DEFAULT_MODULES.length}`);
  console.log(`  pipeline          ${STAGES.length} stages`);
  console.log(`  stage forms       ${CUSTOM_FIELDS.length} fields`);
  console.log(`  lost reasons      ${LOST_REASONS.length}`);
  console.log(`  sources           ${LEAD_SOURCES.length}`);
  console.log(`  services          ${SERVICES.length}`);

  if (CONFIG_ONLY) {
    console.log('\n  --config: skipping demo data');
    return;
  }

  console.log('\n  demo data is not written yet — run with --config for now');
  void stagesByName;
}

main()
  .catch((e) => {
    console.error('\nseed failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
