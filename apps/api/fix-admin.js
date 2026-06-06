const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' }
    });
    
    console.log('Current admins:', admins.map(a => a.email));
    
    if (admins.length > 0) {
      // Restore all admins to SUPER_ADMIN to ensure someone has access
      const result = await prisma.user.updateMany({
        where: { role: 'ADMIN' },
        data: { role: 'SUPER_ADMIN' }
      });
      console.log(`Restored ${result.count} users back to SUPER_ADMIN.`);
    } else {
      console.log('No admins found to restore.');
    }
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
