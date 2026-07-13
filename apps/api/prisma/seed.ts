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
  await prisma.milestone.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.projectTemplate.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Organization
  const org = await prisma.organization.create({
    data: {
      name: 'Eyelevel Digital',
      website: 'https://eyelevel.digital',
    },
  });
  console.log('  ✅ Organization created');

  // Users
  const password = await bcrypt.hash('Password@123', 12);

  const admin = await prisma.user.create({
    data: {
      name: 'Harish Kumar',
      email: 'harish@eyelevel.digital',
      password,
      role: 'SUPER_ADMIN',
      department: 'Management',
      organizationId: org.id,
    },
  });

  const pm = await prisma.user.create({
    data: {
      name: 'Sarah Chen',
      email: 'sarah@eyelevel.digital',
      password,
      role: 'PROJECT_MANAGER',
      department: 'Project Management',
      organizationId: org.id,
    },
  });

  const dev1 = await prisma.user.create({
    data: {
      name: 'Alex Rivera',
      email: 'alex@eyelevel.digital',
      password,
      role: 'TEAM_MEMBER',
      department: 'Engineering',
      organizationId: org.id,
    },
  });

  const dev2 = await prisma.user.create({
    data: {
      name: 'Maya Patel',
      email: 'maya@eyelevel.digital',
      password,
      role: 'TEAM_MEMBER',
      department: 'Design',
      organizationId: org.id,
    },
  });

  const admin2 = await prisma.user.create({
    data: {
      name: 'James Wilson',
      email: 'james@eyelevel.digital',
      password,
      role: 'ADMIN',
      department: 'Operations',
      organizationId: org.id,
    },
  });

  console.log('  ✅ 5 users created');

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

  console.log('  ✅ 3 clients created');

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

  // Milestones
  await prisma.milestone.createMany({
    data: [
      { name: 'Design Approval', dueDate: new Date('2025-03-15'), completed: true, projectId: project1.id },
      { name: 'Frontend Complete', dueDate: new Date('2025-05-15'), completed: false, projectId: project1.id },
      { name: 'Launch', dueDate: new Date('2025-06-30'), completed: false, projectId: project1.id },
      { name: 'Requirements Sign-off', dueDate: new Date('2025-04-30'), completed: false, projectId: project2.id },
      { name: 'Beta Launch', dueDate: new Date('2025-08-15'), completed: false, projectId: project2.id },
      { name: 'Store Setup', dueDate: new Date('2025-05-01'), completed: true, projectId: project3.id },
      { name: 'Payment Integration', dueDate: new Date('2025-06-15'), completed: false, projectId: project3.id },
    ],
  });
  console.log('  ✅ 7 milestones created');

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
