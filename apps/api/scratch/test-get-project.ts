import { prisma } from '../src/lib/prisma.js';

async function main() {
  const project = await prisma.project.findFirst({
    where: { id: 'cms4kly5l0001vje4w5g38hir' },
  });
  console.log('Project in DB:');
  console.log(JSON.stringify(project, null, 2));
}

main().finally(() => prisma.$disconnect());
