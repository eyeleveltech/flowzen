/**
 * Logged hours — end-to-end regression suite.
 *
 * This exists to protect three things that are easy to break and expensive to get wrong:
 *
 *  1. COSTING. A time entry snapshots the person's rate at save time. If that ever became a live
 *     join, giving someone a raise would silently restate the profitability of every project they
 *     had ever touched, and last quarter's numbers would change overnight.
 *
 *  2. THE P&L. Labour has to actually reach it. Before time entries the P&L was payments minus
 *     vendor bills only, so every project looked profitable no matter how many hours it ate.
 *
 *  3. PRIVACY. costRate is what the agency pays for someone's hour — salary data by another name.
 *     A team member must never see it, not even on their own entries, and must not be able to read
 *     or forge anyone else's time.
 *
 * PREREQUISITES: a running API on :4000 and a seeded database (npm run seed).
 * The suite creates and deletes its own entries. Point it at a dev database, NEVER production.
 *
 * RUN: npm run test:e2e:time    (from apps/api)
 */
const BASE = 'http://localhost:4000/api';
const mk = () => { let cookie = ''; return {
  call: async (m, p, b) => {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  } }; };
let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); } };

const admin = mk();
const login = await admin.call('POST', '/auth/login', { email: 'harish@eyelevel.digital', password: 'Password@123' });
check('admin logged in', login.status === 200);

// Find a task with a project so the roll-up has somewhere to land
const tasks = (await admin.call('GET', '/tasks?limit=50')).data;
const list = Array.isArray(tasks) ? tasks : (tasks?.tasks || []);
const task = list.find(t => t.projectId);
check('found a task on a project', !!task, `${list.length} tasks`);
if (!task) process.exit(1);

// Give the admin a cost rate
const users = (await admin.call('GET', '/settings/users')).data;
const me = users.find(u => u.email === 'harish@eyelevel.digital');
const rateSet = await admin.call('PUT', `/settings/users/${me.id}`, { hourlyCostRate: 500 });
check('cost rate saved', rateSet.status === 200 && Number(rateSet.data?.hourlyCostRate) === 500, JSON.stringify(rateSet.data?.hourlyCostRate));

console.log('\nA. Logging time');
const e1 = await admin.call('POST', '/time-entries', { taskId: task.id, hours: 3, date: '2026-08-03', note: 'Design pass' });
check('entry created', e1.status === 201, `${e1.status} ${JSON.stringify(e1.data).slice(0,120)}`);
check('project derived from the task', e1.data?.projectId === task.projectId, `${e1.data?.projectId} vs ${task.projectId}`);
check('cost rate snapshotted', Number(e1.data?.costRate) === 500, JSON.stringify(e1.data?.costRate));
check('cost computed', Number(e1.data?.cost) === 1500, JSON.stringify(e1.data?.cost));

const bad = await admin.call('POST', '/time-entries', { taskId: task.id, hours: 800, date: '2026-08-03' });
check('a 800-hour typo is rejected', bad.status === 400, `${bad.status}`);
const orphan = await admin.call('POST', '/time-entries', { hours: 2, date: '2026-08-03' });
check('time with nothing attached is rejected', orphan.status === 400, `${orphan.status}`);

console.log('\nB. A raise must not rewrite history');
await admin.call('PUT', `/settings/users/${me.id}`, { hourlyCostRate: 900 });
const after = (await admin.call('GET', `/time-entries?taskId=${task.id}`)).data;
const kept = (after.entries || []).find(e => e.id === e1.data.id);
check('existing entry keeps its old rate', Number(kept?.costRate) === 500, JSON.stringify(kept?.costRate));
const e2 = await admin.call('POST', '/time-entries', { taskId: task.id, hours: 1, date: '2026-08-04' });
check('the next entry uses the new rate', Number(e2.data?.costRate) === 900, JSON.stringify(e2.data?.costRate));

console.log('\nC. It reaches the P&L');
const pnl = (await admin.call('GET', '/revenue/pnl')).data;
const row = (pnl || []).find(r => r.projectId === task.projectId);
check('project row carries labour hours', Number(row?.labourHours) === 4, JSON.stringify(row?.labourHours));
check('project row carries labour cost', Number(row?.labourCost) === 2400, JSON.stringify(row?.labourCost));
check('net subtracts labour', Math.abs(Number(row?.net) - (Number(row.revenue) - Number(row.expenses) - 2400)) < 0.01,
  `net=${row?.net} rev=${row?.revenue} exp=${row?.expenses}`);

console.log('\nD. Summary roll-up');
const sum = await admin.call('GET', '/time-entries/summary?groupBy=project');
check('summary returns rows', sum.status === 200 && Array.isArray(sum.data?.rows));
check('summary totals the cost', Number(sum.data?.totalCost) >= 2400, JSON.stringify(sum.data?.totalCost));

console.log('\nE. A team member cannot see the money');
const membersList = (await admin.call('GET', '/settings/users')).data;
const member = membersList.find(u => u.role === 'TEAM_MEMBER' && u.status === 'ACTIVE');
if (!member) { console.log('  SKIP  no active team member seeded'); }
else {
  const tm = mk();
  const li = await tm.call('POST', '/auth/login', { email: member.email, password: 'Password@123' });
  if (li.status !== 200) { console.log(`  SKIP  cannot log in as ${member.email} (${li.status})`); }
  else {
    const own = await tm.call('GET', '/time-entries');
    check('member can list their own time', own.status === 200, `${own.status}`);
    const leaked = JSON.stringify(own.data).includes('costRate');
    check('costRate is stripped for a member', !leaked);
    check('totalCost is withheld from a member', own.data?.totalCost === undefined);
    const s = await tm.call('GET', '/time-entries/summary');
    check('member is refused the cost summary', s.status === 403, `${s.status}`);
    const spy = await tm.call('GET', `/time-entries?userId=${me.id}`);
    const otherPeople = (spy.data?.entries || []).filter(e => e.user?.id !== member.id);
    check("member cannot read someone else's time", otherPeople.length === 0, `${otherPeople.length} foreign entries`);
    const forge = await tm.call('POST', '/time-entries', { taskId: task.id, hours: 1, date: '2026-08-04', userId: me.id });
    check('member cannot log time as someone else', forge.status === 403 || (forge.status === 201 && forge.data?.user?.id === member.id), `${forge.status}`);
    if (forge.status === 201) await admin.call('DELETE', `/time-entries/${forge.data.id}`);
  }
}

// cleanup
for (const e of [e1, e2]) if (e.data?.id) await admin.call('DELETE', `/time-entries/${e.data.id}`);
await admin.call('PUT', `/settings/users/${me.id}`, { hourlyCostRate: null });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
