import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { resolvePermissions, hasPermission, type UserSession } from '../middleware/auth.js';
import { RolePreset } from '@prisma/client';
import { ROLE_PRESET_PERMISSIONS } from '@flowzen/shared';

describe('Phase 1: RBAC Permissions & Authorization Gates', () => {
  it('1. Verifies Employee preset defaults to work.own only', () => {
    const employeePerms = resolvePermissions(RolePreset.EMPLOYEE, []);
    expect(employeePerms).toEqual(['work.own']);

    const mockEmployee: UserSession = {
      userId: 'emp-1',
      email: 'designer@eyelevel.local',
      name: 'Dilshad',
      organizationId: 'org-1',
      preset: RolePreset.EMPLOYEE,
      permissions: employeePerms,
      active: true,
    };

    expect(hasPermission(mockEmployee, 'work.own')).toBe(true);
    expect(hasPermission(mockEmployee, 'work.team')).toBe(false);
    expect(hasPermission(mockEmployee, 'pipeline.read')).toBe(false);
    expect(hasPermission(mockEmployee, 'money.figures')).toBe(false);
  });

  it('2. Verifies BD preset has pipeline access but never receives salary/costs figures', () => {
    const bdPerms = resolvePermissions(RolePreset.BD, []);
    expect(bdPerms).toContain('pipeline.read');
    expect(bdPerms).toContain('pipeline.write');
    expect(bdPerms).toContain('company.read');
    expect(bdPerms).toContain('company.write');
    expect(bdPerms).not.toContain('money.figures'); // BD must never see salary/costs

    const mockBd: UserSession = {
      userId: 'bd-1',
      email: 'bd@eyelevel.local',
      name: 'Arjun',
      organizationId: 'org-1',
      preset: RolePreset.BD,
      permissions: bdPerms,
      active: true,
    };

    expect(hasPermission(mockBd, 'pipeline.read')).toBe(true);
    expect(hasPermission(mockBd, 'pipeline.write')).toBe(true);
    expect(hasPermission(mockBd, 'money.figures')).toBe(false);
    expect(hasPermission(mockBd, 'setup.admin')).toBe(false);
  });

  it('3. Verifies Head preset has team & cost.enter permissions', () => {
    const headPerms = resolvePermissions(RolePreset.HEAD, []);
    expect(headPerms).toContain('work.own');
    expect(headPerms).toContain('work.team');
    expect(headPerms).toContain('work.all');
    expect(headPerms).toContain('money.status');
    expect(headPerms).toContain('cost.enter');

    const mockHead: UserSession = {
      userId: 'head-1',
      email: 'sneha@eyelevel.local',
      name: 'Sneha',
      organizationId: 'org-1',
      preset: RolePreset.HEAD,
      permissions: headPerms,
      active: true,
    };

    expect(hasPermission(mockHead, 'work.team')).toBe(true);
    expect(hasPermission(mockHead, 'cost.enter')).toBe(true);
    expect(hasPermission(mockHead, 'setup.admin')).toBe(false);
  });

  it('4. Verifies Management preset / setup.admin has universal bypass', () => {
    const mgmtPerms = resolvePermissions(RolePreset.MANAGEMENT, []);
    expect(mgmtPerms).toContain('setup.admin');
    expect(mgmtPerms).toContain('money.figures');

    const mockAdmin: UserSession = {
      userId: 'admin-1',
      email: 'admin@eyelevel.local',
      name: 'Akmal',
      organizationId: 'org-1',
      preset: RolePreset.MANAGEMENT,
      permissions: ['setup.admin'],
      active: true,
    };

    expect(hasPermission(mockAdmin, 'money.figures')).toBe(true);
    expect(hasPermission(mockAdmin, 'work.all')).toBe(true);
    expect(hasPermission(mockAdmin, 'company.write')).toBe(true);
    expect(hasPermission(mockAdmin, 'pipeline.write')).toBe(true);
  });

  it('5. Inactive users are always denied permission regardless of role', () => {
    const inactiveAdmin: UserSession = {
      userId: 'admin-old',
      email: 'ex-admin@eyelevel.local',
      name: 'Ex-Admin',
      organizationId: 'org-1',
      preset: RolePreset.MANAGEMENT,
      permissions: ['setup.admin', 'money.figures'],
      active: false,
    };

    expect(hasPermission(inactiveAdmin, 'setup.admin')).toBe(false);
    expect(hasPermission(inactiveAdmin, 'work.own')).toBe(false);
  });

  it('6. Verifies registration creates organization, admin user, and session token', async () => {
    const randomEmail = `test-${Date.now()}@flowzentest.local`;

    (prisma.user.findUnique as any).mockResolvedValue(null);
    (prisma.organization.create as any).mockResolvedValue({
      id: 'org-test-1',
      name: 'Acme Test Agency',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      proformaPrefix: 'EL/PI',
    });
    (prisma.user.create as any).mockResolvedValue({
      id: 'user-test-1',
      organizationId: 'org-test-1',
      name: 'Test Owner',
      email: randomEmail,
      dept: 'Management',
      preset: RolePreset.MANAGEMENT,
      permissions: ['setup.admin', 'money.figures'],
      active: true,
    });

    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Owner',
      email: randomEmail,
      password: 'StrongPassword123!',
      organizationName: 'Acme Test Agency',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(randomEmail);
    expect(res.body.user.preset).toBe('MANAGEMENT');
    expect(res.body.user.organization.name).toBe('Acme Test Agency');
  });
});
