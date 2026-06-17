const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No user found');
    return;
  }

  // Check if API key exists
  let apiKey = await prisma.apiKey.findFirst({ where: { key: 'fl_live_testkey123' }});
  if (!apiKey) {
    apiKey = await prisma.apiKey.create({
      data: {
        key: 'fl_live_testkey123',
        name: 'EyeLevel AI',
        userId: user.id,
        organizationId: user.organizationId,
      }
    });
  }

  console.log('Using API Key:', apiKey.key);

  const res = await fetch('http://localhost:4000/api/v1/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey.key
    },
    body: JSON.stringify({
      company_name: "Test AI Company",
      contact_name: "John AI",
      vertical: "Healthcare",
      source: "LinkedIn Outreach",
      stage: "1. New Lead",
      monthly_value: 50000
    })
  });

  const data = await res.json();
  console.log('Lead Creation Response:', res.status, data);

  if (res.status === 201) {
    const taskRes = await fetch('http://localhost:4000/api/v1/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey.key
      },
      body: JSON.stringify({
        tasks: [
          {
            title: "Follow up John AI",
            linked_to: "lead",
            linked_id: data.id,
            priority: "high"
          }
        ]
      })
    });
    console.log('Task Creation Response:', taskRes.status, await taskRes.json());
  }
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
