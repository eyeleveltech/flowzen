import { Router, Request, Response } from 'express';
import { PrismaClient, TaskStatus, TaskPriority } from '@prisma/client';

const prisma = new PrismaClient();
const taskRouter = Router();

// Tasks have no organizationId column; a task belongs to the caller's org if any
// of its links (project→client, lead, client, assignee) resolve to that org.
const orgScopeForTask = (orgId: string) => ({
  OR: [
    { project: { client: { organizationId: orgId } } },
    { lead: { organizationId: orgId } },
    { client: { organizationId: orgId } },
    { assignee: { organizationId: orgId } },
  ],
});

// --- Translators ---
const mapAiStatusToEnum = (status: string): TaskStatus => {
  switch (status) {
    case 'not_started': return 'TODO';
    case 'in_progress': return 'IN_PROGRESS';
    case 'review': return 'REVIEW';
    case 'completed': return 'COMPLETED';
    case 'blocked': return 'BLOCKED';
    default: return 'TODO';
  }
};

const mapEnumToAiStatus = (status: TaskStatus): string => {
  switch (status) {
    case 'BACKLOG':
    case 'TODO': return 'not_started';
    case 'IN_PROGRESS': return 'in_progress';
    case 'REVIEW': return 'review';
    case 'APPROVED':
    case 'COMPLETED': return 'completed';
    case 'BLOCKED': return 'blocked';
    default: return 'not_started';
  }
};

const mapAiPriorityToEnum = (priority: string): TaskPriority => {
  switch (priority) {
    case 'high': return 'HIGH';
    case 'medium': return 'MEDIUM';
    case 'low': return 'LOW';
    default: return 'MEDIUM';
  }
};

const formatTaskResponse = (task: any) => {
  let linkedTo = 'internal';
  let linkedId = '';
  let linkedName = '';

  if (task.lead) {
    linkedTo = 'lead';
    linkedId = task.lead.id;
    linkedName = task.lead.client?.company || task.lead.client?.name || 'Unknown Lead';
  } else if (task.project) {
    linkedTo = 'project';
    linkedId = task.project.id;
    linkedName = task.project.name;
  }

  return {
    id: task.id,
    title: task.title,
    description: task.description || '',
    linked_to: linkedTo,
    linked_id: linkedId,
    linked_name: linkedName,
    assignee: task.assignee ? {
      id: task.assignee.id,
      name: task.assignee.name,
      role: task.assignee.role
    } : null,
    status: mapEnumToAiStatus(task.status),
    priority: task.priority.toLowerCase(),
    due_date: task.dueDate ? task.dueDate.toISOString().split('T')[0] : null,
    tags: [],
    notes: task.description || '',
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
};

// GET /tasks
taskRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { linked_to, linked_id, assignee_id, status, priority, due_before, due_on, unassigned, overdue, limit, page } = req.query;

    const orgId = (req as any).user.organizationId as string;
    const where: any = { AND: [orgScopeForTask(orgId)] };

    if (linked_to === 'lead' && linked_id) {
      where.leadId = linked_id;
    } else if (linked_to === 'project' && linked_id) {
      where.projectId = linked_id;
    }

    if (assignee_id) where.assigneeId = assignee_id;
    if (status) where.status = mapAiStatusToEnum(status as string);
    if (priority) where.priority = mapAiPriorityToEnum(priority as string);

    if (unassigned === 'true') where.assigneeId = null;

    if (due_on) {
      const date = new Date(due_on as string);
      where.dueDate = {
        gte: new Date(date.setHours(0,0,0,0)),
        lt: new Date(date.setHours(23,59,59,999))
      };
    } else if (due_before) {
      where.dueDate = { lte: new Date(due_before as string) };
    }

    if (overdue === 'true') {
      where.dueDate = { lt: new Date() };
      where.status = { notIn: ['COMPLETED', 'APPROVED'] };
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : 100;
    const parsedPage = page ? parseInt(page as string, 10) : 1;
    const skip = (parsedPage - 1) * parsedLimit;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          assignee: true,
          project: true,
          lead: { include: { client: true } }
        },
        skip,
        take: parsedLimit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.task.count({ where })
    ]);

    res.json({
      success: true,
      data: tasks.map(formatTaskResponse),
      meta: {
        page: parsedPage,
        limit: parsedLimit,
        total
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// POST /tasks
taskRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { tasks } = req.body;
    if (!tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ success: false, error: 'Expected an array of tasks under "tasks" key', code: 400 });
    }

    const orgId = (req as any).user.organizationId as string;
    const createdTasks = [];
    for (const taskData of tasks) {
      // Validate the assignee (if provided) belongs to the caller's org.
      const assigneeId = taskData.assignee_id || (req as any).user.userId;
      if (taskData.assignee_id) {
        const member = await prisma.user.findFirst({ where: { id: taskData.assignee_id, organizationId: orgId }, select: { id: true } });
        if (!member) return res.status(400).json({ success: false, error: 'assignee_id does not belong to your organization', code: 400 });
      }

      const data: any = {
        title: taskData.title,
        description: taskData.notes || taskData.description || '',
        priority: mapAiPriorityToEnum(taskData.priority || 'medium'),
        assigneeId,
        dueDate: taskData.due_date ? new Date(taskData.due_date) : null,
      };

      if (taskData.linked_to === 'lead') {
        const lead = await prisma.lead.findFirst({ where: { id: taskData.linked_id, organizationId: orgId }, select: { id: true } });
        if (!lead) return res.status(400).json({ success: false, error: 'linked_id (lead) not found in your organization', code: 400 });
        data.leadId = taskData.linked_id;
      } else if (taskData.linked_to === 'project') {
        const project = await prisma.project.findFirst({ where: { id: taskData.linked_id, client: { organizationId: orgId } }, select: { id: true } });
        if (!project) return res.status(400).json({ success: false, error: 'linked_id (project) not found in your organization', code: 400 });
        data.projectId = taskData.linked_id;
      }

      const newTask = await prisma.task.create({
        data,
        include: { assignee: true, project: true, lead: { include: { client: true } } }
      });
      
      await prisma.activity.create({
        data: {
          type: 'TASK_CREATED',
          message: `created task "${newTask.title}" via EyeLevel AI`,
          entityType: 'TASK',
          entityId: newTask.id,
          userId: (req as any).user.userId,
          projectId: newTask.projectId,
          leadId: newTask.leadId,
        },
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`org_${(req as any).user.organizationId}`).emit('task:created', newTask);
      }
      createdTasks.push(formatTaskResponse(newTask));
    }

    res.status(201).json({ success: true, data: createdTasks });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

// PATCH /tasks/:id
taskRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { status, notes } = req.body;
    
    const orgId = (req as any).user.organizationId as string;
    const existing = await prisma.task.findFirst({
      where: { AND: [{ id: req.params.id as string }, orgScopeForTask(orgId)] },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Task not found', code: 404 });

    const updateData: any = {};
    if (status) updateData.status = mapAiStatusToEnum(status as string);
    if (notes) {
      updateData.description = notes; 
    }

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id as string },
      data: updateData,
      include: { assignee: true, project: true, lead: { include: { client: true } } }
    });

    res.json({ success: true, data: formatTaskResponse(updatedTask) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error', code: 500 });
  }
});

export default taskRouter;
