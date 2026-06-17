const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function generateProductionApiKey() {
  console.log('=============================================');
  console.log('🔑 Flowzen Production API Key Generator 🔑');
  console.log('=============================================\n');

  try {
    // We bind the API key to the first Super Admin or Admin in the system
    // Change this logic if you want a specific user to own the API key
    const user = await prisma.user.findFirst({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    });

    if (!user) {
      console.error('❌ Error: No Admin or Super Admin user found in the database.');
      console.error('Make sure you have created at least one admin account before running this.');
      process.exit(1);
    }

    // Generate a secure random string (fl_live_ + 32 random hex chars)
    const secureRandomString = crypto.randomBytes(16).toString('hex');
    const apiKeyString = `fl_live_${secureRandomString}`;

    // Create the key in the database
    const newKey = await prisma.apiKey.create({
      data: {
        key: apiKeyString,
        name: 'EyeLevel AI OS Production Connection',
        userId: user.id,
        organizationId: user.organizationId,
      }
    });

    console.log('✅ API Key successfully generated and saved to the database!\n');
    console.log(`👤 Owner: ${user.name} (${user.email})`);
    console.log(`🏢 Organization ID: ${user.organizationId}\n`);
    
    console.log('---------------------------------------------');
    console.log('Copy the key below and provide it to the AI OS Team:');
    console.log(`\nFLOWZEN_API_KEY=${newKey.key}\n`);
    console.log('---------------------------------------------');

  } catch (error) {
    console.error('❌ Failed to generate API Key:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

generateProductionApiKey();
