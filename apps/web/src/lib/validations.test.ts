import { describe, it, expect } from 'vitest';
import { projectSchema } from './validations';

// projectSchema grew four more required fields (type, reportingCadence, clientApprovalRequired,
// tags) after these tests were written, so the fixtures below were failing on "Required" rather
// than on the thing each test actually checks. `base` keeps that from happening again: a new
// required field breaks it in ONE place instead of silently turning every case into a
// missing-field assertion.
const base = {
  name: 'New Project',
  type: 'RETAINER' as const,
  reportingCadence: 'MONTHLY' as const,
  clientApprovalRequired: false,
  tags: [],
  clientId: 'client-1',
  ownerId: 'owner-1',
  priority: 'HIGH' as const,
  status: 'PLANNING' as const,
  memberIds: [],
  teamIds: [],
};

describe('projectSchema', () => {
  it('should validate a correct project object', () => {
    const result = projectSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('should fail if name is missing', () => {
    const { name, ...withoutName } = base;
    const result = projectSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('name'))).toBe(true);
    }
  });

  it('should fail if owner is missing', () => {
    const result = projectSchema.safeParse({ ...base, ownerId: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'Owner is required')).toBe(true);
    }
  });

  it('should validate that endDate is not before startDate', () => {
    const result = projectSchema.safeParse({
      ...base,
      name: 'Time Travel Project',
      startDate: '2026-10-10',
      endDate: '2026-10-01',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'End date cannot be before start date')).toBe(true);
    }
  });

  it('should accept an endDate on the same day as startDate', () => {
    const result = projectSchema.safeParse({ ...base, startDate: '2026-10-10', endDate: '2026-10-10' });
    expect(result.success).toBe(true);
  });
});
