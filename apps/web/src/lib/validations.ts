import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  description: z.string().optional(),
  type: z.enum(['RETAINER', 'ONE_TIME', 'EVENT', 'INTERNAL']),
  scope: z.string().optional(),
  reportingCadence: z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'NONE']),
  clientApprovalRequired: z.boolean(),
  tags: z.array(z.string()),
  projectNotes: z.string().optional(),
  folderLink: z.string().optional(),
  clientId: z.string().optional(),
  ownerId: z.string().min(1, 'Owner is required'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'ON_HOLD', 'CANCELLED']),

  memberIds: z.array(z.string()).optional(),
  teamIds: z.array(z.string()).optional(),
}).refine((data) => {
  if (data.startDate && data.endDate) {
    return new Date(data.endDate) >= new Date(data.startDate);
  }
  return true;
}, {
  message: "End date cannot be before start date",
  path: ["endDate"],
});

export type ProjectFormValues = z.infer<typeof projectSchema>;
