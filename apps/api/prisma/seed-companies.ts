import { CompanyStatus, PersonRole, PrismaClient } from '@prisma/client';
import type { Industry, LeadSource } from '@flowzen/shared';

const prisma = new PrismaClient();

/**
 * EyeLevel's real client list, from the intake sheet.
 *
 * Separate from `seed.ts` on purpose. That one is a development dataset — it
 * wipes the database and writes twenty-one invented companies with invented
 * fees and a salary for every person. This one writes the companies that
 * actually exist, deletes nothing, and invents nothing.
 *
 * ─── What it creates ────────────────────────────────────────────────────────
 *
 * Companies and their first contact. That is all. No retainers, projects,
 * tasks, proposals, invoices or costs: the sheet has figures for some of those,
 * but a retainer carries a start date, a term and a monthly fee that decide
 * what gets billed, and the sheet is explicit that most of them are still
 * unconfirmed. Those go in through the app, by somebody who knows.
 *
 * ─── Safe to run twice ──────────────────────────────────────────────────────
 *
 * A company already present by name is left exactly as it is — not updated, not
 * duplicated. So this can be run against a database that already holds some of
 * them, and it will add only what is missing.
 *
 * The one exception is opt-in: with FIX_STATUS=1 it will set an existing
 * company's status to match this sheet, and nothing else about it. That is for
 * the eighteen imported before the importer could read a status column, which
 * all arrived as PROSPECT when twelve of them are clients.
 *
 * ─── Where the data came from ───────────────────────────────────────────────
 *
 * "EyeLevel Flowzen Data Intake (for Thanu).xlsx", 23 September 2026, tabs
 * "Clients (Flowzen)", "Pipeline (Quoted)" and "Not Quoted (Contacts)". The
 * "Closed / Lost (do not load)" tab is deliberately not here.
 *
 * One row per COMPANY, not per engagement — the sheet tracks work, so VOSO had
 * three rows and Brigade three, and Eagle appeared on two tabs.
 *
 * Corrections applied, each because the raw value would be wrong in the app
 * rather than merely untidy:
 *   - "Trippur" and "Tirupur" are the same place: Tiruppur. Two spellings make
 *     two entries in every city filter.
 *   - "Gaziabad" -> Ghaziabad, which the sheet's own note spells correctly.
 *   - Mapnostics was "Coimbatore and Chennai"; a company has one city, and
 *     Coimbatore is the one to confirm against the billing address.
 *   - "IT & SaaS" is written as IT_AND_SAAS here rather than left to a string
 *     match, which resolves it to B2B.
 */

type Seed = {
  name: string;
  status: CompanyStatus;
  city: string;
  vertical: Industry;
  source: LeadSource;
  stateName: string;
  contact?: { name: string; email?: string; phone?: string };
  /** From the sheet, kept so the reason for a value is not lost. */
  note: string;
};

/** Tab "Clients (Flowzen)" — people we work with, or have. */
const CLIENTS: Seed[] = [
  {
    name: 'VOSO Sports (House of ESSA)', status: CompanyStatus.CLIENT, city: 'Tiruppur',
    vertical: 'E-commerce & D2C', source: 'Partnerships', stateName: 'Tamil Nadu',
    contact: { name: 'Vijay Shree (via Vyoma)' },
    note: 'Retainer Rs 1,20,000/mo, plus a Rs 50,000 website correction and a print catalogue not yet delivered.',
  },
  {
    name: "Heaven's ELIX", status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'E-commerce & D2C', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Surya Prakash', email: 'surya@heavenselix.com' },
    note: 'Retainer Rs 40,000/mo. Founder and Brewer.',
  },
  {
    name: 'Tamil Nadu Pickleball Association', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Sports & Fitness', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Dr. Kavya' },
    note: 'Retainer Rs 40,000/mo from Oct 2026; Rs 65,000/mo for Aug and Sep.',
  },
  {
    name: 'Da One Sports', status: CompanyStatus.CLIENT, city: 'Ghaziabad',
    vertical: 'Sports & Fitness', source: 'Cold Outreach', stateName: 'Uttar Pradesh',
    contact: { name: 'Jagrit' },
    note: 'Retainer Rs 30,000/mo. Performance marketing for the Janakpuri and Gwalior centres.',
  },
  {
    name: 'Right Hospitals', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Healthcare & Wellness', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Dr. Kavya Somesh', email: 'righthospitalskilpauk@gmail.com', phone: '044-26403939' },
    note: 'ON HOLD. One-month Google Ads engagement, Rs 30,000. That email is a general hospital inbox.',
  },
  {
    name: 'Madurai All Stars', status: CompanyStatus.CLIENT, city: 'Madurai',
    vertical: 'Sports & Fitness', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Surya Kumar' },
    note: 'ON HOLD. Rs 75,000/mo for two months from August, Rs 1,50,000 in total.',
  },
  {
    name: 'Brigade Enterprises', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Real Estate & Infrastructure', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Arun' },
    note: 'Two completed projects (Rs 1,11,000 and Rs 90,000) and a Rs 50,000 quote still out.',
  },
  {
    name: 'SPR City', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Real Estate & Infrastructure', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Ayippan' },
    note: 'Drone shoot Rs 1,30,000 (Rs 13,000/day across 10 days). Dates not locked.',
  },
  {
    name: 'Eagle Enterprises / Eagle Mobiles', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Retail', source: 'Partnerships', stateName: 'Tamil Nadu',
    contact: { name: 'Ganesh (Vyoma)' },
    note: 'GMB cleanup across 16 profiles, in progress and unvalued. A retainer is also quoted.',
  },
  {
    name: 'VERTX Drone Light Show', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Corporate & B2B', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Akash' },
    note: 'Won, delivered and closed, 100% advance paid. Value not on record.',
  },
  {
    name: 'Dinamalar', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Corporate & B2B', source: 'Partnerships', stateName: 'Tamil Nadu',
    contact: { name: 'Vijay Shree (via Vyoma)' },
    note: 'Done and closed, Rs 1,10,000 (AI video 75k + design 35k).',
  },
  {
    name: 'Pavilion Club', status: CompanyStatus.CLIENT, city: 'Chennai',
    vertical: 'Hospitality', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Yogesh' },
    note: 'Won 23 Sep 2026, starts 1 Oct. Rs 30,000/mo, below the Rs 75,000 floor.',
  },
];

/** Tabs "Pipeline (Quoted)" and "Not Quoted (Contacts)". */
const PROSPECTS: Seed[] = [
  {
    name: 'iCube B2B Solutions', status: CompanyStatus.PROSPECT, city: 'Chennai',
    vertical: 'Technology & SaaS', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    contact: { name: 'Shaik Abdullah' },
    note: 'Quoted Rs 60,000 retainer, superseding the 11 Aug proposal. Needs a follow-up.',
  },
  {
    name: 'K Fashions Anna Nagar', status: CompanyStatus.PROSPECT, city: 'Chennai',
    vertical: 'Retail', source: 'Cold Outreach', stateName: 'Tamil Nadu',
    note: 'Proposal given and work done, now on hold. Value not on record.',
  },
  {
    name: 'Ramraj Cotton', status: CompanyStatus.PROSPECT, city: 'Tiruppur',
    vertical: 'Retail', source: 'Referrals', stateName: 'Tamil Nadu',
    contact: { name: 'Feroze Sheriff', email: 'Feroze.sheriff@ramrajcotton.net' },
    note: 'On hold. 300+ stores, Rs 2-3 Cr/mo ad potential. Second address on file: Leoantony.m@ramrajcotton.net.',
  },
  {
    name: 'Nippo / Airview', status: CompanyStatus.PROSPECT, city: 'Chennai',
    vertical: 'E-commerce & D2C', source: 'Partnerships', stateName: 'Tamil Nadu',
    contact: { name: 'Arun (marketing head, via Vyoma)' },
    note: 'Plan delivered, awaiting feedback. Do NOT pitch their Amazon/Flipkart or branding agencies.',
  },
  {
    name: 'Her Will', status: CompanyStatus.PROSPECT, city: 'Bangalore',
    vertical: 'E-commerce & D2C', source: 'Website / Inbound', stateName: 'Karnataka',
    note: 'First meeting not scheduled. Brand-name clash with herwill.org.',
  },
  {
    name: 'Mapnostics', status: CompanyStatus.PROSPECT, city: 'Coimbatore',
    vertical: 'Technology & SaaS', source: 'Website / Inbound', stateName: 'Tamil Nadu',
    contact: { name: 'Boopathi' },
    note: 'Proposal still to send. Sheet said "Coimbatore and Chennai" — confirm the billing city.',
  },
];

/**
 * In the sheet, but not created: no city, and city is required.
 *
 * Reported rather than guessed. Defaulting them to Chennai would put three
 * companies in a city they are probably not in, and that is invisible once it
 * is saved.
 */
const NEEDS_A_CITY = [
  ['Liza Hospitality', 'Paid in full, delivery pending on our side. No city, state or contact in the sheet.'],
  ['Sastry Pain Balm', 'Quoted Rs 1,00,000 retainer, sent 16 Jul, quiet since. No city or state.'],
  ['Spark Invisible Aligners', 'Quote out, no clear answer. Value not on record. No city or state.'],
  ['GoPlay', 'Quoted Rs 75,000/mo. No city, state, industry or contact, and the name spelling is unconfirmed.'],
];

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) {
    console.error('No organisation yet. Register through the app first, then run this.');
    process.exit(1);
  }

  /*
   * Somebody has to own each one. The sheet names no owner, so this falls to
   * whoever runs it — the same rule the CSV importer follows — and it is
   * changed per company in the app afterwards.
   */
  const owner =
    (await prisma.user.findFirst({ where: { organizationId: org.id, preset: 'MANAGEMENT', active: true } })) ??
    (await prisma.user.findFirst({ where: { organizationId: org.id, active: true } }));
  if (!owner) {
    console.error('No active user to own these. Add your team first.');
    process.exit(1);
  }

  const fixStatus = process.env.FIX_STATUS === '1';

  console.log(`Organisation: ${org.name}`);
  console.log(`Owner for new companies: ${owner.name}\n`);

  let made = 0;
  let already = 0;
  let fixed = 0;

  for (const row of [...CLIENTS, ...PROSPECTS]) {
    const exists = await prisma.company.findFirst({
      where: { organizationId: org.id, name: row.name },
      select: { id: true, status: true },
    });
    if (exists) {
      /*
       * A company already here keeps whatever it has — unless somebody asks,
       * because the case this was written for is the one where it is wrong:
       * eighteen of these were imported before the importer could read a status
       * column, so they all arrived as PROSPECT and twelve of them are clients.
       *
       * Behind FIX_STATUS=1 rather than automatic, because a status somebody
       * changed deliberately in the app should not be overwritten by a file.
       * Only the status is touched — never the name, city, owner or contacts,
       * which may well have been corrected since.
       */
      if (fixStatus && exists.status !== row.status) {
        await prisma.company.update({ where: { id: exists.id }, data: { status: row.status } });
        await prisma.activity.create({
          data: {
            organizationId: org.id,
            entityType: 'Company',
            entityId: exists.id,
            actorId: owner.id,
            verb: row.status === CompanyStatus.PROSPECT ? 'company_updated' : 'company_migrated',
            payload: {
              name: row.name,
              status: row.status,
              was: exists.status,
              correctedFromIntakeSheet: true,
            },
          },
        });
        console.log(`  ~ ${row.name.padEnd(36)} ${exists.status} -> ${row.status}`);
        fixed += 1;
        continue;
      }
      console.log(`  = ${row.name} — already here (${exists.status}), left alone`);
      already += 1;
      continue;
    }

    const company = await prisma.company.create({
      data: {
        organizationId: org.id,
        name: row.name,
        status: row.status,
        city: row.city,
        vertical: row.vertical,
        source: row.source,
        stateName: row.stateName,
        ownerId: owner.id,
        ...(row.contact
          ? {
              people: {
                create: {
                  name: row.contact.name,
                  email: row.contact.email ?? null,
                  phone: row.contact.phone ?? null,
                  role: PersonRole.CONTACT,
                },
              },
            }
          : {}),
      },
    });

    /*
     * The same distinction the importer draws: §3 makes status derived — a
     * company is a CLIENT because a proposal was WON — so a client that
     * predates Flowzen is a migration, and the pipeline figures must never
     * read it as a win.
     */
    await prisma.activity.create({
      data: {
        organizationId: org.id,
        entityType: 'Company',
        entityId: company.id,
        actorId: owner.id,
        verb: row.status === CompanyStatus.PROSPECT ? 'company_created' : 'company_migrated',
        payload: {
          name: company.name,
          vertical: company.vertical,
          status: company.status,
          seeded: true,
          note: row.note,
          ...(row.status === CompanyStatus.PROSPECT ? {} : { existingClient: true }),
        },
      },
    });

    console.log(`  + ${row.name.padEnd(36)} ${row.status.padEnd(9)} ${row.city}`);
    made += 1;
  }

  console.log(`\nAdded ${made}, already present ${already}${fixed ? `, status corrected ${fixed}` : ''}.`);
  if (!fixStatus && already > 0) {
    console.log('Run again with FIX_STATUS=1 to set the status of the existing ones from this sheet.');
  }

  console.log(`\nNot created — no city in the sheet, and a company must have one:`);
  for (const [name, why] of NEEDS_A_CITY) console.log(`  - ${name}: ${why}`);

  console.log('\nNo retainers, projects, tasks, proposals or invoices were created.');
  console.log('The fees and dates are in the intake sheet; add them in the app.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
