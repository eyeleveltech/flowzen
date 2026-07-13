const fs = require('fs');
let schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

// 1. Remove incorrect relations injected into User and Task
schema = schema.replace(/  expenses\s+Expense\[\]\s+@relation\("ProjectExpenses"\)\r?\n/g, '');
schema = schema.replace(/  invoiceDraft\s+InvoiceDraft\?\r?\n/g, '');

// 2. Fix Organization model
const orgStart = schema.indexOf('model Organization {');
const orgEnd = schema.indexOf('@@map("organizations")', orgStart);
let orgBody = schema.substring(orgStart, orgEnd);
orgBody = orgBody.replace(/  auditLogs\s+AuditLog\[\].*/s, '');
orgBody += 
`  auditLogs     AuditLog[]      @relation("OrganizationAuditLogs")
  // Revenue
  invoiceDrafts InvoiceDraft[]
  contracts     Contract[]
  payments      Payment[]
  subscriptions Subscription[]
  expenses      Expense[]

  `;
schema = schema.substring(0, orgStart) + orgBody + schema.substring(orgEnd);

// 3. Fix Client model
const clientStart = schema.indexOf('model Client {');
const clientEnd = schema.indexOf('@@map("clients")', clientStart);
let clientBody = schema.substring(clientStart, clientEnd);
clientBody = clientBody.replace(/  \/\/ Revenue.*/s, '');
clientBody +=
`  // Revenue
  invoiceDrafts InvoiceDraft[] @relation("ClientInvoiceDrafts")
  contracts     Contract[]     @relation("ClientContracts")
  payments      Payment[]      @relation("ClientPayments")
  subscriptions Subscription[] @relation("ClientSubscriptions")
  expenses      Expense[]      @relation("ClientExpenses")

  @@index([organizationId])
  @@index([organizationId, status])
  `;
schema = schema.substring(0, clientStart) + clientBody + schema.substring(clientEnd);

// 4. Add correctly to QuoteDocument
const quoteStart = schema.indexOf('model QuoteDocument {');
const quoteEnd = schema.indexOf('@@map("quote_documents")', quoteStart);
let quoteBody = schema.substring(quoteStart, quoteEnd);
if (!quoteBody.includes('invoiceDraft     InvoiceDraft?')) {
    quoteBody = quoteBody.replace(
        /  salesperson      User\?\s+@relation\("QuoteSalesperson", fields: \[salespersonId\], references: \[id\]\)/,
        `  salesperson      User?        @relation("QuoteSalesperson", fields: [salespersonId], references: [id])\n  invoiceDraft     InvoiceDraft?`
    );
    schema = schema.substring(0, quoteStart) + quoteBody + schema.substring(quoteEnd);
}

// 5. Add correctly to Project
const projStart = schema.indexOf('model Project {');
const projEnd = schema.indexOf('@@map("projects")', projStart);
let projBody = schema.substring(projStart, projEnd);
if (!projBody.includes('expenses   Expense[]   @relation("ProjectExpenses")')) {
    projBody = projBody.replace(
        /  comments               Comment\[\]/,
        `  comments               Comment[]\n  expenses   Expense[]   @relation("ProjectExpenses")`
    );
    schema = schema.substring(0, projStart) + projBody + schema.substring(projEnd);
}


fs.writeFileSync('apps/api/prisma/schema.prisma', schema, 'utf8');
console.log('Done cleaning schema.');
