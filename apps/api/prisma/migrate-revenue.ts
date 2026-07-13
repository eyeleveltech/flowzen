import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN !== 'false'; // Defaults to true unless explicitly false

async function main() {
  console.log(`=============================================`);
  console.log(` REVENUE MODULE BACKFILL MIGRATION`);
  console.log(` MODE: ${DRY_RUN ? 'DRY RUN (No data will be modified)' : 'PRODUCTION (Modifying data)'}`);
  console.log(`=============================================\n`);

  const stats = {
    scannedLeads: 0,
    contractsCreated: 0,
    contractsSkipped: 0,
    subscriptionsCreated: 0,
    subscriptionsSkipped: 0,
    paymentsCreated: 0,
    expensesMigrated: 0,
    errors: 0,
  };

  try {
    const orgs = await prisma.organization.findMany();
    
    for (const org of orgs) {
      console.log(`\nProcessing Organization: ${org.name} (${org.id})`);

      // 1. Fetch active leads
      const activeLeads = await prisma.lead.findMany({
        where: {
          organizationId: org.id,
          stage: {
            in: ['ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'CONTRACT']
          },
          clientId: { not: null }
        },
        include: {
          client: true,
          dealFields: true
        }
      });

      stats.scannedLeads += activeLeads.length;
      console.log(`  Found ${activeLeads.length} active leads to evaluate.`);

      for (const lead of activeLeads) {
        if (!lead.clientId) continue;

        try {
          // Extract fields just like the CRM automation does
          const billingFreqRaw = lead.dealFields?.find(f => f.fieldKey === 'Billing Frequency' || f.fieldKey === 'billingFrequency')?.fieldValue;
          const billingFreq = String(billingFreqRaw || 'MONTHLY').toUpperCase();
          const startDateRaw = lead.dealFields?.find(f => f.fieldKey === 'Start Date Confirmed' || f.fieldKey === 'startDate')?.fieldValue;
          const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
          const agreedValue = lead.dealValue || 0;

          if (lead.stage === 'ACTIVE_RETAINER') {
            // SUBSCRIPTION LOGIC
            const existingSubscription = await prisma.subscription.findFirst({
              where: {
                organizationId: org.id,
                clientId: lead.clientId,
                amount: agreedValue
              }
            });

            if (existingSubscription) {
              stats.subscriptionsSkipped++;
              console.log(`    [SKIP] Subscription already exists for client ${lead.clientId}`);
            } else {
              if (!DRY_RUN) {
                await prisma.$transaction(async (tx) => {
                  await tx.subscription.create({
                    data: {
                      organizationId: org.id,
                      clientId: lead.clientId as string,
                      amount: agreedValue,
                      billingFrequency: billingFreq === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
                      startDate: startDate,
                      notes: 'Auto-migrated from legacy CRM data'
                    }
                  });
                });
              }
              stats.subscriptionsCreated++;
              console.log(`    [CREATE] Subscription created for client ${lead.clientId} (${agreedValue})`);
            }
          } else if (lead.stage === 'ACTIVE_PROJECT' || lead.stage === 'CONTRACT') {
            // CONTRACT LOGIC
            const title = `${lead.companyName || lead.contactName || 'Legacy Deal'} - Contract`;
            
            const existingContract = await prisma.contract.findFirst({
              where: {
                organizationId: org.id,
                clientId: lead.clientId,
                title: title
              }
            });

            if (existingContract) {
              stats.contractsSkipped++;
              console.log(`    [SKIP] Contract already exists for client ${lead.clientId}`);
            } else {
              if (!DRY_RUN) {
                await prisma.$transaction(async (tx) => {
                  await tx.contract.create({
                    data: {
                      organizationId: org.id,
                      clientId: lead.clientId as string,
                      title: title,
                      value: agreedValue,
                      billingFrequency: billingFreq === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME',
                      startDate: startDate,
                      notes: 'Auto-migrated from legacy CRM data'
                    }
                  });
                });
              }
              stats.contractsCreated++;
              console.log(`    [CREATE] Contract created for client ${lead.clientId} (${agreedValue})`);
            }
          }
        } catch (e) {
          stats.errors++;
          console.error(`    [ERROR] Failed to process lead ${lead.id}:`, e);
        }
      }
    }

    console.log(`\n=============================================`);
    console.log(` MIGRATION SUMMARY`);
    console.log(`=============================================`);
    console.log(`Scanned Leads: ${stats.scannedLeads}`);
    console.log(`Contracts Created: ${stats.contractsCreated}`);
    console.log(`Contracts Skipped: ${stats.contractsSkipped}`);
    console.log(`Subscriptions Created: ${stats.subscriptionsCreated}`);
    console.log(`Subscriptions Skipped: ${stats.subscriptionsSkipped}`);
    console.log(`Payments Created: ${stats.paymentsCreated}`);
    console.log(`Expenses Migrated: ${stats.expensesMigrated}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`=============================================`);
    if (DRY_RUN) {
      console.log(`\nThis was a DRY RUN. No data was modified.`);
      console.log(`To execute this migration in production, run:`);
      console.log(`$env:DRY_RUN="false"; npx ts-node prisma/migrate-revenue.ts\n`);
    }

  } catch (error) {
    console.error('Fatal Migration Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
