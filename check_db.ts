import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      name: 'Internal'
    }
  });
  console.log('Internal Clients:', JSON.stringify(clients, null, 2));

  // Also check if any clients have "Internal" in their name but are slightly different (e.g. "(Internal)")
  const otherClients = await prisma.client.findMany({
    where: {
      name: {
        contains: 'Internal'
      }
    }
  });
  console.log('Other matching clients:', JSON.stringify(otherClients, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
