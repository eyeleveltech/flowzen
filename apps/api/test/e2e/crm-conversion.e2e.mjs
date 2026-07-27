/**
 * CRM lead -> client -> project foundation — end-to-end regression suite.
 *
 * This is the guard for the whole "a client is born only when a deal is won, and is never
 * auto-deleted" redesign. It is a BLACK-BOX HTTP test: it talks to a running API over the
 * real network and drives real Prisma/Postgres behaviour, so it catches things the vitest
 * unit tests (which mock Prisma) structurally cannot — FK RESTRICT guards, dedup across
 * repeat business, the cascade-delete data-loss bug, and partial-update field wiping.
 *
 * PREREQUISITES
 *   1. A running API:            npm run dev            (from apps/api, listening on :4000)
 *   2. A seeded database:        npm run seed           (creates the login user below)
 *   The suite mutates data (creates leads/clients/quotes/tasks). Point it at a dev/test
 *   database, NEVER production.
 *
 * RUN
 *   npm run test:e2e:crm                      (from apps/api)
 *   API_URL=http://localhost:4000/api E2E_EMAIL=... E2E_PASSWORD=... node test/e2e/crm-conversion.e2e.mjs
 *
 * Exit code is non-zero if any check fails, so it is CI-friendly.
 */

const BASE = process.env.API_URL || 'http://localhost:4000/api';
const EMAIL = process.env.E2E_EMAIL || 'harish@eyelevel.digital';
const PASSWORD = process.env.E2E_PASSWORD || 'Password@123';
// Unique per-run suffix so reruns never collide on email/phone dedup.
const RUN = process.env.E2E_RUN || String(Date.now());

let cookie = '';
let pass = 0, fail = 0;

const call = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, data };
};

const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const clientCount = async (company) => {
  // List (default excludes archived) and match locally — avoids depending on server search
  // tokenization, which changed in the merge.
  const r = await call('GET', `/clients?limit=200`);
  return (r.data?.clients || []).filter((c) => (c.company === company || c.name === company)).length;
};

const run = async () => {
  // --- login ---
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !cookie) {
    console.log('LOGIN FAILED', login.status, JSON.stringify(login.data).slice(0, 300));
    console.log('Is the API running and the DB seeded? See the header of this file.');
    process.exit(1);
  }
  console.log('modules:', (login.data?.user?.enabledModules || []).join(',') || '(none)');
  console.log('Logged in.\n');

  const CO = 'Acme Conversion Test ' + RUN;

  console.log('1. Lead-only pipeline');
  const created = await call('POST', '/crm/leads', {
    companyName: CO, contactName: 'Jane Doe', email: `jane@${RUN}.test`,
    phone: '9' + String(RUN).slice(-9).padStart(9, '0'), stage: 'NEW_LEAD',
    billingAddress: '12 Test Road, Mumbai', gstNumber: '27AAAAA0000A1Z5',
  });
  const leadId = created.data?.id;
  check('lead created', !!leadId, `${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
  if (!leadId) process.exit(1);
  check('no client at NEW_LEAD', (await clientCount(CO)) === 0);

  await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'OUTREACH', fields: {} });
  check('no client at OUTREACH', (await clientCount(CO)) === 0);
  await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'MEETING', fields: {} });
  check('no client at MEETING', (await clientCount(CO)) === 0);

  console.log('\n2. Pre-sales task on the lead');
  const task = await call('POST', '/tasks', { title: 'Run website audit', leadId, priority: 'HIGH' });
  check('audit task created on lead', task.status === 201, `${task.status} ${JSON.stringify(task.data).slice(0, 200)}`);
  const leadTasks = await call('GET', `/tasks?leadId=${leadId}`);
  check('task visible via ?leadId', (leadTasks.data?.tasks || []).length === 1);
  const allTasks = await call('GET', '/tasks?limit=200');
  check('lead task appears in main task list', (allTasks.data?.tasks || []).some((t) => t.id === task.data?.id));

  console.log('\n3. THE BUG: drag backwards to NEW_LEAD');
  const back = await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'NEW_LEAD', fields: {} });
  check('backward drag succeeds', back.status === 200);
  check('still no client', (await clientCount(CO)) === 0);
  const tasksAfter = await call('GET', `/tasks?leadId=${leadId}`);
  check('audit task survived backward drag', (tasksAfter.data?.tasks || []).length === 1);

  console.log('\n4. Quotation raised from the LEAD (no client yet)');
  const quote = await call('POST', '/crm/quotes', {
    documentType: 'QUOTATION', leadId, expirationDate: '2026-12-31',
    contactPerson: 'Jane Doe', paymentTerms: '50% advance', termsConditions: 'Standard terms apply.',
    lineItems: [{ description: 'Website revamp', unit: 'Nos', quantity: 1, unitPrice: 100000, taxPct: 18 }],
  });
  check('quote raised against a lead', quote.status === 201, `${quote.status} ${JSON.stringify(quote.data).slice(0, 250)}`);
  check('quote has no clientId yet', quote.data?.clientId == null);
  check('billing snapshot taken from lead', quote.data?.billingAddress === '12 Test Road, Mumbai',
    `got ${quote.data?.billingAddress}`);
  check('no client created by quoting', (await clientCount(CO)) === 0);

  console.log('\n5. Win the deal → account is born');
  const won = await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'CONTRACT', dealValue: 100000, fields: {} });
  check('won gate succeeds', won.status === 200, `${won.status} ${JSON.stringify(won.data).slice(0, 200)}`);
  check('exactly one client now exists', (await clientCount(CO)) === 1);

  const cid = won.data?.clientId;
  const client = await call('GET', `/clients/${cid}`);
  check('GST carried across', client.data?.gstNumber === '27AAAAA0000A1Z5', `got ${client.data?.gstNumber}`);
  check('billing address carried across', client.data?.billingAddress === '12 Test Road, Mumbai');
  check('contact carried across', (client.data?.contacts || []).some((c) => c.name === 'Jane Doe'));

  const quoteAfter = await call('GET', `/crm/quotes/${quote.data?.id}`);
  check('lead-quote re-pointed to the new client', quoteAfter.data?.clientId === cid,
    `got ${quoteAfter.data?.clientId}`);

  console.log('\n6. Drag a WON deal back — client must survive');
  await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'NEW_LEAD', fields: {} });
  check('client still exists after backward drag', (await clientCount(CO)) === 1);
  const survived = await call('GET', `/clients/${cid}`);
  check('client data intact (GST)', survived.data?.gstNumber === '27AAAAA0000A1Z5');
  check('client contacts intact', (survived.data?.contacts || []).length > 0);
  check('client not demoted to PROSPECT', survived.data?.status !== 'PROSPECT', `status=${survived.data?.status}`);

  console.log('\n7. Partial client update must NOT wipe contacts');
  // Regression guard: a PUT that does not send a `contacts` array (e.g. the user just changed
  // the account manager or start date) used to unconditionally deleteMany contacts, silently
  // erasing every contact on the account. It must now leave contacts untouched.
  const beforeContacts = (survived.data?.contacts || []).length;
  // A real partial update: change something (status) and, crucially, do NOT send `contacts`.
  const partial = await call('PUT', `/clients/${cid}`, { name: survived.data?.name, status: 'ACTIVE' });
  check('partial client update succeeds', partial.status === 200, `got ${partial.status} ${JSON.stringify(partial.data).slice(0, 200)}`);
  const afterPartial = await call('GET', `/clients/${cid}`);
  check('contacts preserved when not sent in update',
    (afterPartial.data?.contacts || []).length === beforeContacts,
    `had ${beforeContacts}, now ${(afterPartial.data?.contacts || []).length}`);

  console.log('\n8. Field ownership after conversion');
  const edit = await call('PATCH', `/crm/leads/${leadId}`, { companyName: CO + ' RENAMED' });
  check('editing converted lead identity is rejected (409)', edit.status === 409, `got ${edit.status}`);

  console.log('\n9. Repeat business → same client, no twin');
  const lead2 = await call('POST', '/crm/leads', {
    companyName: CO, contactName: 'Jane Doe', email: `jane@${RUN}.test`,
    phone: '8' + String(RUN).slice(-9).padStart(9, '0'), stage: 'NEW_LEAD',
  });
  const l2 = lead2.data?.id;
  const won2 = await call('POST', `/crm/leads/${l2}/stage`, { stage: 'CONTRACT', dealValue: 50000, fields: {} });
  check('second deal won', won2.status === 200);
  check('still exactly one client (deduped)', (await clientCount(CO)) === 1);
  check('second lead linked to the same client', won2.data?.clientId === cid, `got ${won2.data?.clientId} vs ${cid}`);

  console.log('\n10. Deleting a lead must not delete the account');
  const del = await call('DELETE', `/crm/leads/${l2}`);
  check('lead deleted', del.status === 200, `got ${del.status}`);
  check('client survived lead deletion', (await clientCount(CO)) === 1);

  console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('CRASH', e); process.exit(1); });
