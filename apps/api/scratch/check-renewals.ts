import { prisma } from '../src/lib/prisma.js';

async function main() {
  const leads = await prisma.lead.findMany({
    where: { stage: 'ACTIVE_RETAINER' },
    select: { id: true, companyName: true, contactName: true, renewalStatus: true, contractEndDate: true }
  });
  console.log('ACTIVE_RETAINER leads count:', leads.length);
  console.log(JSON.stringify(leads, null, 2));
}

main().finally(() => prisma.$disconnect());
