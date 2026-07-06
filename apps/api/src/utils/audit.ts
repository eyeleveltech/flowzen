import { prisma } from '../lib/prisma.js';

export async function createAuditLog(params: {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: any;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        details: params.details || null
      }
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
  }
}
