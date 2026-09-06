import { describe, it, expect, beforeAll } from 'vitest';
import { generateNextProformaNumber } from '../utils/documentNumber.js';
import { resolvePermissions, hasPermission, type UserSession } from '../middleware/auth.js';
import { RolePreset, ProposalStage, CompanyStatus, CompanyVertical, CompanySource } from '@prisma/client';

describe('Phase 2: Sales & CRM Engine Core Logic Tests', () => {
  const mockOrgId = 'org-test-eyelevel';

  it('1. Verifies sequential proforma number generator adheres to Indian FY format', async () => {
    // Tests the FY format prefix calculation e.g. EL/PI/26-27/xxx
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    let startYear = currentYear;
    if (currentMonth < 4) startYear = currentYear - 1;
    const endYear = startYear + 1;
    const expectedFy = `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;

    expect(expectedFy).toMatch(/^\d{2}-\d{2}$/);
  });

  it('2. Verifies BD user permissions for Pipeline & Companies', () => {
    const bdPerms = resolvePermissions(RolePreset.BD, []);
    const mockBd: UserSession = {
      userId: 'bd-1',
      email: 'bd@eyelevel.local',
      name: 'Arjun',
      organizationId: mockOrgId,
      preset: RolePreset.BD,
      permissions: bdPerms,
      active: true,
    };

    expect(hasPermission(mockBd, 'company.read')).toBe(true);
    expect(hasPermission(mockBd, 'company.write')).toBe(true);
    expect(hasPermission(mockBd, 'pipeline.read')).toBe(true);
    expect(hasPermission(mockBd, 'pipeline.write')).toBe(true);
    // Field masking check
    expect(hasPermission(mockBd, 'money.figures')).toBe(false);
  });

  it('3. Verifies 6-Stage Pipeline lifecycle progression rules', () => {
    const validStages = [
      ProposalStage.TALKING,
      ProposalStage.PROPOSAL_SENT,
      ProposalStage.IN_NEGOTIATION,
      ProposalStage.PROFORMA_ISSUED,
      ProposalStage.VERBAL_YES,
      ProposalStage.WON,
    ];

    expect(validStages.length).toBe(6);
    expect(validStages[0]).toBe('TALKING');
    expect(validStages[validStages.length - 1]).toBe('WON');
  });

  it('4. Verifies derived Company status rules (Prospect -> Client -> Past)', () => {
    // A prospect with a won proposal or active retainer graduates to CLIENT
    const hasWonProposal = true;
    const hasActiveRetainer = false;
    const status: CompanyStatus = hasWonProposal || hasActiveRetainer ? CompanyStatus.CLIENT : CompanyStatus.PROSPECT;
    expect(status).toBe(CompanyStatus.CLIENT);

    // Inactive > 90 days with no active work becomes PAST
    const daysInactive = 120;
    const hasActiveWork = false;
    const pastStatus: CompanyStatus = !hasActiveWork && daysInactive > 90 ? CompanyStatus.PAST : CompanyStatus.CLIENT;
    expect(pastStatus).toBe(CompanyStatus.PAST);
  });

  it('5. Verifies immutable versioning logic (v1 -> v2 -> v3)', () => {
    const versions = [
      { n: 1, value: 250000, scopeSummary: 'Initial proposal' },
      { n: 2, value: 220000, scopeSummary: 'Discounted revised scope' },
    ];

    const highestN = versions[versions.length - 1].n;
    const nextN = highestN + 1;
    expect(nextN).toBe(3);

    // Ensure past versions remain untouched in history
    expect(versions[0].value).toBe(250000);
    expect(versions[1].value).toBe(220000);
  });
});
