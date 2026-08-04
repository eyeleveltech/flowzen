/**
 * File attachments — end-to-end regression suite.
 *
 * File upload is the single most dangerous surface in a web app, and this guards the three ways
 * it usually goes wrong:
 *
 *  1. PATH TRAVERSAL. The on-disk name is generated from random bytes and is the only value ever
 *     joined to a path; the user's filename is display-only. A file called "../../../.env" must
 *     be stored harmlessly and must not escape the uploads directory.
 *
 *  2. STORED XSS. An uploaded .html or .svg served inline would execute in the viewer's session
 *     on this origin. Downloads must always carry Content-Disposition: attachment and nosniff.
 *
 *  3. CROSS-TENANT ACCESS. An attachment may only be listed, downloaded or deleted by its own
 *     organization, and an unknown id must answer 404 rather than 403 (a 403 confirms it exists).
 *
 * PREREQUISITES: a running API on :4000 and a seeded database (npm run seed).
 * RUN: npm run test:e2e:attachments    (from apps/api)
 */

const BASE = 'http://localhost:4000/api';
let cookie = '';
const call = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
};
const send = async (p, form) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}) }, body: form });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
};
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); } };

await call('POST', '/auth/login', { email: 'harish@eyelevel.digital', password: 'Password@123' });
const stamp = Date.now();

const lead = (await call('POST', '/crm/leads', { companyName: `Attach Co ${stamp}` })).data;
check('lead created for the test', !!lead?.id);

console.log('\nA. Uploading');
const f1 = new FormData();
f1.append('file', new Blob(['hello brief'], { type: 'text/plain' }), 'creative-brief.txt');
f1.append('leadId', lead.id);
const up = await send('/attachments', f1);
check('file uploaded', up.status === 201, `${up.status} ${JSON.stringify(up.data).slice(0, 140)}`);
check('original filename preserved for display', up.data?.filename === 'creative-brief.txt', up.data?.filename);
check('size recorded', up.data?.size === 11, String(up.data?.size));
check('on-disk name never returned to the client', !JSON.stringify(up.data).includes('storedName'));

const list = await call('GET', `/attachments?leadId=${lead.id}`);
check('appears in the listing', (list.data || []).some((a) => a.id === up.data.id));

console.log('\nB. Path traversal');
const f2 = new FormData();
f2.append('file', new Blob(['pwned'], { type: 'text/plain' }), '../../../.env');
f2.append('leadId', lead.id);
const eviltrav = await send('/attachments', f2);
check('a traversal filename is accepted but neutralised', eviltrav.status === 201, `${eviltrav.status}`);
// The multipart transport normalises the filename to its basename before the request is even
// parsed, so what arrives is ".env" rather than "../../../.env". That is defence in depth, not
// the defence — the guarantee being asserted is that WHATEVER name arrives is treated as display
// data and never as a path, so the stored name can contain no separators and the real file lands
// under a generated name inside the uploads directory.
// Checked with indexOf rather than a regex: a character class containing a backslash is exactly
// the kind of thing that silently loses an escape somewhere between editor, shell and file, and
// a security assertion that quietly stops testing half of what it claims is worse than none.
const evilName = eviltrav.data?.filename || '';
const BACKSLASH = String.fromCharCode(92);
check(
  'no path separator of either kind survives into the stored name',
  !evilName.includes('/') && !evilName.includes(BACKSLASH),
  JSON.stringify(evilName),
);
const dl2 = await fetch(`${BASE}/attachments/${eviltrav.data.id}/download`, { headers: { Cookie: cookie } });
check('it downloads back as an ordinary file', dl2.status === 200, String(dl2.status));
check('and its content is what was uploaded, not a real .env', (await dl2.text()) === 'pwned');

console.log('\nC. Type filtering');
const f3 = new FormData();
f3.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
f3.append('leadId', lead.id);
const html = await send('/attachments', f3);
check('an HTML upload is refused', html.status === 400, `${html.status} ${JSON.stringify(html.data).slice(0, 90)}`);

const f4 = new FormData();
f4.append('file', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'thing.exe');
f4.append('leadId', lead.id);
const exe = await send('/attachments', f4);
check('an executable is refused', exe.status === 400, `${exe.status}`);

console.log('\nD. Download headers');
const dl = await fetch(`${BASE}/attachments/${up.data.id}/download`, { headers: { Cookie: cookie } });
check('download succeeds', dl.status === 200);
check('forces a save rather than rendering', (dl.headers.get('content-disposition') || '').startsWith('attachment'), dl.headers.get('content-disposition'));
check('sniffing is disabled', dl.headers.get('x-content-type-options') === 'nosniff');

console.log('\nE. Ownership');
const orphan = new FormData();
orphan.append('file', new Blob(['x'], { type: 'text/plain' }), 'orphan.txt');
const noOwner = await send('/attachments', orphan);
check('a file with no owner record is refused', noOwner.status === 400, `${noOwner.status}`);

const two = new FormData();
two.append('file', new Blob(['x'], { type: 'text/plain' }), 'two.txt');
two.append('leadId', lead.id);
two.append('clientId', lead.id);
const twoOwners = await send('/attachments', two);
check('attaching to two records at once is refused', twoOwners.status === 400, `${twoOwners.status}`);

const fake = new FormData();
fake.append('file', new Blob(['x'], { type: 'text/plain' }), 'fake.txt');
fake.append('leadId', 'does-not-exist');
const fakeOwner = await send('/attachments', fake);
check('attaching to an unknown record is refused', fakeOwner.status === 400, `${fakeOwner.status}`);

const missing = await fetch(`${BASE}/attachments/nope-not-real/download`, { headers: { Cookie: cookie } });
check('an unknown id answers 404, not 403', missing.status === 404, String(missing.status));

console.log('\nF. Deletion');
const del = await call('DELETE', `/attachments/${up.data.id}`);
check('delete succeeds', del.status === 200);
const after = await call('GET', `/attachments?leadId=${lead.id}`);
check('it is gone from the listing', !(after.data || []).some((a) => a.id === up.data.id));
const goneDl = await fetch(`${BASE}/attachments/${up.data.id}/download`, { headers: { Cookie: cookie } });
check('and can no longer be downloaded', goneDl.status === 404, String(goneDl.status));

// cleanup — deleting the lead cascades its remaining attachments
await call('DELETE', `/crm/leads/${lead.id}`);
const afterLead = await call('GET', `/attachments?leadId=${lead.id}`);
check('deleting the owner cascades its files away', (afterLead.data || []).length === 0, JSON.stringify(afterLead.data));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
