import { prisma } from '../lib/prisma.js';
import { emitToOrganization } from '../sse.js';

// Canonical activity event types (Activity.type is a free String column, so these are
// just the agreed vocabulary — no enum/migration needed). Module E "Activity Timeline".
export const ActivityType = {
  LEAD_CREATED: 'LEAD_CREATED',
  STAGE_CHANGED: 'STAGE_CHANGED',
  NOTE_ADDED: 'NOTE_ADDED',
  CALL_LOGGED: 'CALL_LOGGED',
  MEETING_LOGGED: 'MEETING_LOGGED',
  EMAIL_LOGGED: 'EMAIL_LOGGED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  INTELLIGENCE_RUN: 'INTELLIGENCE_RUN',
  TASK_CREATED: 'TASK_CREATED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  QUOTE_GENERATED: 'QUOTE_GENERATED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  CONTACT_ADDED: 'CONTACT_ADDED',
  ONBOARDING_ITEM_COMPLETED: 'ONBOARDING_ITEM_COMPLETED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  FOLLOW_UP_SET: 'FOLLOW_UP_SET',
  LEAD_UPDATED: 'LEAD_UPDATED',
} as const;
export type ActivityTypeKey = keyof typeof ActivityType;

// Category groupings for the timeline filter bar (All / Calls / Meetings / Messages / Payments / Notes / System).
export const ACTIVITY_CATEGORIES: Record<string, string[]> = {
  calls: [ActivityType.CALL_LOGGED],
  meetings: [ActivityType.MEETING_LOGGED],
  messages: [ActivityType.MESSAGE_SENT, ActivityType.EMAIL_LOGGED],
  payments: [ActivityType.PAYMENT_RECEIVED],
  notes: [ActivityType.NOTE_ADDED],
  system: [
    ActivityType.LEAD_CREATED, ActivityType.STAGE_CHANGED, ActivityType.STATUS_CHANGED,
    ActivityType.TASK_CREATED, ActivityType.TASK_COMPLETED, ActivityType.DOCUMENT_UPLOADED,
    ActivityType.QUOTE_GENERATED, ActivityType.INTELLIGENCE_RUN, ActivityType.CONTACT_ADDED,
    ActivityType.ONBOARDING_ITEM_COMPLETED, ActivityType.FOLLOW_UP_SET, ActivityType.LEAD_UPDATED,
  ],
};

interface LogActivityInput {
  leadId: string;          // Lead.id (cuid)
  type: string;            // one of ActivityType
  message: string;         // short verb phrase, rendered as "{user} {message}"
  userId: string;          // acting user (req.user.userId)
  body?: string | null;    // optional longer text (call/meeting notes, etc.)
  metadata?: Record<string, any>;
  io?: any;                // req.app.get('io') — to push a live timeline update
  orgId?: string;          // organization for the SSE broadcast
}

// Single entry point every module uses to write to the lead timeline.
export async function logActivity(input: LogActivityInput) {
  const metadata: Record<string, any> = { ...(input.metadata || {}) };
  if (input.body) metadata.body = input.body;

  const activity = await prisma.activity.create({
    data: {
      type: input.type,
      message: input.message,
      entityType: 'LEAD',
      entityId: input.leadId,
      userId: input.userId,
      leadId: input.leadId,
      metadata,
    },
    include: { user: { select: { name: true, avatar: true } } },
  });

  if (input.io && input.orgId) {
    emitToOrganization(input.io, input.orgId, 'activity:created', { leadId: input.leadId, activity });
  }
  return activity;
}
