import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    console.log("=== STARTING CLIENT REVENUE BACKFILL ===");

    // Fetch all clients that have associated leads
    const clients = await prisma.client.findMany({
      include: { lead: true }
    });

    let backfilled = 0;
    for (const c of clients) {
      if (c.lead && c.lead.dealValue && !c.contractValue) {
        console.log(`Client "${c.name}": Setting contractValue to lead dealValue: ₹${c.lead.dealValue.toLocaleString()}`);
        await prisma.client.update({
          where: { id: c.id },
          data: { contractValue: c.lead.dealValue }
        });
        backfilled++;
      }
    }

    console.log(`\n✅ Backfill complete. Synchronized ${backfilled} clients.`);

  } catch (err) {
    console.error("Backfill failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
