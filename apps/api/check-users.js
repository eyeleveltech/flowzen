const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ select: { email: true } });
  console.log('Users in DB:', users.map(u => u.email));
}
main().catch(console.error).finally(() => prisma.$disconnect());
