import { prisma } from '../src/lib/prisma.js';

async function main() {
  const result = await prisma.lead.updateMany({
    where: {
      stage: 'ACTIVE_RETAINER',
      renewalStatus: null,
    },
    data: {
      renewalStatus: 'UPCOMING',
    },
  });
  console.log(`Backfilled ${result.count} active retainer leads with UPCOMING status.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
