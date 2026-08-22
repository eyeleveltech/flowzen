import { describe, it, expect } from 'vitest';
import {
  validateStageEntry,
  validateStageMove,
  validateStageRemoval,
  validatePipelineShape,
  isRotting,
  type StageShape,
  type DealCandidate,
} from './stageRules.js';

const stage = (over: Partial<StageShape> = {}): StageShape => ({
  id: 's1',
  name: 'Proposal',
  kind: 'OPEN',
  requiresForecast: false,
  ...over,
});

const deal = (over: Partial<DealCandidate> = {}): DealCandidate => ({
  value: null,
  expectedCloseDate: null,
  contractType: null,
  lostReasonId: null,
  ...over,
});

const fields = (r: ReturnType<typeof validateStageEntry>) =>
  r.ok ? [] : r.errors.map((e) => e.field);

describe('validateStageEntry', () => {
  it('lets a deal into an ordinary stage with nothing filled in', () => {
    expect(validateStageEntry(stage(), deal()).ok).toBe(true);
  });

  describe('a stage that requires a forecast', () => {
    const negotiation = stage({ name: 'Negotiation', requiresForecast: true });

    it('needs both a value and a close date', () => {
      expect(fields(validateStageEntry(negotiation, deal()))).toEqual([
        'value',
        'expectedCloseDate',
      ]);
    });

    it('reports BOTH at once rather than one per attempt', () => {
      const r = validateStageEntry(negotiation, deal());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toHaveLength(2);
    });

    it('passes once both are present', () => {
      expect(
        validateStageEntry(
          negotiation,
          deal({ value: 40000, expectedCloseDate: new Date('2026-09-01') }),
        ).ok,
      ).toBe(true);
    });

    it('treats a zero value as present — free work is still a forecast', () => {
      expect(
        fields(validateStageEntry(negotiation, deal({ value: 0, expectedCloseDate: new Date() }))),
      ).toEqual([]);
    });

    it('names the stage in the message, so a rename stays readable', () => {
      const renamed = stage({ name: 'Commercials', requiresForecast: true });
      const r = validateStageEntry(renamed, deal());
      if (!r.ok) expect(r.errors[0].message).toContain('Commercials');
    });
  });

  describe('winning', () => {
    const won = stage({ name: 'Won', kind: 'WON' });

    // The check the old system did not have: a ONE_TIME deal was dropped into a
    // column that meant retainer, and a 5,00,000 project billed monthly forever.
    it('refuses to win without a contract type', () => {
      expect(
        fields(validateStageEntry(won, deal({ engagementStartDate: new Date('2026-04-01') }))),
      ).toContain('contractType');
    });

    it('refuses to win without a start date — it is when billing begins', () => {
      expect(fields(validateStageEntry(won, deal({ contractType: 'RETAINER' })))).toContain(
        'engagementStartDate',
      );
    });

    it('allows a retainer with NO end date — that means rolling', () => {
      expect(
        validateStageEntry(
          won,
          deal({ contractType: 'RETAINER', engagementStartDate: new Date('2026-04-01') }),
        ).ok,
      ).toBe(true);
    });

    it('requires an end date on a project — there the absence is missing data', () => {
      expect(
        fields(
          validateStageEntry(
            won,
            deal({ contractType: 'PROJECT', engagementStartDate: new Date('2026-04-01') }),
          ),
        ),
      ).toContain('engagementEndDate');
    });

    it('accepts a project with both dates', () => {
      expect(
        validateStageEntry(
          won,
          deal({
            contractType: 'PROJECT',
            engagementStartDate: new Date('2026-04-01'),
            engagementEndDate: new Date('2026-08-01'),
          }),
        ).ok,
      ).toBe(true);
    });

    it('rejects an end date before the start', () => {
      expect(
        fields(
          validateStageEntry(
            won,
            deal({
              contractType: 'PROJECT',
              engagementStartDate: new Date('2026-08-01'),
              engagementEndDate: new Date('2026-04-01'),
            }),
          ),
        ),
      ).toContain('engagementEndDate');
    });

    it('also applies the forecast rule when the won stage carries it', () => {
      const wonStrict = stage({ name: 'Won', kind: 'WON', requiresForecast: true });
      expect(
        fields(
          validateStageEntry(
            wonStrict,
            deal({ contractType: 'RETAINER', engagementStartDate: new Date() }),
          ),
        ),
      ).toEqual(['value', 'expectedCloseDate']);
    });
  });

  describe('losing', () => {
    const lost = stage({ name: 'Lost', kind: 'LOST' });

    it('needs a reason', () => {
      expect(fields(validateStageEntry(lost, deal()))).toEqual(['lostReasonId']);
    });

    it('passes with one', () => {
      expect(validateStageEntry(lost, deal({ lostReasonId: 'lr1' })).ok).toBe(true);
    });

    it('does not demand a contract type — only winning creates billing', () => {
      expect(fields(validateStageEntry(lost, deal({ lostReasonId: 'lr1' })))).toEqual([]);
    });
  });
});

describe('validateStageMove', () => {
  const open1 = stage({ id: 'a', name: 'Meeting' });
  const open2 = stage({ id: 'b', name: 'Proposal' });
  const won = stage({ id: 'w', name: 'Won', kind: 'WON' });
  const lost = stage({ id: 'l', name: 'Lost', kind: 'LOST' });

  it('allows moving forward', () => {
    expect(validateStageMove(open1, open2).ok).toBe(true);
  });

  // Real deals stall and come back. Forcing a strict order teaches people to move
  // cards dishonestly so the board looks tidy.
  it('allows moving BACKWARDS', () => {
    expect(validateStageMove(open2, open1).ok).toBe(true);
  });

  it('allows skipping stages', () => {
    expect(validateStageMove(open1, won).ok).toBe(true);
  });

  it('allows a first placement with no previous stage', () => {
    expect(validateStageMove(null, open1).ok).toBe(true);
  });

  it('refuses to reopen a lost deal', () => {
    const r = validateStageMove(lost, open1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/cannot be reopened/i);
  });

  it('permits a lost deal to stay lost — changing the reason is not reopening', () => {
    expect(validateStageMove(lost, stage({ id: 'l2', kind: 'LOST' })).ok).toBe(true);
  });

  it('allows a WON deal to be corrected back — a misclick is not a lie', () => {
    expect(validateStageMove(won, open2).ok).toBe(true);
  });

  it('rejects a move to the stage it is already in', () => {
    expect(validateStageMove(open1, open1).ok).toBe(false);
  });
});

describe('validateStageRemoval', () => {
  it('refuses to remove the won stage', () => {
    expect(validateStageRemoval(stage({ name: 'Won', kind: 'WON' }), 0).ok).toBe(false);
  });

  it('refuses to remove the lost stage', () => {
    expect(validateStageRemoval(stage({ name: 'Lost', kind: 'LOST' }), 0).ok).toBe(false);
  });

  it('blocks removal while deals are in it, rather than cascading', () => {
    const r = validateStageRemoval(stage(), 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('4 deals');
  });

  it('reads naturally for a single deal', () => {
    const r = validateStageRemoval(stage(), 1);
    if (!r.ok) expect(r.errors[0].message).toContain('1 deal.');
  });

  it('allows removing an empty open stage', () => {
    expect(validateStageRemoval(stage(), 0).ok).toBe(true);
  });
});

describe('isRotting', () => {
  it('is true past the threshold', () => {
    expect(isRotting({ kind: 'OPEN', rottingDays: 7 }, 8)).toBe(true);
  });

  it('is false exactly on it — the day it hits is not yet late', () => {
    expect(isRotting({ kind: 'OPEN', rottingDays: 7 }, 7)).toBe(false);
  });

  it('never flags a closed deal — it is finished, not neglected', () => {
    expect(isRotting({ kind: 'WON', rottingDays: 7 }, 400)).toBe(false);
    expect(isRotting({ kind: 'LOST', rottingDays: 7 }, 400)).toBe(false);
  });

  it('is off when no threshold is set', () => {
    expect(isRotting({ kind: 'OPEN', rottingDays: null }, 999)).toBe(false);
    expect(isRotting({ kind: 'OPEN', rottingDays: 0 }, 999)).toBe(false);
  });
});

describe('validatePipelineShape', () => {
  const seeded = [
    stage({ id: '1', name: 'New Lead' }),
    stage({ id: '2', name: 'Proposal' }),
    stage({ id: '3', name: 'Won', kind: 'WON' }),
    stage({ id: '4', name: 'Lost', kind: 'LOST' }),
  ];

  it('accepts the seeded shape', () => {
    expect(validatePipelineShape(seeded).ok).toBe(true);
  });

  it('rejects two won stages', () => {
    expect(validatePipelineShape([...seeded, stage({ id: '5', kind: 'WON' })]).ok).toBe(false);
  });

  it('rejects a pipeline with no lost stage', () => {
    expect(validatePipelineShape(seeded.filter((s) => s.kind !== 'LOST')).ok).toBe(false);
  });

  // The failure this design exists to prevent: add "Onboarding" after Won and won
  // deals never leave the board.
  it('rejects an open stage placed after the closing stages', () => {
    const r = validatePipelineShape([...seeded, stage({ id: '5', name: 'Onboarding' })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('Onboarding');
  });

  it('ignores archived stages when counting', () => {
    const withArchived = [
      ...seeded,
      { ...stage({ id: '6', name: 'Old Won', kind: 'WON' }), archivedAt: new Date() },
    ];
    expect(validatePipelineShape(withArchived).ok).toBe(true);
  });
});
