require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const apiKey = process.env.FLOWZEN_API_KEY;
const baseUrl = process.env.FLOWZEN_BASE_URL;

if (!apiKey || !baseUrl) {
  console.error("Error: FLOWZEN_API_KEY or FLOWZEN_BASE_URL not found in .env file.");
  process.exit(1);
}

console.log(`Using API Key: ${apiKey}`);
console.log(`Connecting to: ${baseUrl}\n`);

async function testApi() {
  try {
    // 1. Create Lead
    console.log("--- 1. Creating a Lead ---");
    const leadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        company_name: "Env File Test Corp",
        contact_name: "Env User",
        vertical: "SaaS",
        source: "Inbound Website",
        stage: "1. New Lead",
        monthly_value: 30000
      })
    });
    
    const leadData = await leadRes.json();
    console.log(`Status: ${leadRes.status}`);
    console.log(`Lead ID: ${leadData.id}`);
    
    // 2. Add Task linked to Lead
    console.log("\n--- 2. Creating a Linked Task ---");
    const taskRes = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        tasks: [
          {
            title: "Follow up with Env File Test Corp",
            linked_to: "lead",
            linked_id: leadData.id,
            priority: "high"
          }
        ]
      })
    });
    
    const taskData = await taskRes.json();
    console.log(`Status: ${taskRes.status}`);
    console.log(`Task Created: ${taskData[0]?.title}\n`);

  } catch (error) {
    console.error("Test failed:", error.message);
  }
}

testApi();
