import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.apiKey.count();
    console.log('=== Active API Keys Check ===');
    console.log(`Total generated API keys: ${count}`);
    
    if (count > 0) {
      const keys = await prisma.apiKey.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          lastUsedAt: true,
          user: { select: { name: true, email: true } }
        }
      });
      console.log('\nList of keys:');
      keys.forEach((k, i) => {
        console.log(`${i+1}. Name: "${k.name}"`);
        console.log(`   Created by: ${k.user?.name} (${k.user?.email})`);
        console.log(`   Created at: ${k.createdAt}`);
        console.log(`   Last used: ${k.lastUsedAt || 'Never'}`);
      });
    } else {
      console.log('No active API keys have been generated yet. Safe to apply breaking changes!');
    }
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
