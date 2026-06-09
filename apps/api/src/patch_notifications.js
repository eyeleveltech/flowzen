const fs = require('fs');

// --- TASKS ---
const tasksFile = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\api\\src\\routes\\tasks.ts';
let tasksContent = fs.readFileSync(tasksFile, 'utf-8');

// 1. Task Comments Notification
const taskCommentOld = `    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'comment:created', { ...comment, taskId: (req.params.id as string) });`;

const taskCommentNew = `    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'comment:created', { ...comment, taskId: (req.params.id as string) });

    if (existing.assigneeId && existing.assigneeId !== req.user!.userId) {
      await NotificationService.send({
        type: 'COMMENT_ADDED',
        message: \`\${comment.author?.name || 'Someone'} commented on task "\${existing.title}"\`,
        userId: existing.assigneeId,
        metadata: { taskId: existing.id, projectId: existing.projectId },
      });
    }
    
    // Check mentions
    if (req.body.mentions && Array.isArray(req.body.mentions)) {
      for (const mentionId of req.body.mentions) {
        if (mentionId !== req.user!.userId) {
          await NotificationService.send({
            type: 'MENTION',
            message: \`\${comment.author?.name || 'Someone'} mentioned you in task "\${existing.title}"\`,
            userId: mentionId,
            metadata: { taskId: existing.id, projectId: existing.projectId },
          });
        }
      }
    }`;
tasksContent = tasksContent.replace(taskCommentOld, taskCommentNew);

// 2. Task Completed Notification
const taskCompletedOld = `      // Execute workflow automation rules
      await executeWorkflowRules('TASK_STATUS_CHANGE', {
        task,
        oldStatus: existing.status,
        newStatus: task.status,
        orgId: req.user!.organizationId,
      });
    }`;

const taskCompletedNew = `      // Execute workflow automation rules
      await executeWorkflowRules('TASK_STATUS_CHANGE', {
        task,
        oldStatus: existing.status,
        newStatus: task.status,
        orgId: req.user!.organizationId,
      });

      // Default notifications for completion
      if (task.status === 'COMPLETED' && task.project?.ownerId && task.project.ownerId !== req.user!.userId) {
        await NotificationService.send({
          type: 'TASK_COMPLETED',
          message: \`Task "\${task.title}" was completed\`,
          userId: task.project.ownerId,
          metadata: { taskId: task.id, projectId: task.projectId },
        });
      }
      
      // Default notifications for review
      if (task.status === 'REVIEW' && task.reviewerId && task.reviewerId !== req.user!.userId) {
        await NotificationService.send({
          type: 'TASK_ASSIGNED',
          message: \`Task "\${task.title}" is ready for your review\`,
          userId: task.reviewerId,
          metadata: { taskId: task.id, projectId: task.projectId },
        });
      }
    }`;

// Notice: In the tasks PUT /:id we have `include: { project: { select: { id: true, name: true } } }`. But we need `project.ownerId` for task completed notification.
// So we must update the prisma query to include project ownerId! Let's do that.
const taskPutIncludeOld = `      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        reviewer: { select: { id: true, name: true, avatar: true } },
      },`;
const taskPutIncludeNew = `      include: {
        project: { select: { id: true, name: true, ownerId: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        reviewer: { select: { id: true, name: true, avatar: true } },
      },`;
tasksContent = tasksContent.replace(taskPutIncludeOld, taskPutIncludeNew);
tasksContent = tasksContent.replace(taskCompletedOld, taskCompletedNew);

fs.writeFileSync(tasksFile, tasksContent, 'utf-8');


// --- PROJECTS ---
const projectsFile = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\api\\src\\routes\\projects.ts';
let projectsContent = fs.readFileSync(projectsFile, 'utf-8');

// Ensure NotificationService is imported
if (!projectsContent.includes('NotificationService')) {
  projectsContent = projectsContent.replace(
    `import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';`,
    `import { invalidateOrganizationCache } from '../lib/cacheInvalidator.js';\nimport { NotificationService } from '../services/notifications.js';`
  );
}

// 1. Project Comments Notification
const projectCommentOld = `    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'project_comment:created', { ...comment, projectId: (req.params.id as string) });`;

const projectCommentNew = `    const io = req.app.get('io');
    emitToOrganization(io, req.user!.organizationId, 'project_comment:created', { ...comment, projectId: (req.params.id as string) });

    if (existing.ownerId && existing.ownerId !== req.user!.userId) {
      await NotificationService.send({
        type: 'COMMENT_ADDED',
        message: \`\${comment.author?.name || 'Someone'} commented on project "\${existing.name}"\`,
        userId: existing.ownerId,
        metadata: { projectId: existing.id },
      });
    }

    if (req.body.mentions && Array.isArray(req.body.mentions)) {
      for (const mentionId of req.body.mentions) {
        if (mentionId !== req.user!.userId) {
          await NotificationService.send({
            type: 'MENTION',
            message: \`\${comment.author?.name || 'Someone'} mentioned you in project "\${existing.name}"\`,
            userId: mentionId,
            metadata: { projectId: existing.id },
          });
        }
      }
    }`;
projectsContent = projectsContent.replace(projectCommentOld, projectCommentNew);

// 2. Project Status Notification
const projectStatusOld = `    if (existing.status !== project.status) {
      await prisma.activity.create({
        data: {
          type: 'PROJECT_STATUS_CHANGED',
          message: \`changed project "\${project.name}" status to \${project.status}\`,
          entityType: 'PROJECT',
          entityId: project.id,
          userId: req.user!.userId,
          projectId: project.id,
        },
      });
    }`;

const projectStatusNew = `    if (existing.status !== project.status) {
      await prisma.activity.create({
        data: {
          type: 'PROJECT_STATUS_CHANGED',
          message: \`changed project "\${project.name}" status to \${project.status}\`,
          entityType: 'PROJECT',
          entityId: project.id,
          userId: req.user!.userId,
          projectId: project.id,
        },
      });

      // Notify members
      const membersToNotify = project.members.filter(m => m.user.id !== req.user!.userId);
      for (const m of membersToNotify) {
        await NotificationService.send({
          type: 'PROJECT_STATUS_CHANGED',
          message: \`Project "\${project.name}" status changed to \${project.status.replace('_', ' ')}\`,
          userId: m.user.id,
          metadata: { projectId: project.id },
        });
      }
    }`;
projectsContent = projectsContent.replace(projectStatusOld, projectStatusNew);

fs.writeFileSync(projectsFile, projectsContent, 'utf-8');

console.log('Successfully added notifications to tasks and projects');
