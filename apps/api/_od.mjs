import { PrismaClient } from '@prisma/client';
import { sendOrgCrmDigest } from './dist/services/notificationScanners.js';
const p = new PrismaClient();
const org = await p.organization.findFirst({ select: { id: true, settings: true } });
const lead = await p.lead.findFirst({ where: { organizationId: org.id }, select: { id: true, followUpDate: true, stage: true, assignedToId: true } });
const origOrg = org.settings; const origLead = { followUpDate: lead.followUpDate, stage: lead.stage };
// configure business email + make a follow-up due today
await p.organization.update({ where: { id: org.id }, data: { settings: { ...(org.settings||{}), crmNotificationEmail: 'owner@example.com, sales@example.com' } } });
const today = new Date(); today.setHours(12,0,0,0);
await p.lead.update({ where: { id: lead.id }, data: { followUpDate: today, stage: lead.stage === 'CHURNED' ? 'OUTREACH' : lead.stage } });
const sent = await sendOrgCrmDigest();
console.log('org digests sent:', sent, '(expect >= 1)');
// revert
await p.organization.update({ where: { id: org.id }, data: { settings: origOrg || {} } });
await p.lead.update({ where: { id: lead.id }, data: origLead });
console.log('reverted');
await p.$disconnect();
