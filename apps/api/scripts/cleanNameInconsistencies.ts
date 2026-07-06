import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function toProperCase(str: string): string {
  if (!str) return str;
  return str
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const customOverrides: Record<string, string> = {
  'Varshha I': 'Varsha',
  'Varshha': 'Varsha',
  'Athithya': 'Aditya',
  'sakila': 'Shakila',
  'Naif Basha': 'Naif'
};

function cleanName(name: string): string {
  if (!name) return name;
  const trimmed = name.trim();
  // Check custom typos first
  if (customOverrides[trimmed]) {
    return customOverrides[trimmed];
  }
  // Otherwise proper case
  return toProperCase(trimmed);
}

async function run() {
  try {
    console.log("=== STARTING DATABASE NAME STANDARDIZATION ===");

    // 1. Standardize Users
    const users = await prisma.user.findMany();
    let updatedUsers = 0;
    for (const u of users) {
      const cleaned = cleanName(u.name);
      if (cleaned !== u.name) {
        console.log(`User [${u.email}]: "${u.name}" -> "${cleaned}"`);
        await prisma.user.update({
          where: { id: u.id },
          data: { name: cleaned }
        });
        updatedUsers++;
      }
    }
    console.log(`Standardized ${updatedUsers} users.\n`);

    // 2. Standardize Leads
    const leads = await prisma.lead.findMany();
    let updatedLeads = 0;
    for (const l of leads) {
      let changed = false;
      const dataToUpdate: any = {};

      if (l.contactName) {
        const cleanedContact = cleanName(l.contactName);
        if (cleanedContact !== l.contactName) {
          dataToUpdate.contactName = cleanedContact;
          changed = true;
        }
      }

      if (l.companyName) {
        const cleanedCompany = cleanName(l.companyName);
        if (cleanedCompany !== l.companyName) {
          dataToUpdate.companyName = cleanedCompany;
          changed = true;
        }
      }

      if (changed) {
        console.log(`Lead [ID: ${l.leadId}]:`);
        if (dataToUpdate.contactName) console.log(`  Contact: "${l.contactName}" -> "${dataToUpdate.contactName}"`);
        if (dataToUpdate.companyName) console.log(`  Company: "${l.companyName}" -> "${dataToUpdate.companyName}"`);
        await prisma.lead.update({
          where: { id: l.id },
          data: dataToUpdate
        });
        updatedLeads++;
      }
    }
    console.log(`Standardized ${updatedLeads} leads.\n`);

    // 3. Standardize Clients
    const clients = await prisma.client.findMany();
    let updatedClients = 0;
    for (const c of clients) {
      let changed = false;
      const dataToUpdate: any = {};

      if (c.name) {
        const cleanedName = cleanName(c.name);
        if (cleanedName !== c.name) {
          dataToUpdate.name = cleanedName;
          changed = true;
        }
      }

      if (c.company) {
        const cleanedCompany = cleanName(c.company);
        if (cleanedCompany !== c.company) {
          dataToUpdate.company = cleanedCompany;
          changed = true;
        }
      }

      if (changed) {
        console.log(`Client [ID: ${c.id}]:`);
        if (dataToUpdate.name) console.log(`  Name: "${c.name}" -> "${dataToUpdate.name}"`);
        if (dataToUpdate.company) console.log(`  Company: "${c.company}" -> "${dataToUpdate.company}"`);
        await prisma.client.update({
          where: { id: c.id },
          data: dataToUpdate
        });
        updatedClients++;
      }
    }
    console.log(`Standardized ${updatedClients} clients.\n`);

    // 4. Standardize Client Contacts
    const contacts = await prisma.clientContact.findMany();
    let updatedContacts = 0;
    for (const cc of contacts) {
      const cleaned = cleanName(cc.name);
      if (cleaned !== cc.name) {
        console.log(`ClientContact [ID: ${cc.id}]: "${cc.name}" -> "${cleaned}"`);
        await prisma.clientContact.update({
          where: { id: cc.id },
          data: { name: cleaned }
        });
        updatedContacts++;
      }
    }
    console.log(`Standardized ${updatedContacts} client contacts.\n`);

    console.log("=== NAME STANDARDIZATION COMPLETE ===");

  } catch (err) {
    console.error("Cleanup script failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
