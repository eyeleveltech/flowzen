import { prisma } from '../src/lib/prisma.js';

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: 'cms4kly5l0001vje4w5g38hir' },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      reportingCadence: true,
      client: { select: { id: true, name: true } },
    },
  });
  console.log('Project Details:');
  console.log(JSON.stringify(project, null, 2));
}

main().finally(() => prisma.$disconnect());
