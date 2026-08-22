import { describe, it, expect } from 'vitest';
import { deriveCompanyStatus, statusMeaning, type EngagementSummary } from './companyStatus.js';

const eng = (over: Partial<EngagementSummary> = {}): EngagementSummary => ({
  status: 'ACTIVE',
  type: 'RETAINER',
  endedAt: null,
  endDate: null,
  ...over,
});

describe('deriveCompanyStatus', () => {
  it('is PROSPECT with no engagements — they have never bought anything', () => {
    expect(deriveCompanyStatus([])).toBe('PROSPECT');
  });

  it('is ACTIVE while anything is running', () => {
    expect(deriveCompanyStatus([eng()])).toBe('ACTIVE');
  });

  it('is ACTIVE when one engagement runs and another has ended', () => {
    expect(
      deriveCompanyStatus([
        eng({ status: 'ENDED', type: 'PROJECT', endedAt: new Date('2026-01-01') }),
        eng({ status: 'ACTIVE' }),
      ]),
    ).toBe('ACTIVE');
  });

  it('is ACTIVE when one is paused and another still runs', () => {
    expect(deriveCompanyStatus([eng({ status: 'PAUSED' }), eng({ status: 'ACTIVE' })])).toBe('ACTIVE');
  });

  it('is ONHOLD only when everything is paused', () => {
    expect(deriveCompanyStatus([eng({ status: 'PAUSED' }), eng({ status: 'PAUSED' })])).toBe('ONHOLD');
  });

  it('prefers ONHOLD over churn when a paused one sits alongside an ended one', () => {
    expect(
      deriveCompanyStatus([
        eng({ status: 'ENDED', endedAt: new Date('2026-01-01') }),
        eng({ status: 'PAUSED' }),
      ]),
    ).toBe('ONHOLD');
  });

  // The distinction the whole status enum exists for.
  describe('when everything has ended', () => {
    it('is CHURNED after a retainer stops — recurring revenue was lost', () => {
      expect(
        deriveCompanyStatus([eng({ status: 'ENDED', type: 'RETAINER', endedAt: new Date('2026-06-01') })]),
      ).toBe('CHURNED');
    });

    it('is PROJECT_COMPLETED after a project finishes — that is success, not loss', () => {
      expect(
        deriveCompanyStatus([eng({ status: 'ENDED', type: 'PROJECT', endedAt: new Date('2026-06-01') })]),
      ).toBe('PROJECT_COMPLETED');
    });

    it('reads from whichever ended LAST', () => {
      const churnedThenDelivered: EngagementSummary[] = [
        eng({ status: 'ENDED', type: 'RETAINER', endedAt: new Date('2026-01-01') }),
        eng({ status: 'ENDED', type: 'PROJECT', endedAt: new Date('2026-06-01') }),
      ];
      expect(deriveCompanyStatus(churnedThenDelivered)).toBe('PROJECT_COMPLETED');

      const deliveredThenChurned: EngagementSummary[] = [
        eng({ status: 'ENDED', type: 'PROJECT', endedAt: new Date('2026-01-01') }),
        eng({ status: 'ENDED', type: 'RETAINER', endedAt: new Date('2026-06-01') }),
      ];
      expect(deriveCompanyStatus(deliveredThenChurned)).toBe('CHURNED');
    });

    it('falls back to the agreed end date when nothing recorded the real one', () => {
      expect(
        deriveCompanyStatus([
          eng({ status: 'ENDED', type: 'RETAINER', endDate: new Date('2026-01-01') }),
          eng({ status: 'ENDED', type: 'PROJECT', endDate: new Date('2026-06-01') }),
        ]),
      ).toBe('PROJECT_COMPLETED');
    });

    it('prefers when it ACTUALLY ended over when it was meant to', () => {
      // The retainer was meant to run to December but stopped in February. The
      // project finished in June, so it ended last in reality.
      expect(
        deriveCompanyStatus([
          eng({
            status: 'ENDED',
            type: 'RETAINER',
            endDate: new Date('2026-12-01'),
            endedAt: new Date('2026-02-01'),
          }),
          eng({ status: 'ENDED', type: 'PROJECT', endedAt: new Date('2026-06-01') }),
        ]),
      ).toBe('PROJECT_COMPLETED');
    });

    it('does not let a record with no dates decide the answer', () => {
      expect(
        deriveCompanyStatus([
          eng({ status: 'ENDED', type: 'PROJECT', endedAt: null, endDate: null }),
          eng({ status: 'ENDED', type: 'RETAINER', endedAt: new Date('2026-06-01') }),
        ]),
      ).toBe('CHURNED');
    });
  });

  // Twenty websites a year must not read as twenty churned clients.
  it('never reports churn for an agency that only does projects', () => {
    const twentyProjects = Array.from({ length: 20 }, (_, i) =>
      eng({ status: 'ENDED', type: 'PROJECT', endedAt: new Date(2026, i % 12, 1) }),
    );
    expect(deriveCompanyStatus(twentyProjects)).toBe('PROJECT_COMPLETED');
  });
});

describe('statusMeaning', () => {
  it('gives every status a different next action — otherwise it is decoration', () => {
    const actions = (['PROSPECT', 'ACTIVE', 'ONHOLD', 'PROJECT_COMPLETED', 'CHURNED'] as const).map(
      (s) => statusMeaning(s).nextAction,
    );
    expect(new Set(actions).size).toBe(5);
  });

  it('sends you back to a finished-project client rather than filing them away', () => {
    expect(statusMeaning('PROJECT_COMPLETED').nextAction).toMatch(/check in/i);
    expect(statusMeaning('CHURNED').nextAction).toMatch(/went wrong/i);
  });
});
