const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.user.update({
    where: { email: 'harish.s@eyelevelstudio.in' },
    data: { isEmailVerified: true }
  });
  console.log('Successfully marked as verified!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
