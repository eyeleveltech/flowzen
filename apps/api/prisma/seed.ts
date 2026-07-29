import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding ELITE PM database...\n');

  // Clean existing data
  await prisma.notification.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.note.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectTeam.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.invoiceDraft.deleteMany();
  await prisma.dealField.deleteMany();
  await prisma.stageHistory.deleteMany();
  await prisma.leadContact.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.clientContact.deleteMany();
  await prisma.client.deleteMany();
  await prisma.teamManager.deleteMany();
  await prisma.user.updateMany({ data: { teamId: null } });
  await prisma.team.deleteMany();
  await prisma.projectTemplate.deleteMany();
  await prisma.organizationModule.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Organization
  const org = await prisma.organization.create({
    data: {
      name: 'Eyelevel Digital',
      website: 'https://eyelevel.digital',
    },
  });
  // Without these, every CRM / PM / Revenue route 403s behind requireModule().
  await prisma.organizationModule.createMany({
    data: ['CRM', 'PM', 'REVENUE'].map((key) => ({ organizationId: org.id, key })),
    skipDuplicates: true,
  });
  console.log('  ✅ Organization created (CRM, PM, REVENUE enabled)');

  // Departments (Teams)
  const salesTeam = await prisma.team.create({
    data: {
      name: 'Sales & Business Development',
      description: 'Handles lead generation, CRM deal pipeline, client proposals, and commercial negotiations.',
      organizationId: org.id,
    },
  });

  const engTeam = await prisma.team.create({
    data: {
      name: 'Engineering & Product Development',
      description: 'Builds scalable web platforms, mobile applications, e-commerce systems, and backend infrastructure.',
      organizationId: org.id,
    },
  });

  const designTeam = await prisma.team.create({
    data: {
      name: 'UI/UX & Brand Design',
      description: 'Creates brand identity systems, user interface designs, visual guidelines, and interactive prototypes.',
      organizationId: org.id,
    },
  });

  const consultingTeam = await prisma.team.create({
    data: {
      name: 'Consulting & Client Success',
      description: 'Manages client retainer engagements, strategic advisory, contract delivery, and account growth.',
      organizationId: org.id,
    },
  });
  console.log('  ✅ 4 departments (teams) created');

  // Users with Department assignments
  const password = await bcrypt.hash('Password@123', 12);

  const admin = await prisma.user.create({
    data: {
      name: 'Harish Kumar',
      email: 'harish@eyelevel.digital',
      password,
      status: 'ACTIVE', // login rejects PENDING accounts, so seeded users must be active
      role: 'SUPER_ADMIN',
      designation: 'Head of Sales & Growth',
      teamId: salesTeam.id,
      organizationId: org.id,
    },
  });

  const pm = await prisma.user.create({
    data: {
      name: 'Sarah Chen',
      email: 'sarah@eyelevel.digital',
      password,
      status: 'ACTIVE', // login rejects PENDING accounts, so seeded users must be active
      role: 'PROJECT_MANAGER',
      designation: 'Senior Technical Project Manager',
      teamId: engTeam.id,
      organizationId: org.id,
    },
  });

  const dev1 = await prisma.user.create({
    data: {
      name: 'Alex Rivera',
      email: 'alex@eyelevel.digital',
      password,
      status: 'ACTIVE', // login rejects PENDING accounts, so seeded users must be active
      role: 'TEAM_MEMBER',
      designation: 'Full Stack Engineer',
      teamId: engTeam.id,
      organizationId: org.id,
    },
  });

  const dev2 = await prisma.user.create({
    data: {
      name: 'Maya Patel',
      email: 'maya@eyelevel.digital',
      password,
      status: 'ACTIVE', // login rejects PENDING accounts, so seeded users must be active
      role: 'TEAM_MEMBER',
      designation: 'Lead UI/UX Designer',
      teamId: designTeam.id,
      organizationId: org.id,
    },
  });

  const admin2 = await prisma.user.create({
    data: {
      name: 'James Wilson',
      email: 'james@eyelevel.digital',
      password,
      status: 'ACTIVE', // login rejects PENDING accounts, so seeded users must be active
      role: 'ADMIN',
      designation: 'Client Success Director',
      teamId: consultingTeam.id,
      organizationId: org.id,
    },
  });

  // Department Managers
  await prisma.teamManager.createMany({
    data: [
      { teamId: salesTeam.id, userId: admin.id },
      { teamId: engTeam.id, userId: pm.id },
      { teamId: designTeam.id, userId: dev2.id },
      { teamId: consultingTeam.id, userId: admin2.id },
    ],
  });

  console.log('  ✅ 5 users created across 4 departments');

  // Clients
  const client1 = await prisma.client.create({
    data: {
      name: 'TechVenture Inc.',
      company: 'TechVenture Inc.',
      industry: 'Technology',
      contactPerson: 'David Kim',
      email: 'david@techventure.io',
      phone: '+1 (555) 123-4567',
      address: '123 Innovation Drive, San Francisco, CA',
      contractValue: 85000,
      status: 'ACTIVE',
      startDate: new Date('2025-01-15'),
      organizationId: org.id,
    },
  });

  const client2 = await prisma.client.create({
    data: {
      name: 'GreenLeaf Organics',
      company: 'GreenLeaf Organics Ltd.',
      industry: 'Food & Beverage',
      contactPerson: 'Emma Thompson',
      email: 'emma@greenleaf.co',
      phone: '+1 (555) 987-6543',
      address: '456 Nature Way, Portland, OR',
      contractValue: 42000,
      status: 'ACTIVE',
      startDate: new Date('2025-03-01'),
      organizationId: org.id,
    },
  });

  const client3 = await prisma.client.create({
    data: {
      name: 'FinanceFlow',
      company: 'FinanceFlow Solutions',
      industry: 'Financial Services',
      contactPerson: 'Robert Chen',
      email: 'robert@financeflow.com',
      phone: '+1 (555) 456-7890',
      address: '789 Wall Street, New York, NY',
      contractValue: 120000,
      status: 'PROSPECT',
      organizationId: org.id,
    },
  });

  const client4 = await prisma.client.create({
    data: {
      name: 'Nexus Media Corp',
      company: 'Nexus Media Corp',
      industry: 'Media & Entertainment',
      contactPerson: 'James Miller',
      email: 'james@nexusmedia.com',
      phone: '+91 98765 88888',
      address: 'Plot 45, Film City, Mumbai',
      contractValue: 1500000,
      status: 'ACTIVE',
      startDate: new Date('2026-06-01'),
      organizationId: org.id,
    },
  });

  const client5 = await prisma.client.create({
    data: {
      name: 'Zenith Advisory',
      company: 'Zenith Advisory Services',
      industry: 'Consulting',
      contactPerson: 'Rahul Kapoor',
      email: 'rahul@zenithadvisory.in',
      phone: '+91 98765 00000',
      address: 'Level 12, Cyber Towers, Gurugram',
      contractValue: 1000000,
      status: 'PROJECT_COMPLETED',
      startDate: new Date('2026-01-10'),
      organizationId: org.id,
    },
  });

  console.log('  ✅ 5 clients created');

  // ──────────────────────────────────────────────
  // CRM LEADS (11 Pipeline Stages)
  // ──────────────────────────────────────────────
  const lead1 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000001',
      companyName: 'Apex Logistics',
      contactName: 'Marcus Vance',
      contactEmail: 'marcus@apexlogistics.com',
      contactPhone: '+91 98765 11111',
      jobTitle: 'VP of Operations',
      industry: 'Logistics & Supply Chain',
      dealValue: 450000,
      stage: 'NEW_LEAD',
      priority: 'HIGH',
      source: 'OUTBOUND',
      assignedToId: pm.id,
      organizationId: org.id,
    },
  });

  const lead2 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000002',
      companyName: 'CloudScale Solutions',
      contactName: 'Elena Rostova',
      contactEmail: 'elena@cloudscale.io',
      contactPhone: '+91 98765 22222',
      jobTitle: 'Chief Technology Officer',
      industry: 'SaaS & Cloud Computing',
      dealValue: 800000,
      stage: 'OUTREACH',
      priority: 'HIGH',
      source: 'INBOUND',
      assignedToId: dev1.id,
      organizationId: org.id,
    },
  });

  const lead3 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000003',
      companyName: 'BioHealth Labs',
      contactName: 'Dr. Aris Thorne',
      contactEmail: 'aris@biohealthlabs.com',
      contactPhone: '+91 98765 33333',
      jobTitle: 'Head of Digital Strategy',
      industry: 'Healthcare & Biotech',
      dealValue: 1250000,
      stage: 'MEETING',
      priority: 'HIGH',
      source: 'INBOUND',
      assignedToId: admin.id,
      organizationId: org.id,
    },
  });

  const lead4 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000004',
      companyName: 'Aura Retail Group',
      contactName: 'Priya Sharma',
      contactEmail: 'priya@auraretail.in',
      contactPhone: '+91 98765 44444',
      jobTitle: 'Director of Marketing',
      industry: 'E-Commerce & Retail',
      dealValue: 1800000,
      stage: 'PROPOSAL',
      priority: 'HIGH',
      source: 'REFERRAL',
      assignedToId: pm.id,
      organizationId: org.id,
    },
  });

  const lead5 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000005',
      companyName: 'Quantum Analytics',
      contactName: 'Vikram Mehta',
      contactEmail: 'vikram@quantumanalytics.ai',
      contactPhone: '+91 98765 55555',
      jobTitle: 'Chief Executive Officer',
      industry: 'FinTech & AI',
      dealValue: 2500000,
      stage: 'NEGOTIATION',
      priority: 'HIGH',
      source: 'LINKEDIN',
      assignedToId: admin.id,
      organizationId: org.id,
    },
  });

  const lead6 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000006',
      companyName: 'TechVenture Inc.',
      contactName: 'David Kim',
      contactEmail: 'david@techventure.io',
      contactPhone: '+1 (555) 123-4567',
      jobTitle: 'VP of Product',
      industry: 'Technology',
      dealValue: 85000,
      stage: 'CONTRACT',
      priority: 'HIGH',
      source: 'REFERRAL',
      clientId: client1.id,
      assignedToId: pm.id,
      organizationId: org.id,
    },
  });

  const lead7 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000007',
      companyName: 'GreenLeaf Organics',
      contactName: 'Emma Thompson',
      contactEmail: 'emma@greenleaf.co',
      contactPhone: '+1 (555) 987-6543',
      jobTitle: 'Managing Director',
      industry: 'Food & Beverage',
      dealValue: 42000,
      stage: 'ACTIVE_RETAINER',
      priority: 'HIGH',
      source: 'INBOUND',
      contractType: 'RETAINER',
      clientId: client2.id,
      contractStartDate: new Date('2025-03-01'),
      nextRenewalDate: new Date('2026-08-31'),
      autoRenewal: true,
      renewalStatus: 'UPCOMING',
      assignedToId: pm.id,
      organizationId: org.id,
    },
  });

  const lead8 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000008',
      companyName: 'Nexus Media Corp',
      contactName: 'James Miller',
      contactEmail: 'james@nexusmedia.com',
      contactPhone: '+91 98765 88888',
      jobTitle: 'Chief Commercial Officer',
      industry: 'Media & Entertainment',
      dealValue: 1500000,
      stage: 'ACTIVE_PROJECT',
      priority: 'HIGH',
      source: 'INBOUND',
      contractType: 'ONE_TIME',
      clientId: client4.id,
      contractStartDate: new Date('2026-06-01'),
      contractEndDate: new Date('2026-11-30'),
      assignedToId: admin.id,
      organizationId: org.id,
    },
  });

  const lead9 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000009',
      companyName: 'Vanguard Robotics',
      contactName: 'Samantha Reed',
      contactEmail: 'samantha@vanguardrobotics.com',
      contactPhone: '+91 98765 99999',
      jobTitle: 'VP of Hardware Solutions',
      industry: 'Robotics & Hardware',
      dealValue: 3000000,
      stage: 'ON_HOLD',
      priority: 'MEDIUM',
      source: 'LINKEDIN',
      assignedToId: dev1.id,
      organizationId: org.id,
    },
  });

  const lead10 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000010',
      companyName: 'Zenith Advisory',
      contactName: 'Rahul Kapoor',
      contactEmail: 'rahul@zenithadvisory.in',
      contactPhone: '+91 98765 00000',
      jobTitle: 'Partner',
      industry: 'Consulting',
      dealValue: 1000000,
      stage: 'PROJECT_COMPLETED',
      priority: 'MEDIUM',
      source: 'REFERRAL',
      contractType: 'ONE_TIME',
      clientId: client5.id,
      contractStartDate: new Date('2026-01-10'),
      contractEndDate: new Date('2026-06-15'),
      assignedToId: pm.id,
      organizationId: org.id,
    },
  });

  const lead11 = await prisma.lead.create({
    data: {
      leadId: 'FL-202607-000011',
      companyName: 'Horizon Dynamics',
      contactName: 'Tom Vance',
      contactEmail: 'tom@horizondynamics.com',
      contactPhone: '+91 98765 77777',
      jobTitle: 'Head of Procurement',
      industry: 'Manufacturing',
      dealValue: 600000,
      stage: 'CHURNED',
      priority: 'LOW',
      source: 'OUTBOUND',
      lostReason: 'BUDGET',
      assignedToId: dev2.id,
      organizationId: org.id,
    },
  });

  console.log('  ✅ 11 CRM leads created across all stages');

  // CRM Deal Stage Fields
  await prisma.dealField.createMany({
    data: [
      { leadId: lead3.id, fieldKey: 'meetingDate', fieldValue: '2026-08-05' },
      { leadId: lead4.id, fieldKey: 'auditRequired', fieldValue: 'Yes' },
      { leadId: lead4.id, fieldKey: 'servicesInScope', fieldValue: 'SEO, Paid Ads, Social Media' },
      { leadId: lead5.id, fieldKey: 'proposalSentDate', fieldValue: '2026-07-20' },
      { leadId: lead6.id, fieldKey: 'agreedFinalValue', fieldValue: '85000' },
      { leadId: lead7.id, fieldKey: 'billingFrequency', fieldValue: 'Monthly' },
      { leadId: lead7.id, fieldKey: 'paymentTerms', fieldValue: 'Monthly' },
      { leadId: lead8.id, fieldKey: 'paymentTerms', fieldValue: '50-50' },
      { leadId: lead10.id, fieldKey: 'deliverablesSignOff', fieldValue: 'Final sign-off received from executive sponsor.' },
    ],
  });
  console.log('  ✅ Deal fields populated');

  // Stage Audit History
  await prisma.stageHistory.createMany({
    data: [
      { leadId: lead1.id, fromStage: 'NEW_LEAD', toStage: 'NEW_LEAD', notes: 'Lead added from outbound list', changedById: pm.id },
      { leadId: lead2.id, fromStage: 'NEW_LEAD', toStage: 'OUTREACH', notes: 'Intro email sent to Elena', changedById: dev1.id },
      { leadId: lead3.id, fromStage: 'OUTREACH', toStage: 'MEETING', notes: 'Discovery call booked for Aug 5', changedById: admin.id },
      { leadId: lead4.id, fromStage: 'MEETING', toStage: 'PROPOSAL', notes: 'Scope & digital audit proposal prepared', changedById: pm.id },
      { leadId: lead5.id, fromStage: 'PROPOSAL', toStage: 'NEGOTIATION', notes: 'Final commercial terms in discussion', changedById: admin.id },
      { leadId: lead6.id, fromStage: 'NEGOTIATION', toStage: 'CONTRACT', notes: 'Contract drafted and sent to David Kim', changedById: pm.id },
      { leadId: lead7.id, fromStage: 'CONTRACT', toStage: 'ACTIVE_RETAINER', notes: 'Retainer activated - monthly billing set up', changedById: pm.id },
      { leadId: lead8.id, fromStage: 'PROPOSAL', toStage: 'ACTIVE_PROJECT', notes: 'Fixed-price web project signed & activated', changedById: admin.id },
      { leadId: lead9.id, fromStage: 'MEETING', toStage: 'ON_HOLD', notes: 'Client paused budget evaluation until Q4', changedById: dev1.id },
      { leadId: lead10.id, fromStage: 'ACTIVE_PROJECT', toStage: 'PROJECT_COMPLETED', notes: 'Project deliverables delivered and accepted', changedById: pm.id },
      { leadId: lead11.id, fromStage: 'NEGOTIATION', toStage: 'CHURNED', notes: 'Lost to internal budget freeze', changedById: dev2.id },
    ],
  });
  console.log('  ✅ Stage history audit trail created');

  // ──────────────────────────────────────────────
  // REVENUE (Subscriptions & Contracts for Won Deals)
  // ──────────────────────────────────────────────
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      clientId: client2.id,
      sourceLeadId: lead7.id,
      amount: 42000,
      billingFrequency: 'MONTHLY',
      startDate: new Date('2025-03-01'),
      nextBillingDate: new Date('2026-08-01'),
      status: 'ACTIVE',
      notes: 'Auto-created from CRM (Active retainer)',
    },
  });

  await prisma.contract.create({
    data: {
      organizationId: org.id,
      clientId: client4.id,
      sourceLeadId: lead8.id,
      title: 'Nexus Media Corp — Project',
      value: 1500000,
      billingFrequency: 'ONE_TIME',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-11-30'),
      status: 'ACTIVE',
      notes: 'Auto-created from CRM (Active project)',
    },
  });
  console.log('  ✅ Revenue subscriptions & contracts created');

  // Projects
  const project1 = await prisma.project.create({
    data: {
      name: 'TechVenture Website Redesign',
      description: 'Complete redesign of the corporate website with modern UI/UX, responsive design, and CMS integration.',
      clientId: client1.id,
      ownerId: pm.id,
      startDate: new Date('2025-02-01'),
      endDate: new Date('2025-06-30'),
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      budget: 45000,
      progress: 65,
      members: {
        create: [
          { userId: pm.id },
          { userId: dev1.id },
          { userId: dev2.id },
        ],
      },
    },
  });

  const project2 = await prisma.project.create({
    data: {
      name: 'TechVenture Mobile App',
      description: 'Native mobile application for iOS and Android platforms with real-time data sync.',
      clientId: client1.id,
      ownerId: admin.id,
      startDate: new Date('2025-04-01'),
      endDate: new Date('2025-09-30'),
      priority: 'CRITICAL',
      status: 'PLANNING',
      budget: 40000,
      progress: 10,
      members: {
        create: [
          { userId: admin.id },
          { userId: dev1.id },
        ],
      },
    },
  });

  const project3 = await prisma.project.create({
    data: {
      name: 'GreenLeaf E-Commerce Platform',
      description: 'Full-featured e-commerce platform with inventory management, payment processing, and analytics.',
      clientId: client2.id,
      ownerId: pm.id,
      startDate: new Date('2025-03-15'),
      endDate: new Date('2025-07-15'),
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      budget: 35000,
      progress: 40,
      members: {
        create: [
          { userId: pm.id },
          { userId: dev1.id },
          { userId: dev2.id },
          { userId: admin2.id },
        ],
      },
    },
  });

  const project4 = await prisma.project.create({
    data: {
      name: 'GreenLeaf Brand Identity',
      description: 'Complete brand refresh including logo, color palette, typography, and brand guidelines.',
      clientId: client2.id,
      ownerId: dev2.id,
      startDate: new Date('2025-03-01'),
      endDate: new Date('2025-04-30'),
      priority: 'MEDIUM',
      status: 'COMPLETED',
      budget: 7000,
      progress: 100,
      members: {
        create: [
          { userId: dev2.id },
        ],
      },
    },
  });

  const project5 = await prisma.project.create({
    data: {
      name: 'FinanceFlow Dashboard MVP',
      description: 'Financial analytics dashboard MVP with real-time data visualization and reporting.',
      clientId: client3.id,
      ownerId: admin.id,
      startDate: new Date('2025-05-01'),
      endDate: new Date('2025-05-20'),
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      budget: 15000,
      progress: 20,
      members: {
        create: [
          { userId: admin.id },
          { userId: dev1.id },
        ],
      },
    },
  });

  console.log('  ✅ 5 projects created');

  // Associate Projects with Departments (ProjectTeam)
  await prisma.projectTeam.createMany({
    data: [
      { projectId: project1.id, teamId: engTeam.id },
      { projectId: project1.id, teamId: designTeam.id },
      { projectId: project2.id, teamId: engTeam.id },
      { projectId: project3.id, teamId: engTeam.id },
      { projectId: project3.id, teamId: designTeam.id },
      { projectId: project4.id, teamId: designTeam.id },
      { projectId: project5.id, teamId: engTeam.id },
      { projectId: project5.id, teamId: consultingTeam.id },
    ],
  });
  console.log('  ✅ Project-Department relationships created');

  // Tasks for Project 1 (Website Redesign)
  const t1 = await prisma.task.create({
    data: { title: 'Wireframe Homepage', projectId: project1.id, assigneeId: dev2.id, priority: 'HIGH', status: 'COMPLETED', dueDate: new Date('2025-03-01'), order: 0 },
  });
  const t2 = await prisma.task.create({
    data: { title: 'Design System Setup', projectId: project1.id, assigneeId: dev2.id, priority: 'HIGH', status: 'COMPLETED', dueDate: new Date('2025-03-10'), order: 1 },
  });
  const t3 = await prisma.task.create({
    data: { title: 'Implement Navigation Component', projectId: project1.id, assigneeId: dev1.id, priority: 'MEDIUM', status: 'COMPLETED', dueDate: new Date('2025-03-20'), order: 2 },
  });
  await prisma.task.create({
    data: { title: 'Build Hero Section', projectId: project1.id, assigneeId: dev1.id, priority: 'MEDIUM', status: 'IN_PROGRESS', dueDate: new Date('2025-06-10'), order: 3 },
  });
  await prisma.task.create({
    data: { title: 'Integrate CMS', projectId: project1.id, assigneeId: dev1.id, priority: 'HIGH', status: 'TODO', dueDate: new Date('2025-06-15'), order: 4 },
  });
  await prisma.task.create({
    data: { title: 'SEO Optimization', projectId: project1.id, assigneeId: pm.id, priority: 'MEDIUM', status: 'BACKLOG', dueDate: new Date('2025-06-25'), order: 5 },
  });
  await prisma.task.create({
    data: { title: 'Performance Testing', projectId: project1.id, assigneeId: dev1.id, priority: 'HIGH', status: 'BACKLOG', dueDate: new Date('2025-06-28'), order: 6 },
  });

  // Subtasks for wireframe
  await prisma.task.createMany({
    data: [
      { title: 'Desktop Layout', projectId: project1.id, parentId: t1.id, assigneeId: dev2.id, status: 'COMPLETED', order: 0 },
      { title: 'Mobile Layout', projectId: project1.id, parentId: t1.id, assigneeId: dev2.id, status: 'COMPLETED', order: 1 },
      { title: 'Tablet Layout', projectId: project1.id, parentId: t1.id, assigneeId: dev2.id, status: 'COMPLETED', order: 2 },
    ],
  });

  // Tasks for Project 3 (E-Commerce)
  await prisma.task.createMany({
    data: [
      { title: 'Product Catalog Design', projectId: project3.id, assigneeId: dev2.id, priority: 'HIGH', status: 'COMPLETED', dueDate: new Date('2025-04-15'), order: 0 },
      { title: 'Shopping Cart Implementation', projectId: project3.id, assigneeId: dev1.id, priority: 'HIGH', status: 'IN_PROGRESS', dueDate: new Date('2025-06-01'), order: 1 },
      { title: 'Payment Gateway Integration', projectId: project3.id, assigneeId: dev1.id, priority: 'URGENT', status: 'TODO', dueDate: new Date('2025-06-15'), order: 2 },
      { title: 'Order Management System', projectId: project3.id, assigneeId: admin2.id, priority: 'HIGH', status: 'BACKLOG', dueDate: new Date('2025-06-30'), order: 3 },
      { title: 'Inventory Dashboard', projectId: project3.id, assigneeId: dev1.id, priority: 'MEDIUM', status: 'BACKLOG', dueDate: new Date('2025-07-05'), order: 4 },
      { title: 'User Authentication', projectId: project3.id, assigneeId: dev1.id, priority: 'HIGH', status: 'REVIEW', dueDate: new Date('2025-05-20'), order: 5 },
    ],
  });

  // Tasks for Project 5 (FinanceFlow)
  await prisma.task.createMany({
    data: [
      { title: 'Dashboard UI Mockups', projectId: project5.id, assigneeId: dev2.id, priority: 'HIGH', status: 'IN_PROGRESS', dueDate: new Date('2025-05-15'), order: 0 },
      { title: 'Chart Component Library', projectId: project5.id, assigneeId: dev1.id, priority: 'HIGH', status: 'TODO', dueDate: new Date('2025-05-20'), order: 1 },
      { title: 'API Data Integration', projectId: project5.id, assigneeId: dev1.id, priority: 'MEDIUM', status: 'BACKLOG', dueDate: new Date('2025-06-01'), order: 2 },
      { title: 'Export Reports Feature', projectId: project5.id, assigneeId: admin.id, priority: 'LOW', status: 'BACKLOG', order: 3 },
    ],
  });

  console.log('  ✅ 23 tasks created');

  // Comments
  await prisma.comment.createMany({
    data: [
      { content: 'The wireframes look great! Can we add a dark mode toggle?', taskId: t1.id, authorId: admin.id },
      { content: 'Good idea. I\'ll add it to the design system.', taskId: t1.id, authorId: dev2.id },
      { content: 'Design system is ready for review. All components documented.', taskId: t2.id, authorId: dev2.id },
      { content: 'Approved! Clean work. Let\'s proceed with implementation.', taskId: t2.id, authorId: pm.id },
      { content: 'Navigation looks great on mobile too. Nice responsive handling.', taskId: t3.id, authorId: pm.id },
    ],
  });
  console.log('  ✅ 5 comments created');

  // Checklist for task t2
  await prisma.checklistItem.createMany({
    data: [
      { text: 'Color palette defined', completed: true, order: 0, taskId: t2.id },
      { text: 'Typography scale set', completed: true, order: 1, taskId: t2.id },
      { text: 'Component library started', completed: true, order: 2, taskId: t2.id },
      { text: 'Dark mode variables', completed: false, order: 3, taskId: t2.id },
      { text: 'Documentation complete', completed: true, order: 4, taskId: t2.id },
    ],
  });
  console.log('  ✅ 5 checklist items created');

  // Notes
  await prisma.note.createMany({
    data: [
      { content: 'Client prefers minimalist design approach. Reference: Apple.com and Linear.app for inspiration.', type: 'MEETING', clientId: client1.id, authorId: pm.id },
      { content: 'Contract renewal discussion scheduled for Q3. Need to prepare proposal.', type: 'INTERNAL', clientId: client1.id, authorId: admin.id },
      { content: 'Organic product photography scheduled for next week. Need to coordinate with warehouse.', type: 'MEETING', clientId: client2.id, authorId: dev2.id },
    ],
  });
  console.log('  ✅ 3 notes created');

  // Activities
  const activityData = [
    { type: 'TASK_COMPLETED', message: 'completed "Wireframe Homepage"', entityType: 'TASK' as const, entityId: t1.id, userId: dev2.id, taskId: t1.id, projectId: project1.id },
    { type: 'TASK_COMPLETED', message: 'completed "Design System Setup"', entityType: 'TASK' as const, entityId: t2.id, userId: dev2.id, taskId: t2.id, projectId: project1.id },
    { type: 'PROJECT_CREATED', message: 'created project "FinanceFlow Dashboard MVP"', entityType: 'PROJECT' as const, entityId: project5.id, userId: admin.id, projectId: project5.id },
    { type: 'CLIENT_ADDED', message: 'added client "FinanceFlow"', entityType: 'CLIENT' as const, entityId: client3.id, userId: admin.id, clientId: client3.id },
    { type: 'TASK_COMPLETED', message: 'completed "Navigation Component"', entityType: 'TASK' as const, entityId: t3.id, userId: dev1.id, taskId: t3.id, projectId: project1.id },
    { type: 'PROJECT_STATUS_CHANGED', message: 'marked "GreenLeaf Brand Identity" as Completed', entityType: 'PROJECT' as const, entityId: project4.id, userId: dev2.id, projectId: project4.id },
  ];

  await prisma.activity.createMany({ data: activityData });
  console.log('  ✅ 6 activities created');

  // Notifications
  await prisma.notification.createMany({
    data: [
      { type: 'TASK_ASSIGNED', message: 'You were assigned to "Build Hero Section"', userId: dev1.id },
      { type: 'DEADLINE_APPROACHING', message: '"Shopping Cart Implementation" is due in 3 days', userId: dev1.id },
      { type: 'COMMENT_ADDED', message: 'Harish commented on "Wireframe Homepage"', userId: dev2.id },
      { type: 'PROJECT_STATUS_CHANGED', message: '"GreenLeaf Brand Identity" was marked as Completed', userId: pm.id },
      { type: 'TASK_COMPLETED', message: 'Alex completed "Navigation Component"', userId: pm.id, read: true },
    ],
  });
  console.log('  ✅ 5 notifications created');

  // Project Template
  await prisma.projectTemplate.create({
    data: {
      name: 'Website Development',
      organizationId: org.id, // templates are scoped per org (20260717000000_scope_project_templates_per_org)
      description: 'Standard website development workflow with discovery, design, development, and launch phases.',
      structure: {
        tasks: [
          {
            title: 'Discovery & Research',
            subtasks: [
              { title: 'Stakeholder Interviews' },
              { title: 'Competitor Analysis' },
              { title: 'Requirements Document' },
            ],
          },
          {
            title: 'UI/UX Design',
            subtasks: [
              { title: 'Wireframes' },
              { title: 'UI Design' },
              { title: 'Design Approval' },
            ],
          },
          {
            title: 'Development',
            subtasks: [
              { title: 'Frontend Development' },
              { title: 'Backend Development' },
              { title: 'Testing & QA' },
            ],
          },
          {
            title: 'Launch',
            subtasks: [
              { title: 'Staging Deployment' },
              { title: 'Client Review' },
              { title: 'Production Launch' },
            ],
          },
        ],
      },
    },
  });
  console.log('  ✅ 1 project template created');

  console.log('\n🎉 Seed complete!\n');
  console.log('  Login credentials:');
  console.log('  ─────────────────────────────────');
  console.log('  Email:    harish@eyelevel.digital');
  console.log('  Password: Password@123');
  console.log('  ─────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
