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
      res.json({ clients: [], projects: [], tasks: [], members: [] });
      return;
    }

    const enabledModules = await getEnabledModuleKeys(orgId);
    const hasCrm = enabledModules.includes('CRM');
    const hasPm = enabledModules.includes('PM');

    const canSearchClients = hasCrm || hasPm;
    const canSearchProjects = hasPm;
    const canSearchTasks = hasPm;
    const canSearchMembers = hasCrm || hasPm;

    const isTeamMember = req.user!.role === 'TEAM_MEMBER';
    const userId = req.user!.userId;

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

    const [clients, projects, tasks, members] = await Promise.all([
      canSearchClients
        ? prisma.client.findMany({
            where: {
              organizationId: orgId,
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
              ...buildSearchFilter(['name', 'email'], query),
            },
            select: { id: true, name: true, email: true, avatar: true, role: true },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    res.json({ clients, projects, tasks, members });
  } catch (error) {
    next(error);
  }
});
