import dotenv from 'dotenv';
import path from 'node:path';
import { PrismaClient, RolePreset } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Explicit, in both the app's own .env and the repo root, so the organisation
// details below come from the environment rather than from whatever Prisma
// happened to load first.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * An empty Flowzen, ready for real work.
 *
 * `seed.ts` fills the database with a demonstration studio — sixteen invented
 * companies, eighty tasks, ten invoices. That is the right thing for a laptop
 * and the wrong thing for the day you start using this for real: a seeded
 * invoice number sitting in a live ledger is a mess you untangle for months.
 *
 * So this is the other script. It wipes everything and leaves exactly two
 * rows: the organisation, and one person who can sign in and invite the rest.
 *
 * ─── What it deliberately does NOT set ──────────────────────────────────────
 *
 * GSTIN and PAN are left empty unless the environment carries the real ones.
 * The seed fills them with placeholders in the statutory format so a demo can
 * print a document; here that would be worse than useless, because everything
 * else on the invoice — the bank account, the address, the declaration — is
 * real, and a correct-looking document carrying a registration number that is
 * not yours is a document you have issued to a client.
 *
 * Empty is safe: `documentModel.ts` refuses to print a tax invoice without a
 * seller GSTIN, which is the behaviour you want until somebody types the real
 * one into Settings.
 *
 *   npm run fresh-start          (in apps/api)
 *
 * Refuses to run without ADMIN_EMAIL and ADMIN_PASSWORD, and refuses a
 * password short enough to guess.
 */

const prisma = new PrismaClient();

const env = (key: string): string | null => {
  const raw = process.env[key];
  return raw && raw.trim() ? raw.trim() : null;
};

const ALL_PERMISSIONS = [
  'work.own', 'work.team', 'work.all', 'company.read', 'company.write',
  'pipeline.read', 'pipeline.write', 'money.status', 'money.figures',
  'cost.enter', 'reports.read', 'setup.admin', 'asset.manage',
];

async function main() {
  const adminEmail = env('ADMIN_EMAIL');
  const adminPassword = env('ADMIN_PASSWORD');
  const adminName = env('ADMIN_NAME') ?? 'Administrator';

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set. This script empties the database ' +
        'and creates one account; without them there would be no way back in.\n\n' +
        '  ADMIN_EMAIL="you@eyelevelstudio.in" ADMIN_PASSWORD="…" npm run fresh-start',
    );
  }
  if (adminPassword.length < 12) {
    throw new Error(
      `ADMIN_PASSWORD is ${adminPassword.length} characters. Twelve is the minimum for ` +
        'an account that can see every salary and every margin in the business.',
    );
  }

  const existing = await prisma.organization.findFirst({ select: { name: true } });

  /*
   * You may only erase something you can name.
   *
   * This command drops every client, invoice and task in the database, and on a
   * server it is one careless shell-history arrow-up away from destroying a
   * business's records. A `--force` flag or a `yes` would be typed by muscle
   * memory; naming the organisation cannot be, and it fails safe when you are
   * pointed at a different database than you thought.
   *
   * Nothing to lose means nothing to confirm — a database with no organisation
   * in it runs straight through.
   */
  if (existing) {
    const [companies, tasks, invoices, users] = await Promise.all([
      prisma.company.count(), prisma.task.count(), prisma.invoice.count(), prisma.user.count(),
    ]);
    const confirm = env('CONFIRM_ERASE');
    if (confirm !== existing.name) {
      throw new Error(
        `This will erase "${existing.name}" — ${users} users, ${companies} companies, ` +
          `${tasks} tasks, ${invoices} invoices — and cannot be undone.\n\n` +
          `  To proceed, name what you are erasing:\n` +
          `    CONFIRM_ERASE="${existing.name}" … npm run fresh-start\n` +
          (confirm
            ? `\n  You passed CONFIRM_ERASE="${confirm}", which does not match. ` +
              `Check you are pointed at the database you think you are.`
            : ''),
      );
    }
    console.log(
      `Erasing "${existing.name}": ${users} users, ${companies} companies, ` +
        `${tasks} tasks, ${invoices} invoices.\n`,
    );
  }

  // Children before parents. Some relations are SetNull rather than Cascade
  // (Cost.project, Invoice.project, Proforma.milestone), so the order matters
  // even with the foreign keys in place.
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.activity.deleteMany(),
    prisma.alertRead.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.assetMaintenance.deleteMany(),
    prisma.assetMovement.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.documentLineItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.peopleAllocation.deleteMany(),
    prisma.cost.deleteMany(),
    prisma.task.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.proforma.deleteMany(),
    prisma.project.deleteMany(),
    prisma.monthCard.deleteMany(),
    prisma.retainerProject.deleteMany(),
    prisma.retainer.deleteMany(),
    prisma.proposalVersion.deleteMany(),
    prisma.proposal.deleteMany(),
    prisma.outreachEntry.deleteMany(),
    prisma.person.deleteMany(),
    prisma.company.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ]);

  const org = await prisma.organization.create({
    data: {
      name: env('ORG_NAME') ?? 'EyeLevel Growth Studio',
      legalName: env('ORG_LEGAL_NAME'),
      website: env('ORG_WEBSITE'),
      contactEmail: env('ORG_CONTACT_EMAIL') ?? adminEmail,
      address: env('ORG_ADDRESS'),
      state: env('ORG_STATE') ?? 'Tamil Nadu',
      gstStateCode: env('ORG_GST_STATE_CODE') ?? '33',

      // Empty unless real. See the note at the top of this file.
      gstNumber: env('ORG_GSTIN'),
      pan: env('ORG_PAN'),

      bankAccountHolderName: env('ORG_BANK_HOLDER'),
      bankName: env('ORG_BANK_NAME'),
      bankBranch: env('ORG_BANK_BRANCH'),
      bankAccountNumber: env('ORG_BANK_ACCOUNT'),
      bankIfscCode: env('ORG_BANK_IFSC'),

      // Working calendar and financial year — §14 defaults, editable in Setup.
      financialYearStart: 4,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      workingHoursStart: '10:00',
      workingHoursEnd: '19:00',
      workingDays: [1, 2, 3, 4, 5, 6],
      proformaPrefix: env('ORG_PROFORMA_PREFIX') ?? 'EL/PI',
      assetTagPrefix: env('ORG_ASSET_TAG_PREFIX') ?? 'EL',
    },
  });

  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: adminName,
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      dept: 'Management',
      designation: 'Management',
      // A real figure belongs here, but this account exists to let somebody in,
      // not to be a payroll row. Set it from /members once the team is added.
      monthlyCost: 0,
      preset: RolePreset.MANAGEMENT,
      permissions: ALL_PERMISSIONS,
    },
  });

  await prisma.activity.create({
    data: {
      organizationId: org.id,
      entityType: 'Organization',
      entityId: org.id,
      actorId: admin.id,
      verb: 'organization_created',
      payload: { name: org.name, startedFrom: 'fresh-start' },
    },
  });

  const missing = [
    !org.gstNumber && 'GSTIN',
    !org.pan && 'PAN',
    !org.address && 'registered address',
    !org.bankAccountNumber && 'bank account',
  ].filter(Boolean);

  console.log(`Done. "${org.name}" is empty and ready.\n`);
  console.log(`  Sign in as ${admin.email}`);
  console.log(`  Everything else — people, clients, work — is entered from the app.\n`);
  if (missing.length > 0) {
    console.log(`  Still to fill in Settings before a tax invoice will print:`);
    console.log(`    ${missing.join(', ')}`);
    console.log(`  A tax invoice refuses to print without a seller GSTIN. That is deliberate.`);
  }
}

main()
  .catch((e) => {
    console.error('\nfresh-start failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
