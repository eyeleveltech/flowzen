import {
  PrismaClient, RolePreset, CompanyVertical, CompanySource, CompanyStatus, PersonRole,
  OutreachStatus, ProposalKind, ProposalStage, ProposalOutcome, ProformaSourceType, ProformaStatus,
  RetainerStatus, MonthCardStatus, ProjectStatus, Priority, MilestoneStatus, TaskWorkType,
  TaskStatus, WaitingOn, CostType, CostPaidBy, CostTreatment, InvoiceStatus, AlertSeverity,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Fixed "today" for the seeded calendar — keeps overdue/today/this-week/renewal-soon
// buckets meaningful regardless of when this script actually runs.
const TODAY = new Date('2026-09-02T00:00:00.000Z');
const days = (n: number) => new Date(TODAY.getTime() + n * 86400000);

async function main() {
  console.log('Wiping and reseeding Flowzen with a full EyeLevel dataset...');

  // Delete children before parents — FK order matters even with onDelete rules,
  // since some relations (Cost.project, Invoice.project, Proforma.milestone)
  // use SetNull rather than Cascade.
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.activity.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.peopleAllocation.deleteMany(),
    prisma.cost.deleteMany(),
    prisma.task.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.proforma.deleteMany(),
    prisma.project.deleteMany(),
    prisma.monthCard.deleteMany(),
    prisma.retainer.deleteMany(),
    prisma.taskTemplate.deleteMany(),
    prisma.proposalVersion.deleteMany(),
    prisma.proposal.deleteMany(),
    prisma.outreachEntry.deleteMany(),
    prisma.person.deleteMany(),
    prisma.company.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ]);

  const harishHash = await bcrypt.hash('Harish143@', 10);
  const demoHash = await bcrypt.hash('ChangeMe123!', 10);

  const ALL_PERMS = [
    'work.own', 'work.team', 'work.all', 'company.read', 'company.write',
    'pipeline.read', 'pipeline.write', 'money.status', 'money.figures',
    'cost.enter', 'reports.read', 'setup.admin',
  ];
  const HEAD_PERMS = ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter'];
  const BD_PERMS = ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'money.status'];
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

  // ──────────────────────────────────────────────────────────────────────────
  // 3. TASK TEMPLATES
  // ──────────────────────────────────────────────────────────────────────────
  const blueprint = await prisma.taskTemplate.create({
    data: {
      organizationId: org.id,
      name: 'Full Studio Monthly Retainer Blueprint',
      items: [
        { title: 'Monthly Social Media Calendar & Concept', dept: 'Digital Marketing', dayOfMonth: 2, count: 1 },
        { title: 'Ad Creative Batch 1 (4 Statics + 2 Reels)', dept: 'Design', dayOfMonth: 5, count: 6 },
        { title: 'Performance Ad Campaign Optimization', dept: 'Digital Marketing', dayOfMonth: 10, count: 1 },
        { title: 'Mid-Month Video Production Shoot', dept: 'Video & Production', dayOfMonth: 15, count: 1 },
        { title: 'Ad Creative Batch 2 (Video Iterations)', dept: 'Video & Production', dayOfMonth: 20, count: 3 },
        { title: 'Monthly Growth & ROAS Performance Report', dept: 'Digital Marketing', dayOfMonth: 28, count: 1 },
      ],
    },
  });

  const lightTemplate = await prisma.taskTemplate.create({
    data: {
      organizationId: org.id,
      name: 'Lite Social-Only Retainer Blueprint',
      items: [
        { title: 'Monthly Social Media Calendar & Concept', dept: 'Digital Marketing', dayOfMonth: 2, count: 1 },
        { title: 'Ad Creative Batch 1 (4 Statics + 2 Reels)', dept: 'Design', dayOfMonth: 5, count: 4 },
        { title: 'Monthly Growth & ROAS Performance Report', dept: 'Digital Marketing', dayOfMonth: 28, count: 1 },
      ],
    },
  });

  // Retired blueprint, kept only to exercise Setup → Trash restore.
  const retiredTemplate = await prisma.taskTemplate.create({
    data: {
      organizationId: org.id,
      name: 'Old 2025 Retainer Blueprint (retired)',
      items: [{ title: 'Legacy Weekly Post', dept: 'Digital Marketing', dayOfMonth: 7, count: 1 }],
      deletedAt: days(-40),
    },
  });

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
  await prisma.outreachEntry.createMany({
    data: [
      { organizationId: org.id, name: 'Prestige Group', vertical: CompanyVertical.REAL_ESTATE, source: CompanySource.OUTREACH, ownerId: varsha.id, status: OutreachStatus.NOT_CONTACTED },
      { organizationId: org.id, name: 'Casagrand', vertical: CompanyVertical.REAL_ESTATE, source: CompanySource.OUTREACH, ownerId: varsha.id, status: OutreachStatus.CONTACTED },
      { organizationId: org.id, name: 'Kauvery Hospital', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.OUTREACH, ownerId: tanuja.id, status: OutreachStatus.CONTACTED },
      { organizationId: org.id, name: 'Zoho Partner Network', vertical: CompanyVertical.IT_AND_SAAS, source: CompanySource.OUTREACH, ownerId: tanuja.id, status: OutreachStatus.NOT_CONTACTED },
      { organizationId: org.id, name: 'Chennai Silks', vertical: CompanyVertical.RETAIL, source: CompanySource.OUTREACH, ownerId: varsha.id, status: OutreachStatus.REPLIED },
      { organizationId: org.id, name: 'HealthFirst Diagnostic Labs', vertical: CompanyVertical.HEALTHCARE, source: CompanySource.OUTREACH, ownerId: tanuja.id, status: OutreachStatus.DEAD },
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

  const { proposal: carltonProposal, versions: carltonVersions } = await proposal({
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

  const { proposal: rightHospitalsProposal } = await proposal({
    companyId: rightHospitals.id, kind: ProposalKind.RETAINER, ownerId: dilshad.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-70), wonVersionN: 1,
    versions: [{ n: 1, value: 30000, scope: 'Monthly OPD awareness content', sentAt: days(-75) }],
  });

  const { proposal: heavensProposal } = await proposal({
    companyId: heavensElix.id, kind: ProposalKind.RETAINER, ownerId: akmal.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-150), wonVersionN: 1,
    versions: [{ n: 1, value: 35000, scope: 'Festive-season D2C content calendar', sentAt: days(-155) }],
  });

  const { proposal: tnpaProposal } = await proposal({
    companyId: tnpa.id, kind: ProposalKind.RETAINER, ownerId: akmal.id, stage: ProposalStage.WON,
    outcome: ProposalOutcome.WON, wonAt: days(-240), wonVersionN: 1,
    versions: [{ n: 1, value: 30000, scope: 'Team announcements + tournament coverage', sentAt: days(-245) }],
  });

  const { proposal: daOneProposal } = await proposal({
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
  const { proposal: pavilionProposal } = await proposal({
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
      organizationId: org.id, number: 'EL/PI/26-27/012', companyId: carlton.id,
      sourceType: ProformaSourceType.PROPOSAL, sourceId: carltonProposal.id, amount: 220000,
      raisedAt: days(-32), validTill: days(-21), billingName: 'Carlton Wellness Pvt Ltd',
      gstin: '33AABCC1234F1Z5', status: ProformaStatus.PAID,
      terms: 'Advance retainer payment for commencement of services. 100% advance on invoice generation.',
    },
  });

  await prisma.proforma.create({
    data: {
      organizationId: org.id, number: 'EL/PI/26-27/013', companyId: voso.id,
      sourceType: ProformaSourceType.PROPOSAL, sourceId: vosoProposal.id, amount: 140000,
      raisedAt: days(-19), validTill: days(-4), billingName: 'VOSO Sports Pvt Ltd',
      terms: 'October retainer advance, 100% upfront.',
    },
  });

  await prisma.proforma.create({
    data: {
      organizationId: org.id, number: 'EL/PI/26-27/014', companyId: elephantine.id,
      sourceType: ProformaSourceType.PROPOSAL, sourceId: elephantineProjectProposal.id, amount: 130000,
      raisedAt: days(-14), validTill: days(1), billingName: 'Elephantine Tales LLP',
      terms: 'Advance for brand, site and launch film — 50% upfront.',
    },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. RETAINERS & MONTH CARDS
  // ──────────────────────────────────────────────────────────────────────────
  const retainer = async (data: {
    companyId: string; monthlyValue: number; startDate: Date; termMonths: number | null;
    renewalDate: Date | null; ownerId: string; templateId: string;
  }) => prisma.retainer.create({
    data: {
      organizationId: org.id, companyId: data.companyId, monthlyValue: data.monthlyValue,
      startDate: data.startDate, termMonths: data.termMonths, renewalDate: data.renewalDate,
      ownerId: data.ownerId, status: RetainerStatus.ACTIVE, templateId: data.templateId,
    },
  });

  // Renewal within 45 days — should trip "Renewal approaching".
  const carltonRetainer = await retainer({ companyId: carlton.id, monthlyValue: 220000, startDate: days(-32), termMonths: 12, renewalDate: days(18), ownerId: tanuja.id, templateId: blueprint.id });
  // Month-to-month, no fixed term — should trip "No fixed term".
  const vosoRetainer = await retainer({ companyId: voso.id, monthlyValue: 140000, startDate: days(-20), termMonths: null, renewalDate: null, ownerId: akmal.id, templateId: lightTemplate.id });
  const rightHospitalsRetainer = await retainer({ companyId: rightHospitals.id, monthlyValue: 30000, startDate: days(-70), termMonths: null, renewalDate: null, ownerId: dilshad.id, templateId: lightTemplate.id });
  // Healthy renewal window, well clear of the 45-day alert.
  const heavensRetainer = await retainer({ companyId: heavensElix.id, monthlyValue: 35000, startDate: days(-150), termMonths: 6, renewalDate: days(60), ownerId: akmal.id, templateId: lightTemplate.id });
  const tnpaRetainer = await retainer({ companyId: tnpa.id, monthlyValue: 30000, startDate: days(-240), termMonths: 6, renewalDate: days(107), ownerId: akmal.id, templateId: lightTemplate.id });
  const daOneRetainer = await retainer({ companyId: daOne.id, monthlyValue: 30000, startDate: days(-118), termMonths: null, renewalDate: null, ownerId: akmal.id, templateId: lightTemplate.id });

  const monthCard = async (retainerId: string, month: string, revenue: number, status: MonthCardStatus, closedAt?: Date) =>
    prisma.monthCard.create({ data: { retainerId, month, revenue, status, closedAt } });

  const carltonAug = await monthCard(carltonRetainer.id, '2026-08', 220000, MonthCardStatus.CLOSED, days(-2));
  const carltonSep = await monthCard(carltonRetainer.id, '2026-09', 220000, MonthCardStatus.OPEN);
  const vosoAug = await monthCard(vosoRetainer.id, '2026-08', 140000, MonthCardStatus.CLOSED, days(-3));
  const vosoSep = await monthCard(vosoRetainer.id, '2026-09', 140000, MonthCardStatus.OPEN);
  const rightAug = await monthCard(rightHospitalsRetainer.id, '2026-08', 30000, MonthCardStatus.CLOSED, days(-4));
  const rightSep = await monthCard(rightHospitalsRetainer.id, '2026-09', 30000, MonthCardStatus.OPEN);
  const heavensAug = await monthCard(heavensRetainer.id, '2026-08', 35000, MonthCardStatus.CLOSED, days(-5));
  const heavensSep = await monthCard(heavensRetainer.id, '2026-09', 35000, MonthCardStatus.OPEN);
  const tnpaAug = await monthCard(tnpaRetainer.id, '2026-08', 30000, MonthCardStatus.CLOSED, days(-3));
  const tnpaSep = await monthCard(tnpaRetainer.id, '2026-09', 30000, MonthCardStatus.OPEN);
  const daOneAug = await monthCard(daOneRetainer.id, '2026-08', 30000, MonthCardStatus.CLOSED, days(-6));
  const daOneSep = await monthCard(daOneRetainer.id, '2026-09', 30000, MonthCardStatus.OPEN);

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
    assigneeId: string; createdById: string; dueDate: Date; assignedAt: Date; completedAt?: Date;
    status: TaskStatus; priority?: Priority; waitingOn?: WaitingOn; waitingSince?: Date; waitingTotalMinutes?: number;
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
  const augRetainers = [
    { card: carltonAug, dept: 'both' }, { card: vosoAug, dept: 'both' }, { card: rightAug, dept: 'marketing' },
    { card: heavensAug, dept: 'marketing' }, { card: tnpaAug, dept: 'marketing' }, { card: daOneAug, dept: 'design' },
  ];
  let recurringOffset = 0;
  for (const { card, dept } of augRetainers) {
    for (const r of recurring) {
      if (dept !== 'both' && dept !== r.dept) continue;
      const people = r.dept === 'design' ? designPeople : marketingPeople;
      const assignee = people[recurringOffset % people.length];
      const assignedAt = days(-30 + (recurringOffset % 5));
      const elapsedHours = 6 + (recurringOffset % 6) * 5; // spreads medians across a real range
      taskRows.push({
        title: r.title, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id,
        assigneeId: assignee.id, createdById: dilshad.id, dueDate: days(-28 + (recurringOffset % 5)),
        assignedAt, completedAt: new Date(assignedAt.getTime() + elapsedHours * 3600000),
        status: TaskStatus.DONE,
      });
      recurringOffset++;
    }
  }

  // September (open) month-card work — the live board for each retainer,
  // spread across overdue / today / this-week / done / on-hold.
  const sepCards = [
    { card: carltonSep, lead: dilshad, people: [sneha, shyam] },
    { card: vosoSep, lead: janani, people: [ramya, sneha] },
    { card: rightSep, lead: dilshad, people: [shakila] },
    { card: heavensSep, lead: dilshad, people: [shyam] },
    { card: tnpaSep, lead: janani, people: [ramya] },
    { card: daOneSep, lead: charles, people: [janani] },
  ];
  const titlesByCard = [
    'October Instagram Growth Content Calendar', 'Ad Creatives Batch 1: Static Banners',
    'Ad Creatives Batch 2: Reel Cutdowns', 'Brand Video Script Sign-off from Client',
    'Meta Ads Optimization Pass', 'Monthly Growth & ROAS Report',
  ];
  sepCards.forEach(({ card, lead, people }, ci) => {
    // Overdue
    taskRows.push({ title: `${titlesByCard[0]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[0].id, createdById: lead.id, dueDate: days(-2), assignedAt: days(-6), status: TaskStatus.TODO });
    // Due today
    taskRows.push({ title: `${titlesByCard[1]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[people.length - 1].id, createdById: lead.id, dueDate: days(0), assignedAt: days(-1), status: TaskStatus.IN_PROGRESS });
    // Due this week
    taskRows.push({ title: `${titlesByCard[2]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[0].id, createdById: lead.id, dueDate: days(4), assignedAt: days(0), status: TaskStatus.TODO });
    // Blocked on client
    taskRows.push({ title: `${titlesByCard[3]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: lead.id, createdById: lead.id, dueDate: days(6), assignedAt: days(-2), status: TaskStatus.ON_HOLD, waitingOn: WaitingOn.CLIENT, waitingSince: days(-1), waitingTotalMinutes: 720 });
    // Done, feeds the recurring-title median for Perf Ad Optimization too
    const doneAssigned = days(-4);
    taskRows.push({ title: `${titlesByCard[4]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: people[0].id, createdById: lead.id, dueDate: days(-1), assignedAt: doneAssigned, completedAt: new Date(doneAssigned.getTime() + 9 * 3600000), status: TaskStatus.DONE });
    // Cancelled
    taskRows.push({ title: `${titlesByCard[5]} (${ci + 1})`, workType: TaskWorkType.MONTH_CARD, workId: card.id, monthCardId: card.id, assigneeId: lead.id, createdById: lead.id, dueDate: days(2), assignedAt: days(-3), status: TaskStatus.CANCELLED });
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
      projectId: t.projectId, assigneeId: t.assigneeId, createdById: t.createdById, dueDate: t.dueDate,
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
      { organizationId: org.id, type: CostType.COMPANY, category: 'Salaries', vendor: 'Payroll', amount: 662000, incurredAt: days(-1), enteredById: akmal.id, recurring: true },
      { organizationId: org.id, type: CostType.COMPANY, category: 'Office Rent', vendor: 'Nungambakkam Commercial Properties', amount: 65000, incurredAt: days(-1), enteredById: akmal.id, recurring: true },
      { organizationId: org.id, type: CostType.COMPANY, category: 'Software & Tools', vendor: 'Adobe / Figma / Vercel', amount: 18000, incurredAt: days(-1), enteredById: akmal.id, recurring: true },
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
      { userId: dilshad.id, month: '2026-08', workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id, proposedPercent: 45, percent: 45, confirmedById: harish.id, confirmedAt: days(-3) },
      { userId: sneha.id, month: '2026-08', workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id, proposedPercent: 30, percent: 30, confirmedById: harish.id, confirmedAt: days(-3) },
      { userId: shyam.id, month: '2026-08', workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, monthCardId: carltonAug.id, proposedPercent: 25, percent: 25, confirmedById: harish.id, confirmedAt: days(-3) },
      { userId: janani.id, month: '2026-08', workType: TaskWorkType.MONTH_CARD, workId: vosoAug.id, monthCardId: vosoAug.id, proposedPercent: 50, percent: 50, confirmedById: harish.id, confirmedAt: days(-4) },
      { userId: ramya.id, month: '2026-08', workType: TaskWorkType.MONTH_CARD, workId: vosoAug.id, monthCardId: vosoAug.id, proposedPercent: 50, percent: 50, confirmedById: harish.id, confirmedAt: days(-4) },
      { userId: charles.id, month: '2026-08', workType: TaskWorkType.PROJECT, workId: vosoDroneFilms.id, projectId: vosoDroneFilms.id, proposedPercent: 60, percent: 60, confirmedById: harish.id, confirmedAt: days(-5) },
    ],
  });
  // September — a mix of confirmed and still-proposed, to exercise the
  // Time Split confirm workflow.
  await prisma.peopleAllocation.createMany({
    data: [
      { userId: dilshad.id, month: '2026-09', workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, monthCardId: carltonSep.id, proposedPercent: 45, percent: 45, confirmedById: harish.id, confirmedAt: days(-1) },
      { userId: sneha.id, month: '2026-09', workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, monthCardId: carltonSep.id, proposedPercent: 30, percent: 30 },
      { userId: shyam.id, month: '2026-09', workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, monthCardId: carltonSep.id, proposedPercent: 25, percent: 25 },
      { userId: janani.id, month: '2026-09', workType: TaskWorkType.MONTH_CARD, workId: vosoSep.id, monthCardId: vosoSep.id, proposedPercent: 50, percent: 50, confirmedById: harish.id, confirmedAt: days(0) },
      { userId: ramya.id, month: '2026-09', workType: TaskWorkType.MONTH_CARD, workId: vosoSep.id, monthCardId: vosoSep.id, proposedPercent: 50, percent: 50 },
      { userId: charles.id, month: '2026-09', workType: TaskWorkType.PROJECT, workId: vosoDroneFilms.id, projectId: vosoDroneFilms.id, proposedPercent: 65, percent: 65, confirmedById: harish.id, confirmedAt: days(0) },
      { userId: naif.id, month: '2026-09', workType: TaskWorkType.PROJECT, workId: carltonWebsite.id, projectId: carltonWebsite.id, proposedPercent: 40, percent: 40 },
      { userId: naif.id, month: '2026-09', workType: TaskWorkType.PROJECT, workId: tnpaSeason2.id, projectId: tnpaSeason2.id, proposedPercent: 35, percent: 35 },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 13. INVOICES & PAYMENTS
  // ──────────────────────────────────────────────────────────────────────────
  const carltonAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0142', companyId: carlton.id, workType: TaskWorkType.MONTH_CARD, workId: carltonAug.id, amount: 220000, raisedAt: days(-32), dueAt: days(-18), status: InvoiceStatus.PAID, paidAt: days(-22) } });
  await prisma.monthCard.update({ where: { id: carltonAug.id }, data: { invoiceId: carltonAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: carltonAugInvoice.id, amount: 220000, receivedAt: days(-22), mode: 'NEFT', reference: 'HDFC00293849102' } });

  const carltonSepInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0188', companyId: carlton.id, workType: TaskWorkType.MONTH_CARD, workId: carltonSep.id, amount: 220000, raisedAt: days(-1), dueAt: days(13), status: InvoiceStatus.RAISED } });
  await prisma.monthCard.update({ where: { id: carltonSep.id }, data: { invoiceId: carltonSepInvoice.id } });

  const vosoAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0143', companyId: voso.id, workType: TaskWorkType.MONTH_CARD, workId: vosoAug.id, amount: 140000, raisedAt: days(-30), dueAt: days(-16), status: InvoiceStatus.PAID, paidAt: days(-19) } });
  await prisma.monthCard.update({ where: { id: vosoAug.id }, data: { invoiceId: vosoAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: vosoAugInvoice.id, amount: 140000, receivedAt: days(-19), mode: 'UPI', reference: 'UPI2609887654' } });

  // Overdue — past its due date, not yet paid.
  const rightAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0139', companyId: rightHospitals.id, workType: TaskWorkType.MONTH_CARD, workId: rightAug.id, amount: 30000, raisedAt: days(-35), dueAt: days(-10), status: InvoiceStatus.OVERDUE } });
  await prisma.monthCard.update({ where: { id: rightAug.id }, data: { invoiceId: rightAugInvoice.id } });

  const heavensAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0140', companyId: heavensElix.id, workType: TaskWorkType.MONTH_CARD, workId: heavensAug.id, amount: 35000, raisedAt: days(-34), dueAt: days(-20), status: InvoiceStatus.PAID, paidAt: days(-25) } });
  await prisma.monthCard.update({ where: { id: heavensAug.id }, data: { invoiceId: heavensAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: heavensAugInvoice.id, amount: 35000, receivedAt: days(-25), mode: 'NEFT', reference: 'HDFC00291122334' } });

  const tnpaAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0141', companyId: tnpa.id, workType: TaskWorkType.MONTH_CARD, workId: tnpaAug.id, amount: 30000, raisedAt: days(-33), dueAt: days(-19), status: InvoiceStatus.PAID, paidAt: days(-24) } });
  await prisma.monthCard.update({ where: { id: tnpaAug.id }, data: { invoiceId: tnpaAugInvoice.id } });
  await prisma.payment.create({ data: { invoiceId: tnpaAugInvoice.id, amount: 30000, receivedAt: days(-24), mode: 'NEFT', reference: 'HDFC00291122335' } });

  const daOneAugInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0144', companyId: daOne.id, workType: TaskWorkType.MONTH_CARD, workId: daOneAug.id, amount: 30000, raisedAt: days(-31), dueAt: days(-17), status: InvoiceStatus.RAISED } });
  await prisma.monthCard.update({ where: { id: daOneAug.id }, data: { invoiceId: daOneAugInvoice.id } });

  // Project-linked invoices (milestone billing), one cancelled for variety.
  const carltonWebsiteInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0135', companyId: carlton.id, workType: TaskWorkType.PROJECT, workId: carltonWebsite.id, projectId: carltonWebsite.id, amount: 60000, raisedAt: days(-38), dueAt: days(-24), status: InvoiceStatus.PAID, paidAt: days(-33) } });
  // A settled invoice needs the payment that settled it: balance due is
  // `amount - sum(payments)`, so PAID with no payment row reads as money
  // still owed on an invoice nobody owes anything on.
  await prisma.payment.create({ data: { invoiceId: carltonWebsiteInvoice.id, amount: 60000, receivedAt: days(-33), mode: 'NEFT', reference: 'HDFC00290011223' } });
  const daOneApartmentInvoice = await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0136', companyId: daOne.id, workType: TaskWorkType.PROJECT, workId: daOneApartment.id, projectId: daOneApartment.id, amount: 47500, raisedAt: days(-88), dueAt: days(-74), status: InvoiceStatus.PAID, paidAt: days(-80) } });
  await prisma.payment.create({ data: { invoiceId: daOneApartmentInvoice.id, amount: 47500, receivedAt: days(-80), mode: 'NEFT', reference: 'HDFC00288776655' } });
  await prisma.invoice.create({ data: { organizationId: org.id, number: 'INV/26-27/0137', companyId: rightHospitals.id, workType: TaskWorkType.PROJECT, workId: rightHospitalsMicrosite.id, projectId: rightHospitalsMicrosite.id, amount: 28000, raisedAt: days(-15), dueAt: days(-1), status: InvoiceStatus.CANCELLED } });

  // ──────────────────────────────────────────────────────────────────────────
  // 14. ALERTS
  // ──────────────────────────────────────────────────────────────────────────
  await prisma.alert.createMany({
    data: [
      { organizationId: org.id, rule: 'RULE_PROPOSAL_FOLLOWUP', severity: AlertSeverity.MED, entityType: 'Proposal', entityId: (await prisma.proposal.findFirstOrThrow({ where: { companyId: zenith.id } })).id, message: 'Zenith FinTech proposal (v2) has been in negotiation for 6 days with no response.' },
      { organizationId: org.id, rule: 'RULE_PROJECT_OVER_ESTIMATE', severity: AlertSeverity.HIGH, entityType: 'Project', entityId: vosoDroneFilms.id, message: 'Drone Show Films is ₹25,000 over its ₹1,90,000 estimate.' },
      { organizationId: org.id, rule: 'RULE_PROJECT_BEHIND_SCHEDULE', severity: AlertSeverity.HIGH, entityType: 'Project', entityId: tnpaSeason2.id, message: 'Season 2 Website is 5 days past its end date and still live.' },
      { organizationId: org.id, rule: 'RULE_RETAINER_EXPIRING', severity: AlertSeverity.MED, entityType: 'Retainer', entityId: carltonRetainer.id, message: 'Carlton Wellness retainer renews in 18 days.' },
      { organizationId: org.id, rule: 'RULE_INVOICE_OVERDUE', severity: AlertSeverity.HIGH, entityType: 'Invoice', entityId: rightAugInvoice.id, message: 'INV/26-27/0139 (Right Hospitals) is 10 days overdue.' },
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
      { organizationId: org.id, entityType: 'Cost', entityId: 'seed', actorId: akmal.id, verb: 'cost_entered', payload: { category: 'Salaries', amount: 662000 } },
      { organizationId: org.id, entityType: 'Invoice', entityId: carltonAugInvoice.id, actorId: akmal.id, verb: 'payment_recorded', payload: { amount: 220000, mode: 'NEFT' } },
      { organizationId: org.id, entityType: 'Invoice', entityId: vosoAugInvoice.id, actorId: akmal.id, verb: 'payment_recorded', payload: { amount: 140000, mode: 'UPI' } },
      { organizationId: org.id, entityType: 'Company', entityId: indusAlliance.id, actorId: tanuja.id, verb: 'proposal_lost', payload: { reason: 'Budget pulled after Q1 review' } },
      { organizationId: org.id, entityType: 'Company', entityId: sastry.id, actorId: tanuja.id, verb: 'proposal_lost', payload: { reason: 'Took production in-house' } },
      { organizationId: org.id, entityType: 'OutreachEntry', entityId: 'seed', actorId: varsha.id, verb: 'outreach_imported', payload: { count: 6 } },
      { organizationId: org.id, entityType: 'Project', entityId: rightHospitalsMicrosite.id, actorId: harish.id, verb: 'project_cancelled', payload: { reason: 'Client paused web spend for the quarter' } },
      { organizationId: org.id, entityType: 'TaskTemplate', entityId: retiredTemplate.id, actorId: harish.id, verb: 'template_deleted', payload: { name: retiredTemplate.name } },
    ],
  });

  // Counted, not asserted — the line used to claim 13 users and printed it
  // unchanged after two were removed from the roster above.
  const [userCount, taskCount, assigneeCount] = await Promise.all([
    prisma.user.count(),
    prisma.task.count(),
    prisma.taskAssignee.count(),
  ]);
  console.log(`Done — organization, ${userCount} users, 16 companies, 9 proposals, 6 retainers, 8 projects, ${taskCount} tasks (${assigneeCount} assignments), costs, invoices, alerts and activity all seeded.`);
  console.log(`Log in as harish.s@eyelevelstudio.in / Harish143@`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
