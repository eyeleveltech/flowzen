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
  // Unwinding a won deal past the win line is guarded (leadStage.service.ts stageTransitionError):
  // without an explicit `reopen` it is a 409 DEAL_CLOSED. Assert the guard fires, then confirm
  // the move with reopen — otherwise the checks below would "pass" simply because nothing moved.
  const unguarded = await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'NEW_LEAD', fields: {} });
  check('unwinding a won deal needs confirmation (409)', unguarded.status === 409, `got ${unguarded.status}`);
  check('guard identifies itself as DEAL_CLOSED', unguarded.data?.code === 'DEAL_CLOSED', `got ${unguarded.data?.code}`);
  const unwound = await call('POST', `/crm/leads/${leadId}/stage`, { stage: 'NEW_LEAD', fields: {}, reopen: true });
  check('confirmed unwind succeeds', unwound.status === 200, `got ${unwound.status}`);
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
  // Clients are now born only from the pipeline or bulk import, so the old direct edit route is
  // deliberately sealed. Pin that contract here so it can't regress back to an open endpoint.
  const sealed = await call('PUT', `/clients/${cid}`, { name: survived.data?.name });
  check('direct PUT /clients/:id is blocked (403)', sealed.status === 403, `got ${sealed.status}`);
  // The live edit route is the CRM one — run the contact-wipe regression guard against it, or
  // the guard covers a route nobody can reach. A partial update changes a field and, crucially,
  // does NOT send `contacts`.
  const partial = await call('PUT', `/crm/clients/${cid}`, { name: survived.data?.name, industry: 'Regression Test Industry' });
  check('partial client update succeeds', partial.status === 200, `got ${partial.status} ${JSON.stringify(partial.data).slice(0, 200)}`);
  check('partial update applied the changed field', partial.data?.industry === 'Regression Test Industry', `got ${partial.data?.industry}`);
  const afterPartial = await call('GET', `/clients/${cid}`);
  check('contacts preserved when not sent in update',
    (afterPartial.data?.contacts || []).length === beforeContacts,
    `had ${beforeContacts}, now ${(afterPartial.data?.contacts || []).length}`);

  console.log('\n8. Field ownership after conversion');
  // A lead and the client it became are ONE company: the pipeline stays a valid place to edit
  // the company, and the edit lands on the account too. The Client is the master record.
  const edit = await call('PATCH', `/crm/leads/${leadId}`, { companyName: CO + ' RENAMED' });
  check('company can still be edited from the pipeline', edit.status === 200, `got ${edit.status}`);
  const afterEdit = await call('GET', `/clients/${cid}`);
  check('edit propagated to the client account', afterEdit.data?.name === CO + ' RENAMED',
    `got ${JSON.stringify(afterEdit.data?.name)}`);
  // ...but a rename must never mint a second account with an existing name. Client names are
  // unique per org; this path used to bypass that check entirely.
  // Pick any OTHER existing account rather than a seeded name, so this holds in any environment.
  const others = (await call('GET', '/clients?limit=200')).data?.clients || [];
  const twin = others.find((c) => c.id !== cid && c.name);
  if (!twin) {
    console.log('  SKIP  rename-collision (needs a second client in this org)');
  } else {
    const collide = await call('PATCH', `/crm/leads/${leadId}`, { companyName: twin.name });
    check('rename onto an existing client name is rejected (409)', collide.status === 409, `got ${collide.status}`);
    const afterCollide = await call('GET', `/clients/${cid}`);
    check('client untouched by the rejected rename', afterCollide.data?.name === CO + ' RENAMED',
      `got ${JSON.stringify(afterCollide.data?.name)}`);
  }
  // Put the name back so the dedup checks below still find the account.
  await call('PATCH', `/crm/leads/${leadId}`, { companyName: CO });

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

  // A lead is a COMPANY and its people are rows in lead_contacts — there are no flat
  // contactName/contactEmail/contactPhone columns any more. Everything the UI shows for "the
  // person on this lead" is re-derived from whichever contact carries isPrimary.
  //
  // The ten sections above all passed while three things were badly broken: the list and detail
  // endpoints returned no person at all (they never included `contacts`, so there was nothing to
  // derive from), and every lead edit failed outright because the route still tried to write the
  // dropped columns. None of that was caught because no test above ever asserted on a contact
  // field coming BACK from the API. That is what this section is for.
  console.log('\n11. The person on a lead lives in lead_contacts');
  const PCO = `Primary Contact Co ${RUN}`;
  const pl = await call('POST', '/crm/leads', {
    companyName: PCO, contactName: 'Alice First', jobTitle: 'CTO',
    email: `alice@${RUN}.test`, phone: '7' + String(RUN).slice(-9).padStart(9, '0'),
  });
  const plId = pl.data?.id;
  check('create echoes the person back', pl.data?.contactName === 'Alice First', `got ${JSON.stringify(pl.data?.contactName)}`);

  const listed = await call('GET', '/crm/leads');
  const boardRow = (listed.data || []).find((l) => l.id === plId);
  check('board list carries the person', boardRow?.contactName === 'Alice First', `got ${JSON.stringify(boardRow?.contactName)}`);
  const detail = await call('GET', `/crm/leads/${plId}`);
  check('detail carries the person', detail.data?.contactName === 'Alice First', `got ${JSON.stringify(detail.data?.contactName)}`);

  // Exactly one contact is primary at all times, and it is the one the lead reads from.
  const firstContacts = await call('GET', `/crm/leads/${plId}/contacts`);
  check('the first contact is primary automatically', (firstContacts.data || []).filter((c) => c.isPrimary).length === 1);

  const second = await call('POST', `/crm/leads/${plId}/contacts`, { name: 'Bob Second', role: 'CHAMPION', email: `bob@${RUN}.test` });
  check('adding a contact does not steal primary', second.data?.isPrimary === false, `got ${second.data?.isPrimary}`);

  await call('PATCH', `/crm/leads/${plId}/contacts/${second.data?.id}`, { isPrimary: true });
  const promoted = await call('GET', `/crm/leads/${plId}/contacts`);
  check('promoting demotes the previous primary', (promoted.data || []).filter((c) => c.isPrimary).length === 1);
  const afterPromote = await call('GET', `/crm/leads/${plId}`);
  check('the lead follows the new primary', afterPromote.data?.contactEmail === `bob@${RUN}.test`, `got ${afterPromote.data?.contactEmail}`);

  await call('DELETE', `/crm/leads/${plId}/contacts/${second.data?.id}`);
  const afterDelete = await call('GET', `/crm/leads/${plId}`);
  check('deleting the primary promotes the next, never headless', afterDelete.data?.contactName === 'Alice First',
    `got ${JSON.stringify(afterDelete.data?.contactName)}`);

  console.log('\n12. Editing a lead');
  const edited = await call('PATCH', `/crm/leads/${plId}`, {
    companyName: PCO, contactName: 'Alice Renamed', contactEmail: `alice2@${RUN}.test`,
    jobTitle: 'CEO', city: 'Madurai', dealValue: 50000,
  });
  check('the edit form payload is accepted', edited.status === 200, `got ${edited.status} ${JSON.stringify(edited.data).slice(0, 120)}`);
  check('person fields land on the contact row', edited.data?.contactName === 'Alice Renamed', `got ${JSON.stringify(edited.data?.contactName)}`);
  check('job title lands on the contact row', edited.data?.jobTitle === 'CEO', `got ${JSON.stringify(edited.data?.jobTitle)}`);
  check('company fields land on the lead row', edited.data?.city === 'Madurai', `got ${JSON.stringify(edited.data?.city)}`);

  // A partial edit must touch only what it sends — the same guarantee section 7 checks for clients.
  const partialContact = await call('PATCH', `/crm/leads/${plId}`, { contactPhone: '9000000123' });
  check('a partial edit keeps the other contact fields', partialContact.data?.contactEmail === `alice2@${RUN}.test`,
    `got ${JSON.stringify(partialContact.data?.contactEmail)}`);
  check('a partial edit applies what it does send', partialContact.data?.contactPhone === '9000000123',
    `got ${JSON.stringify(partialContact.data?.contactPhone)}`);

  // Clearing a value has to be possible: sending undefined reads as "leave it alone", so the
  // forms send an explicit null and the route has to honour it.
  const clearedDeal = await call('PATCH', `/crm/leads/${plId}`, { dealValue: null, expectedCloseDate: null });
  check('an emptied deal value is actually cleared', clearedDeal.data?.dealValue === null, `got ${JSON.stringify(clearedDeal.data?.dealValue)}`);

  console.log('\n13. Winning carries the contact list to the account');
  const pWon = await call('POST', `/crm/leads/${plId}/stage`, { stage: 'CONTRACT', dealValue: 25000, fields: {} });
  const pClientId = pWon.data?.clientId;
  check('deal won', pWon.status === 200, `got ${pWon.status}`);
  if (pClientId) {
    const pClient = await call('GET', `/crm/clients/${pClientId}`);
    check('account has exactly one primary contact', (pClient.data?.contacts || []).filter((c) => c.isPrimary).length === 1,
      JSON.stringify((pClient.data?.contacts || []).map((c) => ({ n: c.name, p: c.isPrimary }))));
    check('account email came from the primary contact', pClient.data?.email === `alice2@${RUN}.test`,
      `got ${JSON.stringify(pClient.data?.email)}`);

    // The client edit form replaces the whole contact list (deleteMany + create) and does not
    // send isPrimary, so without the carry-forward every save silently demoted everyone.
    const reSaved = await call('PUT', `/crm/clients/${pClientId}`, {
      name: PCO, city: 'Coimbatore',
      contacts: (pClient.data?.contacts || []).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })),
    });
    check('editing the client keeps a primary contact', (reSaved.data?.contacts || []).filter((c) => c.isPrimary).length === 1,
      JSON.stringify((reSaved.data?.contacts || []).map((c) => ({ n: c.name, p: c.isPrimary }))));
    await call('DELETE', `/clients/${pClientId}`);
  }
  await call('DELETE', `/crm/leads/${plId}`);

  console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('CRASH', e); process.exit(1); });
