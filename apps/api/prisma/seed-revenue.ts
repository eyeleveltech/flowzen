import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany();
  console.log(`Found ${orgs.length} organizations.`);

  for (const org of orgs) {
    await prisma.organizationModule.upsert({
      where: {
        organizationId_key: {
          organizationId: org.id,
          key: 'REVENUE'
        }
      },
      update: { enabled: true },
      create: {
        organizationId: org.id,
        key: 'REVENUE',
        enabled: true
      }
    });
    console.log(`Enabled REVENUE module for org ${org.id}`);

    // Fetch clients in this org to attach revenue data
    const clients = await prisma.client.findMany({
      where: { organizationId: org.id },
      take: 5
    });

    if (clients.length === 0) continue;

    // Clean up existing to prevent duplication on multiple runs
    await prisma.subscription.deleteMany({ where: { organizationId: org.id } });
    await prisma.payment.deleteMany({ where: { organizationId: org.id } });
    await prisma.contract.deleteMany({ where: { organizationId: org.id } });

    // Create Subscriptions
    for (let i = 0; i < 2; i++) {
      const client = clients[i % clients.length];
      await prisma.subscription.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          amount: 50000 + i * 10000,
          billingFrequency: 'MONTHLY',
          startDate: new Date(),
          status: 'ACTIVE',
          notes: 'Dummy subscription'
        }
      });
    }
    console.log(`Created dummy subscriptions for org ${org.id}`);

    // Create Contracts (used for Receivables calculation)
    for (let i = 0; i < 2; i++) {
      const client = clients[i % clients.length];
      await prisma.contract.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          title: `Project Contract ${i + 1}`,
          value: 150000,
          billingFrequency: 'ONE_TIME',
          startDate: new Date(),
          status: 'ACTIVE'
        }
      });
    }
    console.log(`Created dummy contracts for org ${org.id}`);

    const activeContracts = await prisma.contract.findMany({ where: { organizationId: org.id } });

    // Create Payments for the current month
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const client = clients[i % clients.length];
      const contract = activeContracts[i % activeContracts.length];
      await prisma.payment.create({
        data: {
          organizationId: org.id,
          clientId: client.id,
          contractId: contract?.id, // Link to contract so it reduces receivable
          amount: 25000 + (Math.random() * 50000),
          method: ['Bank Transfer', 'UPI', 'Cheque'][i % 3],
          status: 'PAID',
          paidOn: new Date(now.getFullYear(), now.getMonth(), 5 + i),
          reference: `REF-${Math.floor(Math.random() * 100000)}`,
        }
      });
    }
    console.log(`Created dummy payments for org ${org.id}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
