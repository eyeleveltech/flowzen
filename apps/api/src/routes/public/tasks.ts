import { Router, Request, Response } from 'express';
import { PrismaClient, TaskStatus, TaskPriority } from '@prisma/client';

const prisma = new PrismaClient();
const taskRouter = Router();

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
    const { linked_to, linked_id, assignee_id, status, priority, due_before, due_on, unassigned, overdue } = req.query;

    const where: any = {};
    
    // Scoping to org (requires checking relations)
    // Note: A more complex org check might be needed if tasks don't have orgId directly,
    // they belong to projects or leads which belong to orgId.
    
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

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: true,
        project: true,
        lead: { include: { client: true } }
      }
    });

    res.json(tasks.map(formatTaskResponse));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /tasks
taskRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { tasks } = req.body;
    if (!tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ error: 'Expected an array of tasks under "tasks" key' });
    }

    const createdTasks = [];
    for (const taskData of tasks) {
      const data: any = {
        title: taskData.title,
        description: taskData.notes || taskData.description || '',
        priority: mapAiPriorityToEnum(taskData.priority || 'medium'),
        assigneeId: taskData.assignee_id || (req as any).user.userId,
        dueDate: taskData.due_date ? new Date(taskData.due_date) : null,
      };

      if (taskData.linked_to === 'lead') {
        data.leadId = taskData.linked_id;
      } else if (taskData.linked_to === 'project') {
        data.projectId = taskData.linked_id;
      }

      const newTask = await prisma.task.create({
        data,
        include: { assignee: true, project: true, lead: { include: { client: true } } }
      });
      createdTasks.push(formatTaskResponse(newTask));
    }

    res.status(201).json(createdTasks);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /tasks/:id
taskRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { status, notes } = req.body;
    
    const updateData: any = {};
    if (status) updateData.status = mapAiStatusToEnum(status as string);
    if (notes) {
      // Could append to description or add a comment
      updateData.description = notes; 
    }

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id as string },
      data: updateData,
      include: { assignee: true, project: true, lead: { include: { client: true } } }
    });

    res.json(formatTaskResponse(updatedTask));
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default taskRouter;
