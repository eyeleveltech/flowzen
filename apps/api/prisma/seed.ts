import {
  PrismaClient, RolePreset, CompanyVertical, CompanySource, CompanyStatus, PersonRole,
  OutreachStatus, ProposalKind, ProposalStage, ProposalOutcome, ProformaSourceType, ProformaStatus,
  RetainerStatus, RetainerProjectStatus, MonthCardStatus, ProjectStatus, Priority, MilestoneStatus, TaskWorkType,
  TaskStatus, TaskType, WaitingOn, CostType, CostPaidBy, CostTreatment, InvoiceStatus, AlertSeverity,
  AssetCategory, AssetStatus, AssetCondition, AssetMovementKind, AssetMaintenanceKind,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

/*
 * "Today" is the day you seed, not a date written into this file.
 *
 * It used to be a literal — `2026-09-02` — and every bucket on every screen
 * was measured from it. Seed on the 20th and the overdue pile is eighteen days
 * stale, "due today" is due two weeks ago, and the month cards say August and
 * September when the current month is something else. A demo database whose
 * calendar is wrong is worse than an empty one: it teaches you to distrust the
 * dates.
 *
 * Anchored to local midnight so a `days(0)` row is today all day, rather than
 * flipping to yesterday after the clock passes the seeding time.
 */
const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();
const days = (n: number) => new Date(TODAY.getTime() + n * 86400000);

/** "2026-09" for a date — the key a MonthCard is stored under. */
/**
 * Straight-line useful life in months, per category.
 *
 * The same table as ASSET_USEFUL_LIFE in @flowzen/shared, written out rather
 * than imported: the seed runs through `prisma db seed` with its own tsconfig
 * and pulling a workspace package in here has broken that before.
 */
const ASSET_LIFE: Record<AssetCategory, number> = {
  LAPTOP: 36, DESKTOP: 36, MONITOR: 60, PHONE: 24, STORAGE: 36, NETWORK: 36,
  CAMERA_BODY: 60, LENS: 84, LIGHTING: 60, AUDIO: 60, GIMBAL_DRONE: 36,
  SUPPORT: 60, ACCESSORY: 24, OTHER: 60,
};

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const THIS_MONTH = monthKeyOf(TODAY);
const LAST_MONTH = monthKeyOf(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1));

/**
 * The Indian financial year a date falls in, as the "26-27" in INV/26-27/0142.
 *
 * April start, matching `financialYearStart: 4` on the organization below. The
 * document numbers were hardcoded to 26-27, which is right only for as long as
 * the hardcoded TODAY was.
 */
const FY = (() => {
  const y = TODAY.getFullYear();
  const start = TODAY.getMonth() + 1 >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
})();

async function main() {
  console.log('Wiping and reseeding Flowzen with a full EyeLevel dataset...');

  // Delete children before parents — FK order matters even with onDelete rules,
  // since some relations (Cost.project, Invoice.project, Proforma.milestone)
  // use SetNull rather than Cascade.
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.activity.deleteMany(),
    prisma.alertRead.deleteMany(),
    prisma.alert.deleteMany(),
    // Assets before costs: an asset points at the CAPITAL Cost row that bought
    // it, and maintenance points at both an asset and (optionally) a cost.
    prisma.assetMaintenance.deleteMany(),
    prisma.assetMovement.deleteMany(),
    prisma.asset.deleteMany(),
    // Line items hang off a proforma or an invoice; both are deleted below,
    // and Cascade would take them — but only for rows this list reaches.
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

  /**
   * Seed passwords come from the environment, never from this file.
   *
   * They used to be literals — `Harish143@` for the admin and one shared
   * `ChangeMe123!` for everybody else. Anybody who could read the repository
   * could sign in as any seeded account, and on a public host that is the
   * whole application. A literal here is a published credential.
   *
   * Local development still wants to be one command, so a random password is
   * generated and PRINTED when nothing is set. It differs every run, so it
   * cannot become the known value the literals were.
   */
  const generated = randomBytes(12).toString('base64url');

  /*
   * Blank counts as unset.
   *
   * `.env.example` ships these keys as `SEED_ADMIN_PASSWORD=""`, and copying
   * it to `.env` is the documented way to start. `??` only catches undefined,
   * so that empty string sailed through and every seeded account was given a
   * password of "" — while the line that prints the generated one printed
   * nothing. The setup the README tells you to follow was the one that broke.
   */
  const configured = (key: string): string | null => {
    const raw = process.env[key];
    return raw && raw.trim() ? raw : null;
  };

  const configuredAdmin = configured('SEED_ADMIN_PASSWORD');
  const adminPassword = configuredAdmin ?? generated;
  const demoPassword = configured('SEED_DEMO_PASSWORD') ?? adminPassword;

  if (!configuredAdmin && process.env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be set when seeding with NODE_ENV=production. ' +
        'Refusing to seed a production database with a password this script chose.',
    );
  }

  const harishHash = await bcrypt.hash(adminPassword, 10);
  const demoHash = await bcrypt.hash(demoPassword, 10);

  const ALL_PERMS = [
    'work.own', 'work.team', 'work.all', 'company.read', 'company.write',
    'pipeline.read', 'pipeline.write', 'money.status', 'money.figures',
    'cost.enter', 'reports.read', 'setup.admin',
  ];
  const HEAD_PERMS = ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'];
  const BD_PERMS = ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'money.status'];
  /*
   * Accounts is a real desk, and nobody was sitting at it.
   *
   * §9 defines the preset, the Money screen and the invoice flows are built
   * for it, and the roster carried nobody who held it — so the one role whose
   * whole job is money.figures + cost.enter without pipeline access could not
   * be demonstrated, and the browser suite's `accounts` persona signed in as a
   * user that did not exist. These match ROLE_PRESET_PERMISSIONS.ACCOUNTS.
   */
  const ACCOUNTS_PERMS = ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter'];
  const EMPLOYEE_PERMS = ['work.own'];

  // ──────────────────────────────────────────────────────────────────────────
  // 1. ORGANIZATION
  // ──────────────────────────────────────────────────────────────────────────
  const org = await prisma.organization.create({
    data: {
      name: 'EyeLevel Growth Studio',
      proformaPrefix: 'EL/PI',
      financialYearStart: 4,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      workingHoursStart: '10:00',
      workingHoursEnd: '19:00',
      workingDays: [1, 2, 3, 4, 5, 6],
      website: 'https://eyelevelstudio.in',
      contactEmail: 'accounts@eyelevelstudio.in',
      gstStateCode: '33',

      // CR-02 §2 — the seller block every proforma and tax invoice prints.
      //
      // The GSTIN and PAN here are PLACEHOLDERS in the statutory format, not
      // the real registration: a seed populates a demo database, and a real
      // tax registration number sitting in source control is a number that
      // ends up on a document nobody meant to issue. Settings > Documents is
      // where the actual ones are entered, and the document prints whatever
      // it finds there.
      //
      // Each one is overridable from the environment, because a seed WIPES the
      // database and these are the fields somebody types into Settings once and
      // never again. The real bank account number and IFSC had been entered in
      // the running app and existed nowhere else; the next reseed would have
      // replaced them with the zeros below without saying so. Put the real
      // values in `.env` (gitignored) and they survive every reseed.
      legalName: configured('ORG_LEGAL_NAME') ?? 'EyeLevel Growth Studio',
      // No state on the last line: §2 prints "State and state code" as its own
      // row underneath, so an address that carries it too reads it out twice.
      address: configured('ORG_ADDRESS') ?? 'No. 12, 2nd Floor, KK Nagar\nChennai 600078',
      state: 'Tamil Nadu',
      gstNumber: configured('ORG_GSTIN') ?? '33AAAAA0000A1Z5',
      pan: configured('ORG_PAN') ?? 'AAAAA0000A',
      declarationText:
        'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.',
      // The codes an agency of this shape actually bills under — advertising
      // services, and design and production — so a line item offers them
      // rather than asking someone to remember six digits.
      sacCodes: ['998365', '998386', '998311', '998313'],
      bankAccountHolderName: configured('ORG_BANK_HOLDER') ?? 'EYE LEVEL GROWTH STUDIO',
      bankName: configured('ORG_BANK_NAME') ?? 'DBS Bank',
      bankBranch: configured('ORG_BANK_BRANCH') ?? 'KK Nagar',
      bankAccountNumber: configured('ORG_BANK_ACCOUNT') ?? '000000000000000',
      bankIfscCode: configured('ORG_BANK_IFSC') ?? 'DBSS0IN0000',
    },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. USERS
  // ──────────────────────────────────────────────────────────────────────────
  /*
   * Three separate facts about a person, in three columns.
   *
   * These names used to read "Naif (Developer)" — the job title folded into
   * the name column while `designation`, which exists for exactly this and is
   * editable from /profile, sat empty. Anywhere the app showed a name it was
   * also showing a title it could not remove, and anywhere it wanted the title
   * on its own it had nothing to read.
   *
   *   name        who they are          "Naif"
   *   designation what they are called  "Developer"
   *   dept        which team            "Development"
   *   preset      what the app allows   EMPLOYEE
   */
  const mk = (data: {
    name: string; designation: string; email: string; dept: string; cost: number;
    preset: RolePreset; perms: string[]; hash?: string;
  }) => prisma.user.create({
    data: {
      organizationId: org.id,
      name: data.name,
      designation: data.designation,
      email: data.email,
      passwordHash: data.hash ?? demoHash,
      dept: data.dept,
      monthlyCost: data.cost,
      preset: data.preset,
      permissions: data.perms,
    },
  });

  const harish = await mk({ name: 'Harish S', designation: 'Management', email: 'harish.s@eyelevelstudio.in', dept: 'Management', cost: 150000, preset: RolePreset.MANAGEMENT, perms: ALL_PERMS, hash: harishHash });
  const akmal = await mk({ name: 'Akmal', designation: 'Founder', email: 'akmal@eyelevelstudio.in', dept: 'Management', cost: 150000, preset: RolePreset.MANAGEMENT, perms: ALL_PERMS });
  const dilshad = await mk({ name: 'Dilshad', designation: 'Head, Digital Marketing', email: 'dilshad@eyelevelstudio.in', dept: 'Digital Marketing', cost: 60000, preset: RolePreset.HEAD, perms: HEAD_PERMS });
  const janani = await mk({ name: 'Janani', designation: 'Head, Design', email: 'janani@eyelevelstudio.in', dept: 'Design', cost: 65000, preset: RolePreset.HEAD, perms: HEAD_PERMS });
  const charles = await mk({ name: 'Charles', designation: 'Head, Video', email: 'charles@eyelevelstudio.in', dept: 'Video & Production', cost: 62000, preset: RolePreset.HEAD, perms: HEAD_PERMS });
  const tanuja = await mk({ name: 'Tanuja', designation: 'Business Development', email: 'tanuja@eyelevelstudio.in', dept: 'Business Development', cost: 45000, preset: RolePreset.BD, perms: BD_PERMS });
  const varsha = await mk({ name: 'Varsha', designation: 'Business Development', email: 'varsha@eyelevelstudio.in', dept: 'Business Development', cost: 32000, preset: RolePreset.BD, perms: BD_PERMS });
  const sneha = await mk({ name: 'Sneha', designation: 'Designer', email: 'sneha@eyelevelstudio.in', dept: 'Design', cost: 32000, preset: RolePreset.EMPLOYEE, perms: EMPLOYEE_PERMS });
  const ramya = await mk({ name: 'Ramya', designation: 'Designer', email: 'ramya@eyelevelstudio.in', dept: 'Design', cost: 28000, preset: RolePreset.EMPLOYEE, perms: EMPLOYEE_PERMS });
  const shyam = await mk({ name: 'Shyam', designation: 'Digital Marketing', email: 'shyam@eyelevelstudio.in', dept: 'Digital Marketing', cost: 38000, preset: RolePreset.EMPLOYEE, perms: EMPLOYEE_PERMS });
  const shakila = await mk({ name: 'Shakila', designation: 'Digital Marketing', email: 'shakila@eyelevelstudio.in', dept: 'Digital Marketing', cost: 30000, preset: RolePreset.EMPLOYEE, perms: EMPLOYEE_PERMS });
  const naif = await mk({ name: 'Naif', designation: 'Developer', email: 'naif@eyelevelstudio.in', dept: 'Development', cost: 35000, preset: RolePreset.EMPLOYEE, perms: EMPLOYEE_PERMS });
  // Sees every figure and enters every cost, and cannot touch the pipeline —
  // the one combination no other person on this roster has.
  const priya = await mk({ name: 'Priya', designation: 'Accounts', email: 'priya@eyelevelstudio.in', dept: 'Accounts', cost: 34000, preset: RolePreset.ACCOUNTS, perms: ACCOUNTS_PERMS });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. COMPANIES & CONTACTS
  // ──────────────────────────────────────────────────────────────────────────
  const co = (data: {
    name: string; vertical: CompanyVertical; source: CompanySource; ownerId: string;
    city: string; status: CompanyStatus; website?: string; gstin?: string;
    billingAddress?: string; lostReason?: string;
  }) => prisma.company.create({ data: { organizationId: org.id, ...data } });

  const carlton = await co({ name: 'Carlton Wellness', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.INBOUND, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.CLIENT, website: 'https://carltonwellness.in', gstin: '33AABCC1234F1Z5', billingAddress: '42 Khader Nawaz Khan Rd, Nungambakkam, Chennai, Tamil Nadu 600006' });
  const voso = await co({ name: 'VOSO Sports', vertical: CompanyVertical.SPORTS, source: CompanySource.PARTNER_AGENCY, ownerId: akmal.id, city: 'Chennai', status: CompanyStatus.CLIENT, website: 'https://vososports.in' });
  const rightHospitals = await co({ name: 'Right Hospitals', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.REFERRAL, ownerId: dilshad.id, city: 'Chennai', status: CompanyStatus.CLIENT });
  const heavensElix = await co({ name: "Heaven's ELIX", vertical: CompanyVertical.D2C, source: CompanySource.REFERRAL, ownerId: akmal.id, city: 'Chennai', status: CompanyStatus.CLIENT });
  const tnpa = await co({ name: 'Tamil Nadu Pickleball Association', vertical: CompanyVertical.SPORTS, source: CompanySource.NETWORK, ownerId: akmal.id, city: 'Chennai', status: CompanyStatus.CLIENT });
  const daOne = await co({ name: 'Da One High Performance Sports', vertical: CompanyVertical.SPORTS, source: CompanySource.NETWORK, ownerId: akmal.id, city: 'Delhi', status: CompanyStatus.CLIENT });
  const blinkit = await co({ name: 'Blinkit South Region', vertical: CompanyVertical.RETAIL, source: CompanySource.REFERRAL, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.CLIENT, gstin: '33AAACB5678H1Z2' });
  const stylori = await co({ name: 'Stylori', vertical: CompanyVertical.D2C, source: CompanySource.OUTREACH, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.PROSPECT });
  const ramrajCotton = await co({ name: 'Ramraj Cotton', vertical: CompanyVertical.D2C, source: CompanySource.REFERRAL, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.PROSPECT });
  const kFashions = await co({ name: 'K Fashions', vertical: CompanyVertical.RETAIL, source: CompanySource.OUTREACH, ownerId: varsha.id, city: 'Chennai', status: CompanyStatus.PROSPECT });
  const elephantine = await co({ name: 'Elephantine Tales', vertical: CompanyVertical.REAL_ESTATE, source: CompanySource.NETWORK, ownerId: akmal.id, city: 'Kodaikanal', status: CompanyStatus.PROSPECT });
  const sparkAligners = await co({ name: 'Spark Aligners', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.PARTNER_AGENCY, ownerId: varsha.id, city: 'Chennai', status: CompanyStatus.PROSPECT });
  const pavilionClub = await co({ name: 'Pavilion Club', vertical: CompanyVertical.HOSPITALITY, source: CompanySource.NETWORK, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.PROSPECT });
  const zenith = await co({ name: 'Zenith FinTech Cloud', vertical: CompanyVertical.IT_AND_SAAS, source: CompanySource.OUTREACH, ownerId: tanuja.id, city: 'Bangalore', status: CompanyStatus.PROSPECT });
  const indusAlliance = await co({ name: 'Indus Alliance', vertical: CompanyVertical.B2B, source: CompanySource.OUTREACH, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.PAST, lostReason: 'Budget pulled, Jul 2026' });
  const sastry = await co({ name: 'Sastry Pain Balm', vertical: CompanyVertical.D2C, source: CompanySource.PARTNER_AGENCY, ownerId: tanuja.id, city: 'Chennai', status: CompanyStatus.PAST, lostReason: 'Took production in-house, Aug 2026' });

  await prisma.person.createMany({
    data: [
      { companyId: carlton.id, name: 'Dr. Bidya', role: PersonRole.APPROVER, email: 'bidya@carltonwellness.in', phone: '+91 98401 22334' },
      { companyId: carlton.id, name: 'Suresh', role: PersonRole.PAYER, email: 'accounts@carltonwellness.in', phone: '+91 98401 55667' },
      { companyId: voso.id, name: 'Meera Krishnan', role: PersonRole.APPROVER, email: 'meera@vososports.in', phone: '+91 98402 44556' },
      { companyId: rightHospitals.id, name: 'Dr. Kavya Somesh', role: PersonRole.APPROVER, email: 'kavya@righthospitals.in', phone: '+91 94001 22110' },
      { companyId: heavensElix.id, name: 'Farhan Ali', role: PersonRole.PAYER, email: 'farhan@heavenselix.in' },
      { companyId: tnpa.id, name: 'Ramanathan G', role: PersonRole.CONTACT, email: 'secretary@tnpa.in' },
      { companyId: daOne.id, name: 'Suhail Ahmed', role: PersonRole.APPROVER, email: 'suhail@daonesports.com' },
      { companyId: blinkit.id, name: 'Rajesh Nair', role: PersonRole.APPROVER, email: 'rajesh.nair@blinkit.com', phone: '+91 98410 99887' },
      { companyId: stylori.id, name: 'Purchase Lead', role: PersonRole.CONTACT, email: 'purchase@stylori.com' },
      { companyId: ramrajCotton.id, name: 'Sanjeev Kumar', role: PersonRole.APPROVER, email: 'sanjeev@ramrajcotton.in' },
      { companyId: zenith.id, name: 'Karthik Rao', role: PersonRole.CONTACT, email: 'karthik@zenithfintech.io', phone: '+91 98840 11223' },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. COLD OUTREACH LIST
  // ──────────────────────────────────────────────────────────────────────────
  // Every lead carries a way to reach it — that is the rule the outreach form
  // now enforces, and a seed that broke it would make the screen impossible to
  // demonstrate honestly. Two sit on FOLLOW_UP and one on MEETING so the
  // conditional date and remarks have something to show.
  const inDays = (n: number) => new Date(TODAY.getTime() + n * 86400000);
  await prisma.outreachEntry.createMany({
    data: [
      { organizationId: org.id, name: 'Prestige Group', vertical: CompanyVertical.REAL_ESTATE, source: CompanySource.OUTREACH, ownerId: varsha.id, status: OutreachStatus.NOT_CONTACTED,
        contactPersonName: 'Rajesh Kumar', phone: '98400 11223', email: null },
      { organizationId: org.id, name: 'Casagrand', vertical: CompanyVertical.REAL_ESTATE, source: CompanySource.OUTREACH, ownerId: varsha.id, status: OutreachStatus.FOLLOW_UP,
        contactPersonName: 'Meena Iyer', phone: '98410 55667', email: 'meena@casagrand.example',
        nextActionDate: inDays(2), remarks: 'Busy with a launch this week. Asked us to call back on Thursday morning.' },
      { organizationId: org.id, name: 'Kauvery Hospital', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.OUTREACH, ownerId: tanuja.id, status: OutreachStatus.MEETING,
        contactPersonName: 'Dr Anand S', phone: null, email: 'anand@kauvery.example',
        nextActionDate: inDays(4), remarks: '11:30am, offline, at their Alwarpet office. Tanuja and Janani attending.' },
      { organizationId: org.id, name: 'Zoho Partner Network', vertical: CompanyVertical.IT_AND_SAAS, source: CompanySource.OUTREACH, ownerId: tanuja.id, status: OutreachStatus.NOT_CONTACTED,
        contactPersonName: null, phone: null, email: 'partners@zoho.example' },
      { organizationId: org.id, name: 'Chennai Silks', vertical: CompanyVertical.RETAIL, source: CompanySource.OUTREACH, ownerId: varsha.id, status: OutreachStatus.INTERESTED,
        contactPersonName: 'Lakshmi R', phone: '98420 33445', email: 'lakshmi@chennaisilks.example' },
      { organizationId: org.id, name: 'HealthFirst Diagnostic Labs', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.OUTREACH, ownerId: tanuja.id, status: OutreachStatus.DEAD,
        contactPersonName: 'Front desk', phone: '44 2345 6789', email: null },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. PROPOSALS & VERSIONS
  // ──────────────────────────────────────────────────────────────────────────
  const proposal = async (data: {
    companyId: string; kind: ProposalKind; ownerId: string; stage: ProposalStage;
    outcome?: ProposalOutcome; wonAt?: Date; lostReason?: string; verbalYesAt?: Date;
    versions: { n: number; value: number; scope: string; sentAt: Date }[];
    wonVersionN?: number;
  }) => {
    const p = await prisma.proposal.create({
      data: {
        organizationId: org.id, companyId: data.companyId, kind: data.kind, ownerId: data.ownerId,
        stage: data.stage, outcome: data.outcome, wonAt: data.wonAt, lostReason: data.lostReason,
        verbalYesAt: data.verbalYesAt,
      },
    });
    const versions = await Promise.all(
      data.versions.map((v) => prisma.proposalVersion.create({
        data: { proposalId: p.id, n: v.n, value: v.value, scopeSummary: v.scope, sentAt: v.sentAt },
      })),
    );
    if (data.wonVersionN) {
      const won = versions.find((v) => v.n === data.wonVersionN)!;
      await prisma.proposal.update({ where: { id: p.id }, data: { wonVersionId: won.id } });
    }
    return { proposal: p, versions };
  };

  const { proposal: carltonProposal } = await proposal({
    companyId: carlton.id, kind: ProposalKind.RETAINER, ownerId: tanuja.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-32), wonVersionN: 2,
    versions: [
      { n: 1, value: 250000, scope: 'Comprehensive performance marketing + video + brand design', sentAt: days(-45) },
      { n: 2, value: 220000, scope: 'Retainer revised with dedicated shoot day + 18 creative deliverables/mo', sentAt: days(-38) },
    ],
  });

  const { proposal: vosoProposal } = await proposal({
    companyId: voso.id, kind: ProposalKind.RETAINER, ownerId: akmal.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-20), wonVersionN: 1,
    versions: [{ n: 1, value: 140000, scope: 'Match-day content + performance ads', sentAt: days(-28) }],
  });

  await proposal({
    companyId: rightHospitals.id, kind: ProposalKind.RETAINER, ownerId: dilshad.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-70), wonVersionN: 1,
    versions: [{ n: 1, value: 30000, scope: 'Monthly OPD awareness content', sentAt: days(-75) }],
  });

  await proposal({
    companyId: heavensElix.id, kind: ProposalKind.RETAINER, ownerId: akmal.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-150), wonVersionN: 1,
    versions: [{ n: 1, value: 35000, scope: 'Festive-season D2C content calendar', sentAt: days(-155) }],
  });

  await proposal({
    companyId: tnpa.id, kind: ProposalKind.RETAINER, ownerId: akmal.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-240), wonVersionN: 1,
    versions: [{ n: 1, value: 30000, scope: 'Team announcements + tournament coverage', sentAt: days(-245) }],
  });

  await proposal({
    companyId: daOne.id, kind: ProposalKind.RETAINER, ownerId: akmal.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-118), wonVersionN: 1,
    versions: [{ n: 1, value: 30000, scope: 'Multi-city launch story frames + reels', sentAt: days(-122) }],
  });

  await proposal({
    companyId: elephantine.id, kind: ProposalKind.PROJECT, ownerId: akmal.id, stage: ProposalStage.TALKING,
    versions: [{ n: 1, value: 0, scope: 'Resort rebrand — scope not yet quoted', sentAt: days(-11) }],
  });
  await proposal({
    companyId: sparkAligners.id, kind: ProposalKind.RETAINER, ownerId: varsha.id, stage: ProposalStage.TALKING,
    versions: [{ n: 1, value: 0, scope: 'Clear-aligner D2C launch — scope not yet quoted', sentAt: days(-19) }],
  });
  await proposal({
    companyId: stylori.id, kind: ProposalKind.RETAINER, ownerId: tanuja.id, stage: ProposalStage.PROPOSAL_SENT,
    versions: [{ n: 1, value: 200000, scope: 'Full-funnel social + performance for a fashion D2C launch', sentAt: days(-38) }],
  });
  await proposal({
    companyId: kFashions.id, kind: ProposalKind.RETAINER, ownerId: varsha.id, stage: ProposalStage.PROPOSAL_SENT,
    versions: [{ n: 1, value: 120000, scope: 'Social + Meta ads for a regional retail chain', sentAt: days(-14) }],
  });
  await proposal({
    companyId: ramrajCotton.id, kind: ProposalKind.RETAINER, ownerId: tanuja.id, stage: ProposalStage.IN_NEGOTIATION,
    versions: [
      { n: 1, value: 200000, scope: 'Full-scope brand refresh + always-on content', sentAt: days(-16) },
      { n: 2, value: 175000, scope: 'Social-only, video production dropped', sentAt: days(-9) },
    ],
  });
  await proposal({
    companyId: zenith.id, kind: ProposalKind.RETAINER, ownerId: tanuja.id, stage: ProposalStage.IN_NEGOTIATION,
    versions: [
      { n: 1, value: 300000, scope: 'Enterprise B2B demand gen + tech content strategy', sentAt: days(-12) },
      { n: 2, value: 250000, scope: 'Trimmed video frequency, focused on high-intent LinkedIn outbound', sentAt: days(-5) },
    ],
  });
  const { proposal: elephantineProjectProposal } = await proposal({
    companyId: elephantine.id, kind: ProposalKind.PROJECT, ownerId: akmal.id, stage: ProposalStage.PROFORMA_ISSUED,
    versions: [
      { n: 1, value: 290000, scope: 'Brand, site, launch film', sentAt: days(-14) },
      { n: 2, value: 260000, scope: 'Launch film trimmed to a 60-second cut', sentAt: days(-9) },
    ],
  });
  await proposal({
    companyId: pavilionClub.id, kind: ProposalKind.PROJECT, ownerId: tanuja.id, stage: ProposalStage.VERBAL_YES,
    verbalYesAt: days(-2),
    versions: [{ n: 1, value: 95000, scope: 'Membership launch campaign', sentAt: days(-6) }],
  });
  await proposal({
    companyId: indusAlliance.id, kind: ProposalKind.RETAINER, ownerId: tanuja.id, stage: ProposalStage.LOST,
    outcome: ProposalOutcome.LOST, lostReason: 'Budget pulled after Q1 review',
    versions: [{ n: 1, value: 180000, scope: 'B2B thought-leadership retainer', sentAt: days(-60) }],
  });
  await proposal({
    companyId: sastry.id, kind: ProposalKind.RETAINER, ownerId: tanuja.id, stage: ProposalStage.LOST,
    outcome: ProposalOutcome.LOST, lostReason: 'Took production in-house',
    versions: [{ n: 1, value: 60000, scope: 'D2C ayurvedic balm — always-on content', sentAt: days(-170) }],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. PROFORMAS
  // ──────────────────────────────────────────────────────────────────────────
  const carltonProforma = await prisma.proforma.create({
    data: {
      organizationId: org.id, number: `EL/PI/${FY}/012`, companyId: carlton.id,
      sourceType: ProformaSourceType.PROPOSAL, sourceId: carltonProposal.id, amount: 220000,
      raisedAt: days(-32), validTill: days(-21), billingName: 'Carlton Wellness Pvt Ltd',
      gstin: '33AABCC1234F1Z5', status: ProformaStatus.PAID,
      terms: 'Advance retainer payment for commencement of services. 100% advance on invoice generation.',
    },
  });

  const vosoProforma = await prisma.proforma.create({
    data: {
      organizationId: org.id, number: `EL/PI/${FY}/013`, companyId: voso.id,
      sourceType: ProformaSourceType.PROPOSAL, sourceId: vosoProposal.id, amount: 140000,
      raisedAt: days(-19), validTill: days(-4), billingName: 'VOSO Sports Pvt Ltd',
      terms: 'October retainer advance, 100% upfront.',
    },
  });

  const elephantineProforma = await prisma.proforma.create({
    data: {
      organizationId: org.id, number: `EL/PI/${FY}/014`, companyId: elephantine.id,
      sourceType: ProformaSourceType.PROPOSAL, sourceId: elephantineProjectProposal.id, amount: 130000,
      raisedAt: days(-14), validTill: days(1), billingName: 'Elephantine Tales LLP',
      terms: 'Advance for brand, site and launch film — 50% upfront.',
    },
  });

  /*
   * What each document actually says, line by line.
   *
   * A proforma with no line items prints a total and nothing else — no
   * particulars, no SAC code, no units — which is not a document anybody can
   * send a client. Nothing seeded these, so every PDF the app could produce
   * was a header and an amount.
   *
   * `amount` is stored rather than derived: it is part of the frozen document,
   * and a rounding rule that changes later must not change what an issued
   * document says.
   */
  const lineItems = (target: { proformaId?: string; invoiceId?: string }, rows: {
    particulars: string; units: number; unitCost: number; hsnSac: string;
  }[]) =>
    prisma.documentLineItem.createMany({
      data: rows.map((r, i) => ({
        ...target, serialNo: i + 1, particulars: r.particulars, units: r.units,
        unitCost: r.unitCost, hsnSac: r.hsnSac, amount: Math.round(r.units * r.unitCost * 100) / 100,
        gstRate: 18,
      })),
    });

  await lineItems({ proformaId: carltonProforma.id }, [
    { particulars: 'Monthly retainer — performance marketing, creative and video', units: 1, unitCost: 186440.68, hsnSac: '998365' },
    { particulars: 'Dedicated shoot day (half day, on location)', units: 1, unitCost: 0, hsnSac: '998386' },
  ]);
  await lineItems({ proformaId: vosoProforma.id }, [
    { particulars: 'Monthly retainer — social content and matchday cutdowns', units: 1, unitCost: 118644.07, hsnSac: '998365' },
  ]);
  await lineItems({ proformaId: elephantineProforma.id }, [
    { particulars: 'Brand identity and collateral system', units: 1, unitCost: 55084.75, hsnSac: '998311' },
    { particulars: 'Website design and build', units: 1, unitCost: 42372.88, hsnSac: '998313' },
    { particulars: 'Launch film — 60 second cut', units: 1, unitCost: 12711.86, hsnSac: '998386' },
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // 8. RETAINERS & MONTH CARDS
  // ──────────────────────────────────────────────────────────────────────────
  const retainer = async (data: {
    companyId: string; monthlyValue: number; startDate: Date; termMonths: number | null;
    renewalDate: Date | null; ownerId: string;
  }) => prisma.retainer.create({
    data: {
      organizationId: org.id, companyId: data.companyId, monthlyValue: data.monthlyValue,
      startDate: data.startDate, termMonths: data.termMonths, renewalDate: data.renewalDate,
      ownerId: data.ownerId, status: RetainerStatus.ACTIVE,
    },
  });

  // Renewal within 45 days — should trip "Renewal approaching".
  const carltonRetainer = await retainer({ companyId: carlton.id, monthlyValue: 220000, startDate: days(-32), termMonths: 12, renewalDate: days(18), ownerId: tanuja.id });
  // Month-to-month, no fixed term — should trip "No fixed term".
  const vosoRetainer = await retainer({ companyId: voso.id, monthlyValue: 140000, startDate: days(-20), termMonths: null, renewalDate: null, ownerId: akmal.id });
  const rightHospitalsRetainer = await retainer({ companyId: rightHospitals.id, monthlyValue: 30000, startDate: days(-70), termMonths: null, renewalDate: null, ownerId: dilshad.id });
  // Healthy renewal window, well clear of the 45-day alert.
  const heavensRetainer = await retainer({ companyId: heavensElix.id, monthlyValue: 35000, startDate: days(-150), termMonths: 6, renewalDate: days(60), ownerId: akmal.id });
  const tnpaRetainer = await retainer({ companyId: tnpa.id, monthlyValue: 30000, startDate: days(-240), termMonths: 6, renewalDate: days(107), ownerId: akmal.id });
  const daOneRetainer = await retainer({ companyId: daOne.id, monthlyValue: 30000, startDate: days(-118), termMonths: null, renewalDate: null, ownerId: akmal.id });

  const monthCard = async (retainerId: string, month: string, revenue: number, status: MonthCardStatus, closedAt?: Date) =>
    prisma.monthCard.create({ data: { retainerId, month, revenue, status, closedAt } });

  const carltonAug = await monthCard(carltonRetainer.id, LAST_MONTH, 220000, MonthCardStatus.CLOSED, days(-2));
  const carltonSep = await monthCard(carltonRetainer.id, THIS_MONTH, 220000, MonthCardStatus.OPEN);
  const vosoAug = await monthCard(vosoRetainer.id, LAST_MONTH, 140000, MonthCardStatus.CLOSED, days(-3));
  const vosoSep = await monthCard(vosoRetainer.id, THIS_MONTH, 140000, MonthCardStatus.OPEN);
  const rightAug = await monthCard(rightHospitalsRetainer.id, LAST_MONTH, 30000, MonthCardStatus.CLOSED, days(-4));
  const rightSep = await monthCard(rightHospitalsRetainer.id, THIS_MONTH, 30000, MonthCardStatus.OPEN);
  const heavensAug = await monthCard(heavensRetainer.id, LAST_MONTH, 35000, MonthCardStatus.CLOSED, days(-5));
  const heavensSep = await monthCard(heavensRetainer.id, THIS_MONTH, 35000, MonthCardStatus.OPEN);
  const tnpaAug = await monthCard(tnpaRetainer.id, LAST_MONTH, 30000, MonthCardStatus.CLOSED, days(-3));
  const tnpaSep = await monthCard(tnpaRetainer.id, THIS_MONTH, 30000, MonthCardStatus.OPEN);
  const daOneAug = await monthCard(daOneRetainer.id, LAST_MONTH, 30000, MonthCardStatus.CLOSED, days(-6));
  const daOneSep = await monthCard(daOneRetainer.id, THIS_MONTH, 30000, MonthCardStatus.OPEN);

  // ──────────────────────────────────────────────────────────────────────────
  // 8b. PROJECTS INSIDE A RETAINER
  // ──────────────────────────────────────────────────────────────────────────
  /*
   * The named pieces of work a retainer client actually buys.
   *
   * Nothing seeded these, so the screen that opens a retainer opened onto an
   * empty Projects tab and the only card on it was "Not in a project" — the
   * feature existed, was tested, and had never once been seen with data in it.
   *
   * They carry no money on purpose: the retainer is billed monthly through its
   * month cards, and a value here would be the same work counted twice. What
   * they carry instead is shape — which is why one of them deliberately spans
   * both months, one is always-on with no end date, and one is finished.
   */
  const retainerProject = (data: {
    retainerId: string; name: string; startDate?: Date; endDate?: Date | null;
    ownerId?: string; status?: RetainerProjectStatus; description?: string; isDefault?: boolean;
  }) => prisma.retainerProject.create({
    data: {
      retainerId: data.retainerId, name: data.name,
      startDate: data.startDate ?? null, endDate: data.endDate ?? null,
      ownerId: data.ownerId ?? null, status: data.status ?? RetainerProjectStatus.ACTIVE,
      description: data.description ?? null, isDefault: data.isDefault ?? false,
    },
  });

  /*
   * Every retainer starts with somewhere to put its work.
   *
   * A task on a month card names a project — the database enforces it with a
   * CHECK — so a retainer without one could not hold a task at all, and the
   * 1st-of-month roll opens an empty card and the team fills it. This is the
   * floor everything lands in; the campaigns below sit beside it.
   */
  const defaultProjects = new Map<string, string>();
  for (const [ret, owner] of [
    [carltonRetainer, tanuja], [vosoRetainer, akmal], [rightHospitalsRetainer, dilshad],
    [heavensRetainer, akmal], [tnpaRetainer, akmal], [daOneRetainer, akmal],
  ] as [{ id: string }, typeof akmal][]) {
    const made = await retainerProject({
      retainerId: ret.id, name: 'Monthly Retainer Work', ownerId: owner.id, isDefault: true,
      description: 'The monthly work this retainer is for. Campaigns and one-off pieces sit beside it.',
    });
    defaultProjects.set(ret.id, made.id);
  }

  // Carlton — a campaign that runs across the month boundary, which is the
  // whole reason this model exists, plus the stream that never ends.
  const carltonDiwali = await retainerProject({
    retainerId: carltonRetainer.id, name: 'Diwali Campaign', startDate: days(-20), endDate: days(25),
    ownerId: dilshad.id,
    description: 'Festive push across Meta and Google — statics, reels and a 30-second brand film.',
  });
  const carltonAlwaysOn = await retainerProject({
    retainerId: carltonRetainer.id, name: 'Always-on Content', startDate: days(-32), endDate: null,
    ownerId: sneha.id,
    description: 'The monthly baseline: calendar, statics, reels and the growth report.',
  });
  const carltonRebrand = await retainerProject({
    retainerId: carltonRetainer.id, name: 'Clinic Rebrand Rollout', startDate: days(-60), endDate: days(-8),
    ownerId: janani.id, status: RetainerProjectStatus.DONE,
    description: 'Signage, collateral and profile refresh after the new identity landed.',
  });

  // VOSO — one campaign, so the retainer page has a second shape to show.
  const vosoLeague = await retainerProject({
    retainerId: vosoRetainer.id, name: 'League Season Launch', startDate: days(-14), endDate: days(40),
    ownerId: charles.id,
    description: 'Fixture announcements, player features and matchday cutdowns.',
  });

  // Heaven's ELIX — always-on only, no dates at all, which must read as
  // "ongoing" rather than as missing information.
  const heavensAlwaysOn = await retainerProject({
    retainerId: heavensRetainer.id, name: 'Always-on Content', ownerId: shakila.id,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. PROJECTS & MILESTONES
  // ──────────────────────────────────────────────────────────────────────────
  const project = async (data: {
    companyId: string; name: string; quotedValue: number; estimatedCost: number;
    startDate: Date; endDate: Date; ownerId: string; status: ProjectStatus; priority: Priority;
    description?: string;
  }) => prisma.project.create({
    data: {
      organizationId: org.id, companyId: data.companyId, name: data.name, quotedValue: data.quotedValue,
      estimatedCost: data.estimatedCost, startDate: data.startDate, endDate: data.endDate,
      ownerId: data.ownerId, status: data.status, priority: data.priority, description: data.description,
    },
  });

  const carltonWebsite = await project({ companyId: carlton.id, name: 'Website Build', quotedValue: 150000, estimatedCost: 55000, startDate: days(-40), endDate: days(30), ownerId: naif.id, status: ProjectStatus.LIVE, priority: Priority.MEDIUM, description: 'Full rebuild on Next.js with a booking widget.' });
  const tnpaSeason2 = await project({ companyId: tnpa.id, name: 'Season 2 Website', quotedValue: 150000, estimatedCost: 60000, startDate: days(-70), endDate: days(-5), ownerId: naif.id, status: ProjectStatus.LIVE, priority: Priority.HIGH, description: 'Behind schedule — client sign-off slipped twice.' });
  const vosoDroneFilms = await project({ companyId: voso.id, name: 'Drone Show Films', quotedValue: 420000, estimatedCost: 190000, startDate: days(-55), endDate: days(75), ownerId: charles.id, status: ProjectStatus.LIVE, priority: Priority.URGENT, description: 'Over budget on drone crew day-rate — running cost review.' });
  const daOneApartment = await project({ companyId: daOne.id, name: 'Model Apartment Shoot', quotedValue: 95000, estimatedCost: 38000, startDate: days(-90), endDate: days(-40), ownerId: charles.id, status: ProjectStatus.DELIVERED, priority: Priority.LOW });
  const daOneSponsorship = await project({ companyId: daOne.id, name: 'Sponsorship Deck', quotedValue: 60000, estimatedCost: 18000, startDate: days(-20), endDate: days(10), ownerId: akmal.id, status: ProjectStatus.LIVE, priority: Priority.MEDIUM });
  const elephantineDoc = await project({ companyId: elephantine.id, name: '75 Years Documentary', quotedValue: 480000, estimatedCost: 210000, startDate: days(-30), endDate: days(180), ownerId: charles.id, status: ProjectStatus.LIVE, priority: Priority.MEDIUM });
  const heavensPackaging = await project({ companyId: heavensElix.id, name: 'Packaging Refresh', quotedValue: 80000, estimatedCost: 30000, startDate: days(-100), endDate: days(-60), ownerId: sneha.id, status: ProjectStatus.DELIVERED, priority: Priority.LOW });
  const rightHospitalsMicrosite = await project({ companyId: rightHospitals.id, name: 'OPD Microsite', quotedValue: 70000, estimatedCost: 28000, startDate: days(-15), endDate: days(45), ownerId: naif.id, status: ProjectStatus.CANCELLED, priority: Priority.LOW, description: 'Cancelled — client paused all web spend for the quarter.' });

  const milestones = async (projectId: string, quoted: number, rows: { label: string; percent: number; status: MilestoneStatus }[]) =>
    prisma.milestone.createMany({
      data: rows.map((r, i) => ({ projectId, label: r.label, percent: r.percent, amount: Math.round(quoted * r.percent / 100), status: r.status, order: i + 1 })),
    });

  await milestones(carltonWebsite.id, 150000, [
    { label: 'Advance Payment', percent: 40, status: MilestoneStatus.PAID },
    { label: 'Design Sign-off', percent: 30, status: MilestoneStatus.INVOICED },
    { label: 'Final Launch & Handover', percent: 30, status: MilestoneStatus.PENDING },
  ]);
  await milestones(tnpaSeason2.id, 150000, [
    { label: 'Advance Payment', percent: 40, status: MilestoneStatus.PAID },
    { label: 'Beta Review', percent: 30, status: MilestoneStatus.PENDING },
    { label: 'Launch & Handover', percent: 30, status: MilestoneStatus.PENDING },
  ]);
  await milestones(vosoDroneFilms.id, 420000, [
    { label: 'Pre-Production Advance', percent: 30, status: MilestoneStatus.PAID },
    { label: 'Principal Photography', percent: 40, status: MilestoneStatus.PROFORMA_RAISED },
    { label: 'Final Cut Delivery', percent: 30, status: MilestoneStatus.PENDING },
  ]);
  await milestones(daOneApartment.id, 95000, [
    { label: 'Advance Payment', percent: 50, status: MilestoneStatus.PAID },
    { label: 'Final Delivery', percent: 50, status: MilestoneStatus.PAID },
  ]);
  await milestones(daOneSponsorship.id, 60000, [
    { label: 'Advance Payment', percent: 50, status: MilestoneStatus.PAID },
    { label: 'Final Delivery', percent: 50, status: MilestoneStatus.PENDING },
  ]);
  await milestones(elephantineDoc.id, 480000, [
    { label: 'Pre-Production Advance', percent: 30, status: MilestoneStatus.PAID },
    { label: 'Rough Cut Sign-off', percent: 30, status: MilestoneStatus.PENDING },
    { label: 'Final Delivery', percent: 40, status: MilestoneStatus.PENDING },
  ]);
  await milestones(heavensPackaging.id, 80000, [
    { label: 'Advance Payment', percent: 50, status: MilestoneStatus.PAID },
    { label: 'Final Delivery', percent: 50, status: MilestoneStatus.PAID },
  ]);
  await milestones(rightHospitalsMicrosite.id, 70000, [
    { label: 'Advance Payment', percent: 40, status: MilestoneStatus.PAID },
    { label: 'Final Delivery', percent: 60, status: MilestoneStatus.PENDING },
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // 10. TASKS — retainer month-card work, project work and internal work
  // ──────────────────────────────────────────────────────────────────────────
  type TaskRow = {
    title: string; workType: TaskWorkType; workId?: string; monthCardId?: string; projectId?: string;
    /**
     * Which piece of retainer work it is part of. Set ALONGSIDE monthCardId,
     * never instead of it — the month says which card bills the task, this
     * says what the task is for, and a database trigger refuses a pair that
     * belongs to two different retainers.
     */
    retainerProjectId?: string | null;
    assigneeId: string; createdById: string; dueDate: Date; assignedAt: Date; completedAt?: Date;
    status: TaskStatus; priority?: Priority; waitingOn?: WaitingOn; waitingSince?: Date; waitingTotalMinutes?: number;
    /** Who checks it before it counts as done. Only some work needs one. */
    reviewerId?: string;
    /** The desk it belongs to — what §8's "task type average" groups by. */
    taskType?: TaskType;
    notes?: string;
  };
  const taskRows: TaskRow[] = [];

  // Recurring titles reused across month cards, DONE with varied elapsed time,
  // so computeTaskTypeMedians (needs >= 3 same-title completions) has real
  // groups to show on My Work as "usually ~Xh".
  const recurring = [
    { title: 'Monthly Social Media Calendar & Concept', dept: 'marketing' },
    { title: 'Ad Creative Batch 1 (4 Statics + 2 Reels)', dept: 'design' },
    { title: 'Performance Ad Campaign Optimization', dept: 'marketing' },
  ];
  const marketingPeople = [dilshad, shyam, shakila];
  const designPeople = [janani, sneha, ramya];
  /*
   * `project` here is what makes a campaign cross a month.
   *
   * Carlton's Diwali push starts in the closed month and finishes in the open
   * one, so its tasks sit on two different month cards — two piles that the
   * month view can never join, and the one thing a retainer project is for.
   * Opening it shows both months under one heading, with the closed one marked
   * as closed.
   */
  const augRetainers: { card: { id: string }; dept: string; project?: string; baseline?: string; fallback: string }[] = [
    { card: carltonAug, dept: 'both', project: carltonDiwali.id, baseline: carltonAlwaysOn.id, fallback: defaultProjects.get(carltonRetainer.id)! },
    { card: vosoAug, dept: 'both', fallback: defaultProjects.get(vosoRetainer.id)! },
    { card: rightAug, dept: 'marketing', fallback: defaultProjects.get(rightHospitalsRetainer.id)! },
    { card: heavensAug, dept: 'marketing', baseline: heavensAlwaysOn.id, fallback: defaultProjects.get(heavensRetainer.id)! },
    { card: tnpaAug, dept: 'marketing', fallback: defaultProjects.get(tnpaRetainer.id)! },
    { card: daOneAug, dept: 'design', fallback: defaultProjects.get(daOneRetainer.id)! },
  ];
  let recurringOffset = 0;
  for (const { card, dept, project, baseline, fallback } of augRetainers) {
    for (const [ri, r] of recurring.entries()) {
      if (dept !== 'both' && dept !== r.dept) continue;
      const people = r.dept === 'design' ? designPeople : marketingPeople;
      const assignee = people[recurringOffset % people.length];
      const assignedAt = days(-30 + (recurringOffset % 5));
      const elapsedHours = 6 + (recurringOffset % 6) * 5; // spreads medians across a real range
      taskRows.push({
        title: r.title, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id,
        // The first line of the month goes to the campaign, the rest to the
        // baseline stream — so the campaign genuinely spans two cards and the
        // baseline has a run of months behind it.
        retainerProjectId: (ri === 0 ? project : baseline) ?? baseline ?? fallback,
        assigneeId: assignee.id, createdById: dilshad.id, dueDate: days(-28 + (recurringOffset % 5)),
        assignedAt, completedAt: new Date(assignedAt.getTime() + elapsedHours * 3600000),
        status: TaskStatus.DONE,
        taskType: r.dept === 'design' ? TaskType.DESIGN : TaskType.DIGITAL_MARKETING,
      });
      recurringOffset++;
    }
  }

  /*
   * The finished campaign's own work.
   *
   * A project marked DONE with no tasks under it renders as an empty drill-in,
   * which reads as "nothing happened" rather than "this is finished". Its work
   * sits on the closed month, which is also what it looks like to open a
   * completed campaign: every row done, and the month shut behind it.
   */
  for (const [title, who, offset] of [
    ['Clinic Signage Artwork — Final Files', janani, -26],
    ['Reception & Collateral Print Handover', sneha, -18],
    ['Google Business Profile Refresh', shakila, -12],
  ] as [string, typeof janani, number][]) {
    const assignedAt = days(offset - 5);
    taskRows.push({
      title, workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id,
      retainerProjectId: carltonRebrand.id, assigneeId: who.id, createdById: janani.id,
      dueDate: days(offset), assignedAt,
      completedAt: new Date(assignedAt.getTime() + 26 * 3600000),
      status: TaskStatus.DONE, taskType: TaskType.DESIGN,
    });
  }

  // September (open) month-card work — the live board for each retainer,
  // spread across overdue / today / this-week / done / on-hold.
  /*
   * `campaign` and `baseline` are the two projects a month's work falls under.
   *
   * Not every card has them, and that is deliberate: Right Hospitals, TNPA and
   * Da One run with nothing named, so the "Not in a project" card is never an
   * empty state nobody has seen. Carlton's campaign also appears on LAST
   * month's card below, which is the case the whole model exists for.
   */
  const sepCards: {
    card: { id: string }; lead: typeof dilshad; people: (typeof sneha)[];
    campaign?: string; baseline?: string; fallback: string; kind: TaskType;
  }[] = [
    { card: carltonSep, lead: dilshad, people: [sneha, shyam], campaign: carltonDiwali.id, baseline: carltonAlwaysOn.id, fallback: defaultProjects.get(carltonRetainer.id)!, kind: TaskType.DIGITAL_MARKETING },
    { card: vosoSep, lead: janani, people: [ramya, sneha], campaign: vosoLeague.id, fallback: defaultProjects.get(vosoRetainer.id)!, kind: TaskType.VIDEO },
    { card: rightSep, lead: dilshad, people: [shakila], fallback: defaultProjects.get(rightHospitalsRetainer.id)!, kind: TaskType.DIGITAL_MARKETING },
    { card: heavensSep, lead: dilshad, people: [shyam], baseline: heavensAlwaysOn.id, fallback: defaultProjects.get(heavensRetainer.id)!, kind: TaskType.DIGITAL_MARKETING },
    { card: tnpaSep, lead: janani, people: [ramya], fallback: defaultProjects.get(tnpaRetainer.id)!, kind: TaskType.DESIGN },
    { card: daOneSep, lead: charles, people: [janani], fallback: defaultProjects.get(daOneRetainer.id)!, kind: TaskType.VIDEO },
  ];
  const titlesByCard = [
    'October Instagram Growth Content Calendar', 'Ad Creatives Batch 1: Static Banners',
    'Ad Creatives Batch 2: Reel Cutdowns', 'Brand Video Script Sign-off from Client',
    'Meta Ads Optimization Pass', 'Monthly Growth & ROAS Report',
  ];
  sepCards.forEach(({ card, lead, people, campaign, baseline, fallback, kind }, ci) => {
    // Overdue
    taskRows.push({ title: `${titlesByCard[0]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[0].id, createdById: lead.id, dueDate: days(-2), assignedAt: days(-6), status: TaskStatus.TODO, retainerProjectId: campaign ?? fallback, taskType: kind });
    // Due today
    taskRows.push({ title: `${titlesByCard[1]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[people.length - 1].id, createdById: lead.id, dueDate: days(0), assignedAt: days(-1), status: TaskStatus.IN_PROGRESS, retainerProjectId: campaign ?? fallback, taskType: kind, reviewerId: lead.id });
    // Due this week
    taskRows.push({ title: `${titlesByCard[2]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[0].id, createdById: lead.id, dueDate: days(4), assignedAt: days(0), status: TaskStatus.TODO, retainerProjectId: baseline ?? fallback, taskType: kind });
    // Blocked on client
    taskRows.push({ title: `${titlesByCard[3]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: lead.id, createdById: lead.id, dueDate: days(6), assignedAt: days(-2), status: TaskStatus.ON_HOLD, waitingOn: WaitingOn.CLIENT, waitingSince: days(-1), waitingTotalMinutes: 720, retainerProjectId: fallback, taskType: kind, notes: 'Chased twice on WhatsApp. Client is waiting on their own legal sign-off.' });
    // Done, feeds the recurring-title median for Perf Ad Optimization too
    const doneAssigned = days(-4);
    taskRows.push({ title: `${titlesByCard[4]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[0].id, createdById: lead.id, dueDate: days(-1), assignedAt: doneAssigned, completedAt: new Date(doneAssigned.getTime() + 9 * 3600000), status: TaskStatus.DONE, retainerProjectId: baseline ?? fallback, taskType: kind });
    // Cancelled
    taskRows.push({ title: `${titlesByCard[5]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: lead.id, createdById: lead.id, dueDate: days(2), assignedAt: days(-3), status: TaskStatus.CANCELLED, retainerProjectId: fallback, taskType: kind });
  });

  // Project work
  const projectTaskPlan: { project: { id: string }; rows: [string, typeof naif, TaskStatus, number][] }[] = [
    { project: carltonWebsite, rows: [
      ['Homepage Hero Section Design', sneha, TaskStatus.DONE, -25],
      ['Booking Widget Integration', naif, TaskStatus.IN_PROGRESS, 8],
      ['Content Migration & QA', naif, TaskStatus.TODO, 15],
    ] },
    { project: tnpaSeason2, rows: [
      ['Homepage Wireframes', ramya, TaskStatus.DONE, -30],
      ['Client Sign-off on Beta', naif, TaskStatus.ON_HOLD, -3],
      ['Payment Gateway Integration', naif, TaskStatus.TODO, 20],
    ] },
    { project: vosoDroneFilms, rows: [
      ['Drone Permit Filing', charles, TaskStatus.DONE, -40],
      ['Principal Photography Day 1', charles, TaskStatus.DONE, -20],
      ['Rough Cut Assembly', charles, TaskStatus.IN_PROGRESS, 6],
      ['Colour Grade Pass', ramya, TaskStatus.TODO, 25],
    ] },
    { project: daOneApartment, rows: [
      ['Shoot Day Coordination', charles, TaskStatus.DONE, -85],
      ['Final Delivery Package', charles, TaskStatus.DONE, -42],
    ] },
    { project: daOneSponsorship, rows: [
      ['Deck Copywriting', akmal, TaskStatus.DONE, -15],
      ['Design Layout Pass', sneha, TaskStatus.IN_PROGRESS, 4],
    ] },
    { project: elephantineDoc, rows: [
      ['Archive Footage Sourcing', charles, TaskStatus.DONE, -25],
      ['Interview Shoot Schedule', charles, TaskStatus.TODO, 12],
      ['Rough Cut Sign-off Review', akmal, TaskStatus.TODO, 45],
    ] },
    { project: heavensPackaging, rows: [
      ['Packaging Mockup Round 1', sneha, TaskStatus.DONE, -95],
      ['Print-ready File Handover', sneha, TaskStatus.DONE, -62],
    ] },
    { project: rightHospitalsMicrosite, rows: [
      ['Microsite Wireframes', naif, TaskStatus.CANCELLED, -8],
    ] },
  ];
  for (const { project: p, rows } of projectTaskPlan) {
    for (const [title, assignee, status, dueOffset] of rows) {
      const assignedAt = days(dueOffset - 6);
      taskRows.push({
        title, workType: TaskWorkType.PROJECT, workId: p.id, projectId: p.id,
        assigneeId: assignee.id, createdById: akmal.id, dueDate: days(dueOffset), assignedAt,
        completedAt: status === TaskStatus.DONE ? new Date(assignedAt.getTime() + 30 * 3600000) : undefined,
        status,
      });
    }
  }

  // Internal / company work — no month card or project attached.
  const internalRows: [string, typeof harish, TaskStatus, number][] = [
    ['Clock Audit — September Payroll Prep', akmal, TaskStatus.TODO, 13],
    ['Quarterly Team Review Prep', harish, TaskStatus.IN_PROGRESS, 5],
    ['New Hire Onboarding — Design Intern', janani, TaskStatus.TODO, 9],
    ['Office Wi-Fi Vendor Renewal', akmal, TaskStatus.DONE, -10],
    ['Studio Portfolio Site Refresh', naif, TaskStatus.ON_HOLD, 30],
    ['Annual GST Filing Prep', akmal, TaskStatus.TODO, 20],
    ['New Business Deck Refresh', tanuja, TaskStatus.IN_PROGRESS, 7],
    ['Server Backup Policy Review', naif, TaskStatus.DONE, -18],
  ];
  for (const [title, assignee, status, dueOffset] of internalRows) {
    const assignedAt = days(dueOffset - 8);
    taskRows.push({
      title, workType: TaskWorkType.INTERNAL, assigneeId: assignee.id, createdById: harish.id,
      dueDate: days(dueOffset), assignedAt,
      completedAt: status === TaskStatus.DONE ? new Date(assignedAt.getTime() + 20 * 3600000) : undefined,
      status,
    });
  }

  await prisma.task.createMany({
    data: taskRows.map((t) => ({
      organizationId: org.id, title: t.title, workType: t.workType, workId: t.workId, monthCardId: t.monthCardId,
      projectId: t.projectId, retainerProjectId: t.retainerProjectId ?? null,
      assigneeId: t.assigneeId, createdById: t.createdById, dueDate: t.dueDate,
      reviewerId: t.reviewerId, taskType: t.taskType, notes: t.notes,
      // Who asked for the work. The seed has no separate notion of it, so it is
      // whoever raised the task — the same fallback the create route uses.
      assignedById: t.createdById,
      assignedAt: t.assignedAt, completedAt: t.completedAt, status: t.status, priority: t.priority ?? Priority.MEDIUM,
      waitingOn: t.waitingOn, waitingSince: t.waitingSince, waitingTotalMinutes: t.waitingTotalMinutes ?? 0,
    })),
  });

  /*
   * Every task also needs its row in `task_assignees`.
   *
   * `assigneeId` is the lead and the join is everybody on it, the lead
   * included. My Work asks `assignees: { some: { userId } }` and a person's
   * load reads `taskAssignments` — neither of them looks at `assigneeId` — so
   * a task with no row here belongs to nobody as far as the product is
   * concerned. `createMany` cannot write a nested relation, which is why this
   * is a second pass rather than part of the call above: without it the seed
   * produced seventy-seven tasks and an empty My Work screen for all twelve
   * people, which is the one screen the whole product is built around.
   *
   * The same pairing exists in `workers/monthCard.cron.ts`, with the same note.
   */
  const seededTasks = await prisma.task.findMany({
    where: { organizationId: org.id },
    select: { id: true, assigneeId: true },
  });
  await prisma.taskAssignee.createMany({
    data: seededTasks.map((t) => ({ taskId: t.id, userId: t.assigneeId })),
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. COSTS — direct (per job) and company overhead
  // ──────────────────────────────────────────────────────────────────────────
  const directCosts = [
    { monthCardId: carltonSep.id, category: 'Ad Spend', vendor: 'Meta Ads Manager', amount: 40000, incurredAt: days(-1), by: shyam },
    { monthCardId: carltonSep.id, category: 'Photography', vendor: 'Arun Studio Photography', amount: 15000, incurredAt: days(-2), by: dilshad },
    { monthCardId: vosoSep.id, category: 'Ad Spend', vendor: 'Meta Ads Manager', amount: 52000, incurredAt: days(-3), by: janani },
    { monthCardId: heavensSep.id, category: 'Influencer Fee', vendor: 'Local D2C Creators', amount: 4000, incurredAt: days(-4), by: dilshad },
    { monthCardId: rightSep.id, category: 'Stock Assets', vendor: 'Freepik', amount: 6000, incurredAt: days(-5), by: shakila },
    { monthCardId: tnpaSep.id, category: 'Print Collateral', vendor: 'Local Print Shop', amount: 2000, incurredAt: days(-6), by: janani },
    { monthCardId: daOneSep.id, category: 'Freelancer', vendor: 'Editing Freelancer', amount: 19000, incurredAt: days(-7), by: charles },
  ];
  const projectCosts = [
    { projectId: carltonWebsite.id, category: 'Hosting', vendor: 'Hostinger', amount: 8000, incurredAt: days(-14), by: naif },
    { projectId: carltonWebsite.id, category: 'Stock', vendor: 'Freepik', amount: 2000, incurredAt: days(-16), by: naif },
    { projectId: tnpaSeason2.id, category: 'Third-Party API', vendor: 'Razorpay', amount: 5000, incurredAt: days(-20), by: naif },
    // Pushes actualCostTotal well past estimatedCost (190000) to trip PROJECT_OVER_ESTIMATE.
    { projectId: vosoDroneFilms.id, category: 'Drone Crew Day-Rate', vendor: 'SkyCam Aerials', amount: 110000, incurredAt: days(-18), by: charles },
    { projectId: vosoDroneFilms.id, category: 'Location Permit', vendor: 'Chennai Corporation', amount: 60000, incurredAt: days(-19), by: charles },
    { projectId: vosoDroneFilms.id, category: 'Editing Freelancer', vendor: 'Post House Chennai', amount: 45000, incurredAt: days(-10), by: charles },
    { projectId: elephantineDoc.id, category: 'Archive Footage License', vendor: 'Getty Archives', amount: 22000, incurredAt: days(-22), by: charles },
    { projectId: daOneApartment.id, category: 'Location Rental', vendor: 'Model Apartment Owner', amount: 6000, incurredAt: days(-88), by: charles },
  ];
  await prisma.cost.createMany({
    data: [...directCosts, ...projectCosts].map((c: any) => ({
      organizationId: org.id, type: CostType.DIRECT, workType: c.monthCardId ? TaskWorkType.MONTH_CARD : TaskWorkType.PROJECT,
      workId: c.monthCardId ?? c.projectId, monthCardId: c.monthCardId, projectId: c.projectId, category: c.category,
      vendor: c.vendor, amount: c.amount, incurredAt: c.incurredAt, paidBy: CostPaidBy.COMPANY,
      treatment: CostTreatment.COMPANY_EXPENSE, enteredById: c.by.id,
    })),
  });

  await prisma.cost.createMany({
    data: [
      // Entered by Accounts, which is whose job this is — and what makes the
      // "entered by" column on the cost register show more than one name.
      { organizationId: org.id, type: CostType.COMPANY, category: 'Salaries', vendor: 'Payroll', amount: 662000, incurredAt: days(-1), enteredById: priya.id, recurring: true },
      { organizationId: org.id, type: CostType.COMPANY, category: 'Office Rent', vendor: 'Nungambakkam Commercial Properties', amount: 65000, incurredAt: days(-1), enteredById: priya.id, recurring: true },
      { organizationId: org.id, type: CostType.COMPANY, category: 'Software & Tools', vendor: 'Adobe / Figma / Vercel', amount: 18000, incurredAt: days(-1), enteredById: priya.id, recurring: true },
      { organizationId: org.id, type: CostType.COMPANY, category: 'Internet & Utilities', vendor: 'Airtel Broadband / TNEB', amount: 9500, incurredAt: days(-1), enteredById: akmal.id, recurring: true, treatment: CostTreatment.AKMAL_LOAN, paidBy: CostPaidBy.AKMAL },
      { organizationId: org.id, type: CostType.COMPANY, category: 'Pantry & Tea', vendor: 'Local Vendor', amount: 4800, incurredAt: days(-2), enteredById: akmal.id },
    ],
  });

  // A couple of soft-deleted costs, to exercise Setup → Trash restore.
  await prisma.cost.createMany({
    data: [
      { organizationId: org.id, type: CostType.COMPANY, category: 'Duplicate Software Charge', vendor: 'Adobe', amount: 4500, incurredAt: days(-6), enteredById: akmal.id, deletedAt: days(-1) },
      { organizationId: org.id, type: CostType.DIRECT, workType: TaskWorkType.PROJECT, workId: carltonWebsite.id, projectId: carltonWebsite.id, category: 'Duplicate Stock Purchase', vendor: 'Freepik', amount: 1200, incurredAt: days(-9), enteredById: naif.id, deletedAt: days(-2) },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 12. PEOPLE ALLOCATION
  // ──────────────────────────────────────────────────────────────────────────
  // August — confirmed (closed month).
  await prisma.peopleAllocation.createMany({
    data: [
      { userId: dilshad.id, month: LAST_MONTH, workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id, proposedPercent: 45, percent: 45, confirmedById: harish.id, confirmedAt: days(-3) },
      { userId: sneha.id, month: LAST_MONTH, workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id, proposedPercent: 30, percent: 30, confirmedById: harish.id, confirmedAt: days(-3) },
      { userId: shyam.id, month: LAST_MONTH, workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id, proposedPercent: 25, percent: 25, confirmedById: harish.id, confirmedAt: days(-3) },
      { userId: janani.id, month: LAST_MONTH, workType: TaskWorkType.MONTH_CARD, workId: vosoAug.id, monthCardId: vosoAug.id, proposedPercent: 50, percent: 50, confirmedById: harish.id, confirmedAt: days(-4) },
      { userId: ramya.id, month: LAST_MONTH, workType: TaskWorkType.MONTH_CARD, workId: vosoAug.id, monthCardId: vosoAug.id, proposedPercent: 50, percent: 50, confirmedById: harish.id, confirmedAt: days(-4) },
      { userId: charles.id, month: LAST_MONTH, workType: TaskWorkType.PROJECT, workId: vosoDroneFilms.id, projectId: vosoDroneFilms.id, proposedPercent: 60, percent: 60, confirmedById: harish.id, confirmedAt: days(-5) },
    ],
  });
  // September — a mix of confirmed and still-proposed, to exercise the
  // Time Split confirm workflow.
  await prisma.peopleAllocation.createMany({
    data: [
      { userId: dilshad.id, month: THIS_MONTH, workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, monthCardId: carltonSep.id, proposedPercent: 45, percent: 45, confirmedById: harish.id, confirmedAt: days(-1) },
      { userId: sneha.id, month: THIS_MONTH, workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, monthCardId: carltonSep.id, proposedPercent: 30, percent: 30 },
      { userId: shyam.id, month: THIS_MONTH, workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, monthCardId: carltonSep.id, proposedPercent: 25, percent: 25 },
      { userId: janani.id, month: THIS_MONTH, workType: TaskWorkType.MONTH_CARD, workId: vosoSep.id, monthCardId: vosoSep.id, proposedPercent: 50, percent: 50, confirmedById: harish.id, confirmedAt: days(0) },
      { userId: ramya.id, month: THIS_MONTH, workType: TaskWorkType.MONTH_CARD, workId: vosoSep.id, monthCardId: vosoSep.id, proposedPercent: 50, percent: 50 },
      { userId: charles.id, month: THIS_MONTH, workType: TaskWorkType.PROJECT, workId: vosoDroneFilms.id, projectId: vosoDroneFilms.id, proposedPercent: 65, percent: 65, confirmedById: harish.id, confirmedAt: days(0) },
      { userId: naif.id, month: THIS_MONTH, workType: TaskWorkType.PROJECT, workId: carltonWebsite.id, projectId: carltonWebsite.id, proposedPercent: 40, percent: 40 },
      { userId: naif.id, month: THIS_MONTH, workType: TaskWorkType.PROJECT, workId: tnpaSeason2.id, projectId: tnpaSeason2.id, proposedPercent: 35, percent: 35 },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 13. INVOICES & PAYMENTS
  // ──────────────────────────────────────────────────────────────────────────
  const carltonAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0142`, companyId: carlton.id, workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, amount: 220000, raisedAt: days(-32), dueAt: days(-18), status: InvoiceStatus.PAID, paidAt: days(-22) } });
  await prisma.monthCard.update({ where: { id: carltonAug.id }, data: { invoiceId: carltonAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: carltonAugInvoice.id, amount: 220000, receivedAt: days(-22), mode: 'NEFT', reference: 'HDFC00293849102' } });

  const carltonSepInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0188`, companyId: carlton.id, workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, amount: 220000, raisedAt: days(-1), dueAt: days(13), status: InvoiceStatus.RAISED } });
  await prisma.monthCard.update({ where: { id: carltonSep.id }, data: { invoiceId: carltonSepInvoice.id } });

  const vosoAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0143`, companyId: voso.id, workType: TaskWorkType.MONTH_CARD, workId: vosoAug.id, amount: 140000, raisedAt: days(-30), dueAt: days(-16), status: InvoiceStatus.PAID, paidAt: days(-19) } });
  await prisma.monthCard.update({ where: { id: vosoAug.id }, data: { invoiceId: vosoAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: vosoAugInvoice.id, amount: 140000, receivedAt: days(-19), mode: 'UPI', reference: 'UPI2609887654' } });

  // Overdue — past its due date, not yet paid.
  const rightAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0139`, companyId: rightHospitals.id, workType: TaskWorkType.MONTH_CARD, workId: rightAug.id, amount: 30000, raisedAt: days(-35), dueAt: days(-10), status: InvoiceStatus.OVERDUE } });
  await prisma.monthCard.update({ where: { id: rightAug.id }, data: { invoiceId: rightAugInvoice.id } });

  const heavensAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0140`, companyId: heavensElix.id, workType: TaskWorkType.MONTH_CARD, workId: heavensAug.id, amount: 35000, raisedAt: days(-34), dueAt: days(-20), status: InvoiceStatus.PAID, paidAt: days(-25) } });
  await prisma.monthCard.update({ where: { id: heavensAug.id }, data: { invoiceId: heavensAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: heavensAugInvoice.id, amount: 35000, receivedAt: days(-25), mode: 'NEFT', reference: 'HDFC00291122334' } });

  const tnpaAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0141`, companyId: tnpa.id, workType: TaskWorkType.MONTH_CARD, workId: tnpaAug.id, amount: 30000, raisedAt: days(-33), dueAt: days(-19), status: InvoiceStatus.PAID, paidAt: days(-24) } });
  await prisma.monthCard.update({ where: { id: tnpaAug.id }, data: { invoiceId: tnpaAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: tnpaAugInvoice.id, amount: 30000, receivedAt: days(-24), mode: 'NEFT', reference: 'HDFC00291122335' } });

  const daOneAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0144`, companyId: daOne.id, workType: TaskWorkType.MONTH_CARD, workId: daOneAug.id, amount: 30000, raisedAt: days(-31), dueAt: days(-17), status: InvoiceStatus.RAISED } });
  await prisma.monthCard.update({ where: { id: daOneAug.id }, data: { invoiceId: daOneAugInvoice.id } });

  // Project-linked invoices (milestone billing), one cancelled for variety.
  const carltonWebsiteInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0135`, companyId: carlton.id, workType: TaskWorkType.PROJECT, workId: carltonWebsite.id, projectId: carltonWebsite.id, amount: 60000, raisedAt: days(-38), dueAt: days(-24), status: InvoiceStatus.PAID, paidAt: days(-33) } });
  // A settled invoice needs the payment that settled it: balance due is
  // `amount - sum(payments)`, so PAID with no payment row reads as money
  // still owed on an invoice nobody owes anything on.
  await prisma.payment.create({ data: { invoiceId: carltonWebsiteInvoice.id, amount: 60000, receivedAt: days(-33), mode: 'NEFT', reference: 'HDFC00290011223' } });
  const daOneApartmentInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0136`, companyId: daOne.id, workType: TaskWorkType.PROJECT, workId: daOneApartment.id, projectId: daOneApartment.id, amount: 47500, raisedAt: days(-88), dueAt: days(-74), status: InvoiceStatus.PAID, paidAt: days(-80) } });
  await prisma.payment.create({ data: { invoiceId: daOneApartmentInvoice.id, amount: 47500, receivedAt: days(-80), mode: 'NEFT', reference: 'HDFC00288776655' } });
  await prisma.invoice.create({ data: { organizationId: org.id, number: `INV/${FY}/0137`, companyId: rightHospitals.id, workType: TaskWorkType.PROJECT, workId: rightHospitalsMicrosite.id, projectId: rightHospitalsMicrosite.id, amount: 28000, raisedAt: days(-15), dueAt: days(-1), status: InvoiceStatus.CANCELLED } });

  // ──────────────────────────────────────────────────────────────────────────
  // 13b. ASSET REGISTER
  // ──────────────────────────────────────────────────────────────────────────
  /*
   * The studio's kit, which nothing seeded.
   *
   * Assets is a screen in the navigation with three models behind it — the
   * register, the chain of custody and the maintenance log — and all three
   * came up empty, so the only thing anybody had ever seen there was an empty
   * state. A video-and-design agency's most argued-about asset is the camera
   * body that went out on Friday and has not come back, which is precisely
   * what the movement table exists to answer.
   *
   * Two invariants this has to respect, both enforced in the service layer
   * rather than by a constraint:
   *
   *   1. An asset has at most ONE movement with `returnedAt: null`.
   *   2. `status` and `currentHolderId` must agree with that open movement —
   *      ASSIGNED or BOOKED_OUT means somebody holds it, IN_STOCK means the
   *      holder is null.
   *
   * Purchases point at a CAPITAL Cost row rather than owning the spend, so the
   * register and the P&L cannot disagree about what was paid.
   */
  const capitalCost = (category: string, vendor: string, amount: number, at: Date) =>
    prisma.cost.create({
      data: {
        organizationId: org.id, type: CostType.CAPITAL, category, vendor, amount, incurredAt: at,
        enteredById: akmal.id, paidBy: CostPaidBy.COMPANY, treatment: CostTreatment.COMPANY_EXPENSE,
      },
    });

  const asset = async (data: {
    tag: string; name: string; category: AssetCategory; make?: string; model?: string;
    serialNumber?: string; price: number; boughtAt: Date; vendor: string; bookable?: boolean;
    status?: AssetStatus; condition?: AssetCondition; holderId?: string; warrantyMonths?: number;
    notes?: string;
  }) => {
    const cost = await capitalCost(`Equipment — ${data.name}`, data.vendor, data.price, data.boughtAt);
    return prisma.asset.create({
      data: {
        organizationId: org.id, tag: data.tag, name: data.name, category: data.category,
        make: data.make, model: data.model, serialNumber: data.serialNumber,
        status: data.status ?? AssetStatus.IN_STOCK,
        condition: data.condition ?? AssetCondition.GOOD,
        bookable: data.bookable ?? false,
        costId: cost.id, purchasePrice: data.price, purchasedAt: data.boughtAt, vendor: data.vendor,
        // Straight-line life per category, the same defaults ASSET_USEFUL_LIFE
        // carries — written out here so the seed needs no import from shared.
        usefulLifeMonths: ASSET_LIFE[data.category],
        warrantyUntil: data.warrantyMonths
          ? new Date(data.boughtAt.getFullYear(), data.boughtAt.getMonth() + data.warrantyMonths, data.boughtAt.getDate())
          : null,
        currentHolderId: data.holderId ?? null,
        notes: data.notes,
      },
    });
  };

  const a7iv = await asset({ tag: 'EL/CAM/001', name: 'Sony A7 IV', category: AssetCategory.CAMERA_BODY, make: 'Sony', model: 'ILCE-7M4', serialNumber: '3892011', price: 245000, boughtAt: days(-420), vendor: 'Foto Circle, Chennai', bookable: true, status: AssetStatus.BOOKED_OUT, holderId: charles.id, warrantyMonths: 24 });
  const fx30 = await asset({ tag: 'EL/CAM/002', name: 'Sony FX30', category: AssetCategory.CAMERA_BODY, make: 'Sony', model: 'ILME-FX30', serialNumber: '4410287', price: 178000, boughtAt: days(-260), vendor: 'Foto Circle, Chennai', bookable: true, warrantyMonths: 24 });
  const lens2470 = await asset({ tag: 'EL/LEN/001', name: 'Sony 24-70mm f/2.8 GM II', category: AssetCategory.LENS, make: 'Sony', serialNumber: '1820394', price: 186000, boughtAt: days(-400), vendor: 'Foto Circle, Chennai', bookable: true, status: AssetStatus.BOOKED_OUT, holderId: charles.id });
  const lens35 = await asset({ tag: 'EL/LEN/002', name: 'Sigma 35mm f/1.4 Art', category: AssetCategory.LENS, make: 'Sigma', price: 72000, boughtAt: days(-500), vendor: 'Foto Circle, Chennai', bookable: true, condition: AssetCondition.FAIR, notes: 'Focus ring stiff in the cold. Serviced once.' });
  const droneMavic = await asset({ tag: 'EL/GMB/001', name: 'DJI Mavic 3 Pro', category: AssetCategory.GIMBAL_DRONE, make: 'DJI', serialNumber: '9921884', price: 215000, boughtAt: days(-180), vendor: 'DJI India', bookable: true, status: AssetStatus.IN_REPAIR, notes: 'Gimbal motor replacement after a hard landing at the VOSO shoot.' });
  const ronin = await asset({ tag: 'EL/GMB/002', name: 'DJI RS 3 Pro Gimbal', category: AssetCategory.GIMBAL_DRONE, make: 'DJI', price: 82000, boughtAt: days(-300), vendor: 'DJI India', bookable: true });
  const aputure = await asset({ tag: 'EL/LGT/001', name: 'Aputure 300d II', category: AssetCategory.LIGHTING, make: 'Aputure', price: 68000, boughtAt: days(-350), vendor: 'Pixel Pro Gear', bookable: true });
  const rodeMic = await asset({ tag: 'EL/AUD/001', name: 'Rode Wireless GO II', category: AssetCategory.AUDIO, make: 'Rode', price: 27000, boughtAt: days(-200), vendor: 'Pixel Pro Gear', bookable: true });
  const tripod = await asset({ tag: 'EL/SUP/001', name: 'Manfrotto 504X Tripod', category: AssetCategory.SUPPORT, make: 'Manfrotto', price: 46000, boughtAt: days(-380), vendor: 'Pixel Pro Gear', bookable: true });
  const mbpCharles = await asset({ tag: 'EL/LAP/001', name: 'MacBook Pro 16" M3 Max', category: AssetCategory.LAPTOP, make: 'Apple', serialNumber: 'C02XK1YZQ6NY', price: 329000, boughtAt: days(-310), vendor: 'Imagine Store', status: AssetStatus.ASSIGNED, holderId: charles.id, warrantyMonths: 12 });
  const mbpSneha = await asset({ tag: 'EL/LAP/002', name: 'MacBook Pro 14" M3', category: AssetCategory.LAPTOP, make: 'Apple', serialNumber: 'C02YL2ZAR7PQ', price: 214000, boughtAt: days(-240), vendor: 'Imagine Store', status: AssetStatus.ASSIGNED, holderId: sneha.id, warrantyMonths: 12 });
  const mbpNaif = await asset({ tag: 'EL/LAP/003', name: 'MacBook Air 15" M2', category: AssetCategory.LAPTOP, make: 'Apple', price: 134000, boughtAt: days(-150), vendor: 'Imagine Store', status: AssetStatus.ASSIGNED, holderId: naif.id, warrantyMonths: 12 });
  const oldLaptop = await asset({ tag: 'EL/LAP/004', name: 'Dell XPS 15 (2019)', category: AssetCategory.LAPTOP, make: 'Dell', price: 118000, boughtAt: days(-1600), vendor: 'Dell Direct', status: AssetStatus.RETIRED, condition: AssetCondition.DAMAGED, notes: 'Battery swelled. Kept on the books at salvage until the CA writes it off.' });
  const monitor = await asset({ tag: 'EL/MON/001', name: 'LG 27" 4K UltraFine', category: AssetCategory.MONITOR, make: 'LG', price: 58000, boughtAt: days(-290), vendor: 'Imagine Store' });
  const ssd = await asset({ tag: 'EL/STO/001', name: 'Samsung T7 Shield 2TB', category: AssetCategory.STORAGE, make: 'Samsung', price: 19000, boughtAt: days(-120), vendor: 'Amazon Business', bookable: true, status: AssetStatus.BOOKED_OUT, holderId: ramya.id });

  /*
   * The chain of custody. Closed movements are history; the open ones (no
   * `returnedAt`) are what the "Out now" board reads, and each has to match the
   * asset's own status and holder set above.
   */
  const movement = (data: {
    assetId: string; kind: AssetMovementKind; userId: string; issuedById: string;
    outAt: Date; dueAt?: Date; returnedAt?: Date; receivedById?: string;
    projectId?: string; monthCardId?: string; purpose?: string;
    conditionOut?: AssetCondition; conditionIn?: AssetCondition; notes?: string;
  }) => prisma.assetMovement.create({
    data: {
      assetId: data.assetId, kind: data.kind, userId: data.userId, issuedById: data.issuedById,
      outAt: data.outAt, dueAt: data.dueAt ?? null, returnedAt: data.returnedAt ?? null,
      receivedById: data.receivedById ?? null, projectId: data.projectId ?? null,
      monthCardId: data.monthCardId ?? null, purpose: data.purpose,
      conditionOut: data.conditionOut ?? AssetCondition.GOOD,
      conditionIn: data.conditionIn ?? null, notes: data.notes,
    },
  });

  // Long-term custody — laptops, open-ended, no due date by definition.
  await movement({ assetId: mbpCharles.id, kind: AssetMovementKind.CUSTODY, userId: charles.id, issuedById: harish.id, outAt: days(-305) });
  await movement({ assetId: mbpSneha.id, kind: AssetMovementKind.CUSTODY, userId: sneha.id, issuedById: harish.id, outAt: days(-235) });
  await movement({ assetId: mbpNaif.id, kind: AssetMovementKind.CUSTODY, userId: naif.id, issuedById: harish.id, outAt: days(-145) });

  // Out on a shoot right now, against the job it went out for.
  await movement({ assetId: a7iv.id, kind: AssetMovementKind.BOOKING, userId: charles.id, issuedById: janani.id, outAt: days(-2), dueAt: days(1), projectId: elephantineDoc.id, purpose: '75 Years Documentary — interview day 2' });
  await movement({ assetId: lens2470.id, kind: AssetMovementKind.BOOKING, userId: charles.id, issuedById: janani.id, outAt: days(-2), dueAt: days(1), projectId: elephantineDoc.id, purpose: '75 Years Documentary — interview day 2' });
  // Overdue: due back yesterday and still out, which is the case the overdue
  // scan exists to find.
  await movement({ assetId: ssd.id, kind: AssetMovementKind.BOOKING, userId: ramya.id, issuedById: charles.id, outAt: days(-9), dueAt: days(-1), monthCardId: vosoSep.id, purpose: 'Matchday rushes offload' });

  // Returned history, so the log is not only what is out today.
  await movement({ assetId: fx30.id, kind: AssetMovementKind.BOOKING, userId: charles.id, issuedById: harish.id, outAt: days(-22), dueAt: days(-19), returnedAt: days(-19), receivedById: janani.id, projectId: vosoDroneFilms.id, purpose: 'Drone show principal photography', conditionIn: AssetCondition.GOOD });
  await movement({ assetId: droneMavic.id, kind: AssetMovementKind.BOOKING, userId: charles.id, issuedById: harish.id, outAt: days(-22), dueAt: days(-19), returnedAt: days(-18), receivedById: harish.id, projectId: vosoDroneFilms.id, purpose: 'Drone show aerials', conditionIn: AssetCondition.DAMAGED, notes: 'Came back with the gimbal arm bent — sent for repair the same day.' });
  await movement({ assetId: aputure.id, kind: AssetMovementKind.BOOKING, userId: sneha.id, issuedById: janani.id, outAt: days(-40), dueAt: days(-38), returnedAt: days(-38), receivedById: janani.id, projectId: daOneApartment.id, purpose: 'Model apartment shoot', conditionIn: AssetCondition.GOOD });

  // The maintenance log, including the one that is still away.
  await prisma.assetMaintenance.create({
    data: {
      assetId: droneMavic.id, kind: AssetMaintenanceKind.REPAIR, vendor: 'DJI Service Centre, Chennai',
      amount: 34000, sentAt: days(-17), returnedAt: null, createdById: harish.id,
      notes: 'Gimbal motor and arm replacement after the VOSO shoot. Quoted 3 weeks.',
    },
  });
  await prisma.assetMaintenance.create({
    data: {
      assetId: lens35.id, kind: AssetMaintenanceKind.SERVICE, vendor: 'Sigma Service, Bangalore',
      amount: 4500, sentAt: days(-210), returnedAt: days(-190), createdById: janani.id,
      notes: 'Focus ring cleaned and re-greased.',
    },
  });
  await prisma.assetMaintenance.create({
    data: {
      assetId: mbpCharles.id, kind: AssetMaintenanceKind.AMC, vendor: 'Imagine Store',
      amount: 12000, sentAt: days(-310), returnedAt: days(-310), createdById: harish.id,
      notes: 'AppleCare+ for three years, bought with the machine.',
    },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 14. ALERTS
  // ──────────────────────────────────────────────────────────────────────────
  await prisma.alert.createMany({
    data: [
      { organizationId: org.id, rule: 'RULE_PROPOSAL_FOLLOWUP', severity: AlertSeverity.MED, entityType: 'Proposal', entityId: (await prisma.proposal.findFirstOrThrow({ where: { companyId: zenith.id } })).id, message: 'Zenith FinTech proposal (v2) has been in negotiation for 6 days with no response.' },
      { organizationId: org.id, rule: 'RULE_PROJECT_OVER_ESTIMATE', severity: AlertSeverity.HIGH, entityType: 'Project', entityId: vosoDroneFilms.id, message: 'Drone Show Films is ₹25,000 over its ₹1,90,000 estimate.' },
      { organizationId: org.id, rule: 'RULE_PROJECT_BEHIND_SCHEDULE', severity: AlertSeverity.HIGH, entityType: 'Project', entityId: tnpaSeason2.id, message: 'Season 2 Website is 5 days past its end date and still live.' },
      { organizationId: org.id, rule: 'RULE_RETAINER_EXPIRING', severity: AlertSeverity.MED, entityType: 'Retainer', entityId: carltonRetainer.id, message: 'Carlton Wellness retainer renews in 18 days.' },
      { organizationId: org.id, rule: 'RULE_INVOICE_OVERDUE', severity: AlertSeverity.HIGH, entityType: 'Invoice', entityId: rightAugInvoice.id, message: `INV/${FY}/0139 (Right Hospitals) is 10 days overdue.` },
      { organizationId: org.id, rule: 'RULE_TASK_AGING', severity: AlertSeverity.LOW, entityType: 'Company', entityId: carlton.id, message: 'Two Carlton tasks are open longer than their usual turnaround.' },
      // Resolved history, so the notification bell and audit trail have some closed alerts too.
      { organizationId: org.id, rule: 'RULE_PROPOSAL_FOLLOWUP', severity: AlertSeverity.LOW, entityType: 'Proposal', entityId: carltonProposal.id, message: 'Carlton proposal had gone quiet before it was won.', resolvedAt: days(-33), acknowledgedById: tanuja.id },
      { organizationId: org.id, rule: 'RULE_INVOICE_OVERDUE', severity: AlertSeverity.MED, entityType: 'Invoice', entityId: heavensAugInvoice.id, message: "Heaven's ELIX invoice was overdue before payment came in.", resolvedAt: days(-25), acknowledgedById: akmal.id },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 15. ACTIVITY FEED
  // ──────────────────────────────────────────────────────────────────────────
  await prisma.activity.createMany({
    data: [
      { organizationId: org.id, entityType: 'Company', entityId: carlton.id, actorId: tanuja.id, verb: 'company_created', payload: { name: 'Carlton Wellness' } },
      { organizationId: org.id, entityType: 'Proposal', entityId: carltonProposal.id, actorId: tanuja.id, verb: 'proposal_won', payload: { version: 'v2', value: 220000 } },
      { organizationId: org.id, entityType: 'Retainer', entityId: carltonRetainer.id, actorId: harish.id, verb: 'retainer_started', payload: { monthlyValue: 220000, termMonths: 12 } },
      { organizationId: org.id, entityType: 'Company', entityId: voso.id, actorId: akmal.id, verb: 'company_created', payload: { name: 'VOSO Sports' } },
      { organizationId: org.id, entityType: 'Proposal', entityId: vosoProposal.id, actorId: akmal.id, verb: 'proposal_won', payload: { version: 'v1', value: 140000 } },
      { organizationId: org.id, entityType: 'Project', entityId: carltonWebsite.id, actorId: naif.id, verb: 'project_created', payload: { name: 'Website Build' } },
      { organizationId: org.id, entityType: 'Project', entityId: vosoDroneFilms.id, actorId: charles.id, verb: 'milestone_added', payload: { label: 'Final Cut Delivery' } },
      { organizationId: org.id, entityType: 'Project', entityId: tnpaSeason2.id, actorId: naif.id, verb: 'project_created', payload: { name: 'Season 2 Website' } },
      { organizationId: org.id, entityType: 'Cost', entityId: 'seed', actorId: priya.id, verb: 'cost_entered', payload: { category: 'Salaries', amount: 662000 } },
      { organizationId: org.id, entityType: 'Invoice', entityId: carltonAugInvoice.id, actorId: priya.id, verb: 'payment_recorded', payload: { amount: 220000, mode: 'NEFT' } },
      { organizationId: org.id, entityType: 'Invoice', entityId: vosoAugInvoice.id, actorId: priya.id, verb: 'payment_recorded', payload: { amount: 140000, mode: 'UPI' } },
      { organizationId: org.id, entityType: 'Company', entityId: indusAlliance.id, actorId: tanuja.id, verb: 'proposal_lost', payload: { reason: 'Budget pulled after Q1 review' } },
      { organizationId: org.id, entityType: 'Company', entityId: sastry.id, actorId: tanuja.id, verb: 'proposal_lost', payload: { reason: 'Took production in-house' } },
      { organizationId: org.id, entityType: 'OutreachEntry', entityId: 'seed', actorId: varsha.id, verb: 'outreach_imported', payload: { count: 6 } },
      { organizationId: org.id, entityType: 'Project', entityId: rightHospitalsMicrosite.id, actorId: harish.id, verb: 'project_cancelled', payload: { reason: 'Client paused web spend for the quarter' } },
    ],
  });

  // Counted, not asserted — the line used to claim 13 users and printed it
  // unchanged after two were removed from the roster above.
  const [
    userCount, companyCount, proposalCount, retainerCount, retainerProjectCount,
    projectCount, taskCount, assigneeCount, taggedCount, costCount, assetCount, lineItemCount,
  ] = await Promise.all([
    prisma.user.count(), prisma.company.count(), prisma.proposal.count(),
    prisma.retainer.count(), prisma.retainerProject.count(), prisma.project.count(),
    prisma.task.count(), prisma.taskAssignee.count(),
    prisma.task.count({ where: { retainerProjectId: { not: null } } }),
    prisma.cost.count(), prisma.asset.count(), prisma.documentLineItem.count(),
  ]);
  console.log(
    `Done — ${userCount} users, ${companyCount} companies, ${proposalCount} proposals, ` +
      `${retainerCount} retainers (${retainerProjectCount} projects inside them), ` +
      `${projectCount} one-off projects, ${taskCount} tasks (${assigneeCount} assignments, ` +
      `${taggedCount} under a retainer project), ${costCount} costs, ${assetCount} assets, ` +
      `${lineItemCount} document line items, plus invoices, alerts and activity.`,
  );
  console.log(`Calendar anchored on ${TODAY.toDateString()} — months ${LAST_MONTH} (closed) and ${THIS_MONTH} (open).`);
  console.log(`Log in as harish.s@eyelevelstudio.in`);
  if (!configuredAdmin) {
    // Printed once, here, because nothing else knows it. Set
    // SEED_ADMIN_PASSWORD (and optionally SEED_DEMO_PASSWORD) to choose it.
    console.log(`Generated password for every seeded account: ${adminPassword}`);
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
