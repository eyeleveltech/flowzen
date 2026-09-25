/**
 * Who may read a piece of history, and what is left in it.
 *
 * These two rules were written inside `routes/activities.ts`, which was fine
 * while that route was the only way to read the trail. The company page reads
 * it too — its Activity tab is the history of a client, and a client's history
 * is mostly the history of its proposals, its projects and its invoices rather
 * than of the company row itself. A second reader with its own idea of who may
 * see what is how a gate ends up closed on one screen and open on the next, so
 * both read from here.
 */

import { hasPermission, type AuthRequest } from '../middleware/auth.js';
import type { PermissionKey } from '@flowzen/shared';

/**
 * The permission each entity's own screen requires.
 *
 * `undefined` means everybody — a Task's history is visible to anyone who can
 * reach the task, and task visibility is already narrowed elsewhere.
 *
 * Anything NOT in this map is refused rather than allowed. A new entity type
 * arriving with no entry should disappear from the feed until somebody decides
 * who may read it, which is the safe direction to fail.
 */
export const ACTIVITY_READ_PERMISSION: Record<string, PermissionKey | undefined> = {
  Company: 'company.read',
  // A cold lead's history is readable by whoever can read the outreach list
  // itself. Without an entry here the status trail would be written on every
  // change and then filtered out of the feed for everybody, because anything
  // absent from this map is refused rather than allowed.
  OutreachEntry: 'company.read',
  Proposal: 'pipeline.read',
  Proforma: 'pipeline.read',
  Project: 'work.all',
  MonthCard: 'work.all',
  Retainer: 'work.all',
  Task: undefined,
  Asset: undefined,
  Invoice: 'money.status',
  Cost: 'cost.enter',
  User: 'setup.admin',
  Organization: 'setup.admin',
};

export const canReadActivityType = (req: AuthRequest, entityType: string): boolean => {
  if (!(entityType in ACTIVITY_READ_PERMISSION)) return false;
  const needed = ACTIVITY_READ_PERMISSION[entityType];
  return needed === undefined || hasPermission(req.user!, needed);
};

/**
 * Figures, out of a payload, for somebody without `money.figures`.
 *
 * Matched on the KEY rather than on a list of verbs, because the leak was never
 * about a particular verb — it was about `amount` riding along inside whatever
 * happened to be logged. A new activity that puts a rupee value in its payload
 * is covered the day it is written rather than the day somebody notices.
 */
const MONEY_KEYS = new Set([
  'amount',
  'value',
  // What a quote was worth before it was revised — the same figure as `value`,
  // one version earlier, and just as much a rupee amount.
  'previousValue',
  'quotedValue',
  'estimatedCost',
  'monthlyValue',
  'monthlyCost',
  'paymentAmount',
  'totalPaid',
  'revenue',
  'purchasePrice',
  'disposalValue',
  'salvageValue',
  'bookValue',
  // The closing figure a delivered project stamps (projects.ts, brief §11.3
  // step 6). A HEAD carries work.all — enough to read a project's history —
  // and not money.figures, so without these the new profit feature would have
  // reopened a smaller version of the leak this file exists to close.
  'profit',
  'directCost',
  'peopleCost',
  'actualCost',
  'costVariance',
  'marginPercent',
  'costVariancePercent',
  'projectedCost',
  'projectedProfit',
]);

export const stripMoney = (payload: unknown): unknown => {
  // Walk INTO arrays rather than handing them back whole. The early return used
  // to cover `Array.isArray` too, so a figure one level inside a list — the
  // milestones on a project, the lines on an invoice — went out untouched while
  // the same key sitting directly on the object was removed. The promise this
  // function makes is that a new money key is covered the day it is written,
  // and that was only true for keys that never appeared inside a list.
  if (Array.isArray(payload)) return payload.map(stripMoney);
  if (!payload || typeof payload !== 'object') return payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (MONEY_KEYS.has(k)) continue;
    out[k] = v && typeof v === 'object' ? stripMoney(v) : v;
  }
  return out;
};
