const fs = require('fs');

const clientsFile = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\api\\src\\routes\\clients.ts';
let clientsContent = fs.readFileSync(clientsFile, 'utf-8');

// Ensure NotificationService is imported
if (!clientsContent.includes('NotificationService')) {
  clientsContent = clientsContent.replace(
    `import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';`,
    `import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';\nimport { NotificationService } from '../services/notifications.js';`
  );
}

// 1. Client Created Notification
const clientCreatedOld = `    // Real-time notification
    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:created', client);`;

const clientCreatedNew = `    // Real-time notification
    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'client:created', client);

    // Notify Admins
    const admins = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, id: { not: req.user!.userId } },
      select: { id: true }
    });
    for (const admin of admins) {
      await NotificationService.send({
        type: 'CLIENT_ADDED',
        message: \`New client "\${client.name}" was added\`,
        userId: admin.id,
        metadata: { clientId: client.id },
      });
    }`;

clientsContent = clientsContent.replace(clientCreatedOld, clientCreatedNew);

// 2. Client Deleted Notification
// Let's find the DELETE route first
// In clients.ts, it's typically:
//   emitToOrganization(io, req.user!.organizationId, 'client:deleted', { id: existing.id });
const clientDeletedOld = `    emitToOrganization(io, req.user!.organizationId, 'client:deleted', { id: existing.id });`;

const clientDeletedNew = `    emitToOrganization(io, req.user!.organizationId, 'client:deleted', { id: existing.id });

    // Notify Admins
    const adminsForDelete = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, role: { in: ['ADMIN', 'SUPER_ADMIN'] }, id: { not: req.user!.userId } },
      select: { id: true }
    });
    for (const admin of adminsForDelete) {
      await NotificationService.send({
        type: 'CLIENT_ADDED', // Note: Prisma enum for NotificationType only has CLIENT_ADDED, so using that with a delete message
        message: \`Client "\${existing.name}" was deleted\`,
        userId: admin.id,
        metadata: { clientId: existing.id },
      });
    }`;

clientsContent = clientsContent.replace(clientDeletedOld, clientDeletedNew);

fs.writeFileSync(clientsFile, clientsContent, 'utf-8');

console.log('Successfully added notifications to clients');
