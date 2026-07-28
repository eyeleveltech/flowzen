import { prisma } from '../src/lib/prisma.js';

async function main() {
  const result = await prisma.project.updateMany({
    where: {
      type: 'RETAINER',
      reportingCadence: 'NONE',
    },
    data: {
      reportingCadence: 'MONTHLY',
    },
  });
  console.log(`Backfilled ${result.count} pre-existing retainer projects to MONTHLY reporting cadence.`);
}

main().finally(() => prisma.$disconnect());
