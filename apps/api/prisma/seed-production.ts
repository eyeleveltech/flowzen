import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * The seed a real studio can run.
 *
 * `seed.ts` is a development dataset: twenty-one companies, six retainers, a
 * pipeline, invoices, forty cost rows and a salary for every person — all of it
 * invented, and all of it wearing real client and staff names. It is exactly
 * what you want to look at while building a screen, and exactly what you do not
 * want in the database the business runs on.
 *
 * This one creates no business data at all. No companies, no people at client
 * companies, no proposals, retainers, projects, tasks, costs, invoices or
 * assets. Those are the studio's real records and the only correct way to get
 * them is for somebody to enter them.
 *
 * ─── Why it has so little to do ─────────────────────────────────────────────
 *
 * Almost nothing needs seeding. Registering through the app creates the
 * organisation and its first admin; adding people creates the users. Every
 * organisation setting that matters already has a schema default — the
 * proforma prefix, the April financial year, Asia/Kolkata, INR, 10:00–19:00,
 * Monday to Saturday.
 *
 * That leaves two fields that are genuinely blank on a new organisation and are
 * pure boilerplate rather than anybody's data:
 *
 *   - `sacCodes` — the service codes a line item offers, so nobody has to
 *     remember six digits.
 *   - `declarationText` — the sentence every tax invoice carries at the bottom.
 *
 * It fills those two, only when they are empty, and never overwrites a value
 * somebody has already set.
 *
 * ─── What it deliberately does NOT fill ─────────────────────────────────────
 *
 * The statutory and bank fields: GSTIN, PAN, legal name, address, account
 * number, IFSC. A wrong GSTIN or a wrong account number does not fail loudly —
 * it prints on a document and goes to a client. There is no safe default for
 * those, so instead of guessing, this prints a checklist of what is still
 * blank and where to enter it.
 *
 * Safe to run as often as you like. It deletes nothing and writes nothing that
 * is already set.
 */

/** The codes an agency of this shape bills under: advertising, design, production. */
const SAC_CODES = ['998365', '998386', '998311', '998313'];

const DECLARATION =
  'We declare that this invoice shows the actual price of the services described ' +
  'and that all particulars are true and correct.';

async function main() {
  const org = await prisma.organization.findFirst({
    select: {
      id: true, name: true, sacCodes: true, declarationText: true,
      legalName: true, address: true, state: true, gstNumber: true, pan: true,
      bankAccountHolderName: true, bankName: true, bankAccountNumber: true, bankIfscCode: true,
      contactEmail: true,
      _count: { select: { users: true, companies: true } },
    },
  });

  /*
   * No organisation means nobody has registered yet, and this script is the
   * wrong tool for that: registering through the app hashes a password and
   * makes the first account an admin properly. Inventing an organisation here
   * would leave a row nobody can sign in to.
   */
  if (!org) {
    console.error('No organisation yet — nothing to set up.');
    console.error('');
    console.error('Register through the app first. That creates the organisation and its');
    console.error('first admin account, then add your people under Settings > Team.');
    console.error('Run this again afterwards to fill in the invoice boilerplate.');
    process.exit(1);
  }

  console.log(`Organisation: ${org.name}`);
  console.log(`  ${org._count.users} user(s), ${org._count.companies} company/companies\n`);

  // ── the two things worth filling ──────────────────────────────────────────
  const fill: { sacCodes?: string[]; declarationText?: string } = {};
  if (org.sacCodes.length === 0) fill.sacCodes = SAC_CODES;
  if (!org.declarationText?.trim()) fill.declarationText = DECLARATION;

  if (Object.keys(fill).length === 0) {
    console.log('Invoice boilerplate is already set — nothing to change.');
  } else {
    await prisma.organization.update({ where: { id: org.id }, data: fill });
    if (fill.sacCodes) console.log(`Set SAC codes: ${SAC_CODES.join(', ')}`);
    if (fill.declarationText) console.log('Set the invoice declaration text.');
  }

  /*
   * What a document cannot be printed correctly without.
   *
   * Reported rather than guessed. Each of these appears on a proforma or a tax
   * invoice that goes to a client, and a plausible-looking wrong value is worse
   * than a blank one, because a blank is noticed.
   */
  const missing = [
    ['Legal name', org.legalName],
    ['Address', org.address],
    ['State', org.state],
    ['GSTIN', org.gstNumber],
    ['PAN', org.pan],
    ['Bank account holder', org.bankAccountHolderName],
    ['Bank name', org.bankName],
    ['Bank account number', org.bankAccountNumber],
    ['Bank IFSC', org.bankIfscCode],
    ['Contact email', org.contactEmail],
  ].filter(([, value]) => !String(value ?? '').trim());

  if (missing.length === 0) {
    console.log('\nEvery field a document needs is filled in. Ready.');
  } else {
    console.log(`\nStill to enter — ${missing.length} field(s) a document needs:`);
    for (const [label] of missing) console.log(`  - ${label}`);
    console.log('\nSettings > Tax & numbering, and Settings > Documents & billing.');
    console.log('Leaving these blank does not break the app; it prints an incomplete invoice.');
  }

  console.log('\nNo companies, proposals, retainers, projects, tasks, costs, invoices');
  console.log('or assets were created. Those are your real records — enter them in the app.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
