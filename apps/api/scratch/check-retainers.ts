import { prisma } from '../src/lib/prisma.js';

async function main() {
  const retainers = await prisma.project.findMany({
    where: { type: 'RETAINER' },
    select: { id: true, name: true, type: true, reportingCadence: true },
  });
  console.log('Existing RETAINER projects count:', retainers.length);
  console.log(JSON.stringify(retainers, null, 2));
}

main().finally(() => prisma.$disconnect());
