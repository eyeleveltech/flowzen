import { prisma } from '../lib/prisma.js';
import { NotificationService } from './notifications.js';
import { logger } from '../utils/logger.js';
import { escapeHtml } from '../utils/html.js';

interface WorkflowContext {
  task: any;
  oldStatus?: string;
  newStatus?: string;
  orgId: string;
}

/**
 * Executes all active workflow rules for a given trigger and context.
 * Called automatically after task mutations (status change, assignment, etc.)
 */
export async function executeWorkflowRules(
  trigger: 'TASK_STATUS_CHANGE' | 'TASK_ASSIGNED' | 'TASK_DEADLINE_APPROACHING',
  context: WorkflowContext
) {
  try {
    const rules = await prisma.workflowRule.findMany({
      where: {
        organizationId: context.orgId,
        trigger,
        isActive: true,
      },
    });

    if (rules.length === 0) return;

    for (const rule of rules) {
      const condition = rule.condition as Record<string, any>;

      // Evaluate condition
      if (!evaluateCondition(trigger, condition, context)) continue;

      // Resolve target users
      const targetUsers = await resolveTargets(rule.targets, context);

      // Dispatch actions
      for (const target of targetUsers) {
        const message = buildMessage(trigger, condition, context);

        if (rule.action === 'NOTIFY' || rule.action === 'NOTIFY_AND_EMAIL') {
          await NotificationService.send({
            type: mapTriggerToNotificationType(trigger),
            message,
            userId: target.userId,
            metadata: { taskId: context.task.id, projectId: context.task.projectId, ruleId: rule.id },
          });
        }

        if ((rule.action === 'EMAIL' || rule.action === 'NOTIFY_AND_EMAIL') && target.email) {
          await NotificationService.sendEmail({
            to: target.email,
            subject: `[Flowzen] ${message}`,
            html: `
              <div style="font-family: 'Inter', sans-serif; padding: 24px; max-width: 480px;">
                <h2 style="color: #111827; font-size: 18px; margin-bottom: 8px;">Workflow Automation</h2>
                <p style="color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(message)}</p>
                <p style="color: #6B7280; font-size: 13px; margin-top: 16px;">
                  Task: <strong>${escapeHtml(context.task.title)}</strong><br/>
                  Project: <strong>${escapeHtml(context.task.project?.name || 'N/A')}</strong>
                </p>
                <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/tasks?taskId=${context.task.id}" 
                   style="display: inline-block; margin-top: 16px; background: #111827; color: #fff; padding: 10px 24px; border-radius: 12px; text-decoration: none; font-size: 14px;">
                  View Task
                </a>
              </div>
            `,
          });
        }
      }

      logger.info(`[WorkflowEngine] Rule "${rule.name}" executed for task "${context.task.title}"`);
    }
  } catch (error) {
    logger.error('[WorkflowEngine] Error executing workflow rules:', error);
  }
}

function evaluateCondition(
  trigger: string,
  condition: Record<string, any>,
  context: WorkflowContext
): boolean {
  switch (trigger) {
    case 'TASK_STATUS_CHANGE':
      if (condition.toStatus && context.newStatus !== condition.toStatus) return false;
      if (condition.fromStatus && context.oldStatus !== condition.fromStatus) return false;
      return true;

    case 'TASK_ASSIGNED':
      // Always fires when a task is assigned
      return true;

    case 'TASK_DEADLINE_APPROACHING':
      // Evaluated externally (cron job), always true when called
      return true;

    default:
      return false;
  }
}

async function resolveTargets(
  targets: string[],
  context: WorkflowContext
): Promise<{ userId: string; email: string | null }[]> {
  const result: { userId: string; email: string | null }[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    switch (target) {
      case 'ASSIGNEE': {
        if (context.task.assigneeId) {
          const user = await prisma.user.findUnique({
            where: { id: context.task.assigneeId },
            select: { id: true, email: true },
          });
          if (user && !seen.has(user.id)) {
            seen.add(user.id);
            result.push({ userId: user.id, email: user.email });
          }
        }
        break;
      }

      case 'PROJECT_MANAGER': {
        const project = await prisma.project.findUnique({
          where: { id: context.task.projectId },
          include: { owner: { select: { id: true, email: true } } },
        });
        if (project?.owner && !seen.has(project.owner.id)) {
          seen.add(project.owner.id);
          result.push({ userId: project.owner.id, email: project.owner.email });
        }
        break;
      }

      case 'CLIENT': {
        // Get the client contact email from the project's client
        const project = await prisma.project.findUnique({
          where: { id: context.task.projectId },
          include: {
            client: {
              include: { contacts: { take: 1 } },
            },
          },
        });
        if (project?.client?.email) {
          // Client doesn't have a user account, so we use the project owner as userId
          // and send email to the client contact
          const owner = await prisma.project.findUnique({
            where: { id: context.task.projectId },
            select: { ownerId: true },
          });
          if (owner && !seen.has(`client_${project.client.id}`)) {
            seen.add(`client_${project.client.id}`);
            // For clients, we only send emails (they don't have a user account)
            result.push({ userId: owner.ownerId, email: project.client.email });
          }
        }
        break;
      }

      case 'TEAM': {
        // Get all project members
        const members = await prisma.projectMember.findMany({
          where: { projectId: context.task.projectId },
          include: { user: { select: { id: true, email: true } } },
        });
        for (const member of members) {
          if (!seen.has(member.user.id)) {
            seen.add(member.user.id);
            result.push({ userId: member.user.id, email: member.user.email });
          }
        }

        // Also include team members from project teams
        const projectTeams = await prisma.projectTeam.findMany({
          where: { projectId: context.task.projectId },
          include: {
            team: {
              include: { members: { select: { id: true, email: true } } },
            },
          },
        });
        for (const pt of projectTeams) {
          for (const member of pt.team.members) {
            if (!seen.has(member.id)) {
              seen.add(member.id);
              result.push({ userId: member.id, email: member.email });
            }
          }
        }
        break;
      }
    }
  }

  return result;
}

function buildMessage(
  trigger: string,
  condition: Record<string, any>,
  context: WorkflowContext
): string {
  switch (trigger) {
    case 'TASK_STATUS_CHANGE':
      return `Task "${context.task.title}" moved to ${condition.toStatus || context.newStatus}`;
    case 'TASK_ASSIGNED':
      return `You were assigned to task "${context.task.title}"`;
    case 'TASK_DEADLINE_APPROACHING':
      return `Task "${context.task.title}" deadline is approaching`;
    default:
      return `Workflow triggered for task "${context.task.title}"`;
  }
}

function mapTriggerToNotificationType(trigger: string): any {
  switch (trigger) {
    case 'TASK_STATUS_CHANGE':
      return 'PROJECT_STATUS_CHANGED';
    case 'TASK_ASSIGNED':
      return 'TASK_ASSIGNED';
    case 'TASK_DEADLINE_APPROACHING':
      return 'DEADLINE_APPROACHING';
    default:
      return 'TASK_ASSIGNED';
  }
}
