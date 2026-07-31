import { Router, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getEnabledModuleKeys } from '../lib/modules.js';
import { buildSearchFilter } from '../utils/search-utils.js';

export const searchRouter = Router();
searchRouter.use(authenticate);

// GET /api/search?q=term
searchRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const orgId = req.user!.organizationId;
    const query = req.query.q as string;

    if (!query || query.length < 2) {
      res.json({ clients: [], projects: [], tasks: [], members: [], leads: [], quotes: [] });
      return;
    }

    const enabledModules = await getEnabledModuleKeys(orgId);
    const hasCrm = enabledModules.includes('CRM');
    const hasPm = enabledModules.includes('PM');

    const isTeamMember = req.user!.role === 'TEAM_MEMBER';
    const isCrmRole = ['SUPER_ADMIN', 'ADMIN'].includes(req.user!.role);
    const userId = req.user!.userId;

    const canSearchClients = hasCrm || hasPm;
    const canSearchProjects = hasPm;
    const canSearchTasks = hasPm;
    const canSearchMembers = hasCrm || hasPm;
    // Leads and quotations are CRM objects — searchable only by the roles the CRM API itself
    // admits (SUPER_ADMIN/ADMIN, see /api/crm gating), so search can't leak pipeline data.
    const canSearchCrm = hasCrm && isCrmRole;

    const projectWhere: any = {
      client: { organizationId: orgId },
      ...buildSearchFilter(['name', 'description'], query),
    };
    if (isTeamMember) {
      projectWhere.AND = [
        {
          OR: [
            { members: { some: { userId } } },
            { teams: { some: { team: { members: { some: { id: userId } } } } } },
          ],
        },
      ];
    }

    const taskWhere: any = {
      project: { client: { organizationId: orgId } },
      ...buildSearchFilter(['title', 'description'], query),
    };
    if (isTeamMember) {
      taskWhere.AND = [
        {
          OR: [
            { assigneeId: userId },
            { assignees: { some: { id: userId } } },
          ],
        },
      ];
    }

    const [clients, projects, tasks, members, leads, quotes] = await Promise.all([
      canSearchClients
        ? prisma.client.findMany({
            where: {
              organizationId: orgId,
              archivedAt: null,
              ...buildSearchFilter(['name', 'company'], query),
            },
            select: { id: true, name: true, company: true, status: true },
            take: 5,
          })
        : Promise.resolve([]),
      canSearchProjects
        ? prisma.project.findMany({
            where: projectWhere,
            select: { id: true, name: true, status: true, client: { select: { name: true, company: true } } },
            take: 5,
          })
        : Promise.resolve([]),
      canSearchTasks
        ? prisma.task.findMany({
            where: taskWhere,
            select: { id: true, title: true, status: true, project: { select: { name: true } } },
            take: 5,
          })
        : Promise.resolve([]),
      canSearchMembers
        ? prisma.user.findMany({
            where: {
              organizationId: orgId,
              status: 'ACTIVE',
              ...(isTeamMember ? { id: userId } : buildSearchFilter(['name', 'email'], query)),
            },
            select: { id: true, name: true, email: true, avatar: true, role: true },
            take: 5,
          })
        : Promise.resolve([]),
      canSearchCrm
        ? prisma.lead.findMany({
            where: {
              organizationId: orgId,
              ...buildSearchFilter(['companyName', 'contactName', 'contactEmail', 'contactPhone', 'leadId'], query),
            },
            select: { id: true, leadId: true, companyName: true, contactName: true, stage: true },
            take: 5,
          })
        : Promise.resolve([]),
      canSearchCrm
        ? prisma.quoteDocument.findMany({
            where: {
              organizationId: orgId,
              ...buildSearchFilter(['documentNumber', 'clientName'], query),
            },
            select: { id: true, documentNumber: true, clientName: true, status: true, documentType: true },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    res.json({ clients, projects, tasks, members, leads, quotes });
  } catch (error) {
    next(error);
  }
});
