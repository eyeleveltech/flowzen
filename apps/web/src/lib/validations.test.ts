import { describe, it, expect } from 'vitest';
import { projectSchema } from './validations';

describe('projectSchema', () => {
  it('should validate a correct project object', () => {
    const validData = {
      name: 'New Project',
      clientId: 'client-1',
      ownerId: 'owner-1',
      priority: 'HIGH',
      status: 'PLANNING',
      memberIds: [],
      teamIds: [],
    };
    
    const result = projectSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('should fail if name is missing', () => {
    const invalidData = {
      clientId: 'client-1',
      ownerId: 'owner-1',
      priority: 'HIGH',
      status: 'PLANNING',
    };
    
    const result = projectSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name');
    }
  });

  it('should validate that endDate is not before startDate', () => {
    const invalidDates = {
      name: 'Time Travel Project',
      clientId: 'client-1',
      ownerId: 'owner-1',
      priority: 'HIGH',
      status: 'PLANNING',
      startDate: '2026-10-10',
      endDate: '2026-10-01', // Before start date
    };
    
    const result = projectSchema.safeParse(invalidDates);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("End date cannot be before start date");
    }
  });
});
