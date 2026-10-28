import { TaskType } from '@prisma/client';

/** The same names the web's task-type picker shows. */
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  DESIGN: 'Design',
  VIDEO: 'Video',
  DIGITAL_MARKETING: 'Digital Marketing',
  DEVELOPMENT: 'Development',
  BUSINESS_DEVELOPMENT: 'Business Development',
  ACCOUNTS: 'Accounts',
  MANAGEMENT: 'Management',
  OTHER: 'Other',
};
