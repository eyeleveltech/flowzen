/**
 * Reading a query as a verb plus a subject.
 *
 * The parsing is where this goes wrong quietly: too eager and typing a client's
 * name flickers into action mode as you go, too strict and nobody finds the
 * actions at all.
 */

import { describe, it, expect } from 'vitest';
import { ROLE_PRESET_PERMISSIONS, type RolePreset } from '@flowzen/shared';
import { ACTIONS, readCommand, availableActions, activityTypeFor } from './actions';

/** A person, described the way every auth response describes them. */
const as = (preset: RolePreset) => ROLE_PRESET_PERMISSIONS[preset];

describe('readCommand', () => {
  it('reads a verb and the rest as the subject', () => {
    const cmd = readCommand('call suvai', as('MANAGEMENT'));
    expect(cmd?.action.id).toBe('log');
    expect(cmd?.term).toBe('suvai');
  });

  it('keeps a multi-word subject whole', () => {
    expect(readCommand('call nova fintech', as('MANAGEMENT'))?.term).toBe('nova fintech');
  });

  it('accepts the words people actually use for the same thing', () => {
    for (const word of ['call', 'log', 'note', 'meeting', 'spoke', 'email']) {
      expect(readCommand(`${word} acme`, as('MANAGEMENT'))?.action.id).toBe('log');
    }
  });

  it('matches a prefix, so it fires before the word is finished', () => {
    // The typed word is a prefix OF THE ALIAS, not the other way round — see
    // the whole-first-word test below for why that direction matters.
    expect(readCommand('cal acme', as('MANAGEMENT'))?.action.id).toBe('log');
    expect(readCommand('fol acme', as('MANAGEMENT'))?.action.id).toBe('followUp');
  });

  it('needs three letters, so a stray "p" is not a command', () => {
    // Otherwise the first keystroke of every search would flip the palette into
    // action mode and back out again.
    expect(readCommand('p acme', as('MANAGEMENT'))).toBeNull();
    expect(readCommand('pa acme', as('MANAGEMENT'))).toBeNull();
  });

  it('matches the whole first word, never a prefix of the query', () => {
    // "paint" starts with "pa" but is not "pay". Reading the query as a prefix
    // would turn a search for Paint Studio into a payment.
    expect(readCommand('paint studio', as('MANAGEMENT'))).toBeNull();
    expect(readCommand('taskforce ltd', as('MANAGEMENT'))).toBeNull();
  });

  it('is not a command when the first word is just a name', () => {
    expect(readCommand('suvai', as('MANAGEMENT'))).toBeNull();
    expect(readCommand('september social calendar', as('MANAGEMENT'))).toBeNull();
  });

  it('allows a verb with nothing after it yet', () => {
    const cmd = readCommand('call', as('MANAGEMENT'));
    expect(cmd?.action.id).toBe('log');
    expect(cmd?.term).toBe('');
  });

  it('ignores case and stray spacing', () => {
    expect(readCommand('  CALL   Suvai  ', as('MANAGEMENT'))?.term).toBe('Suvai');
  });
});

describe('who may do what', () => {
  it('offers only verbs the palette can actually carry out', () => {
    // "pay" was a fifth verb here, gated to Admin, pointing at a payment flow
    // the palette never had. A verb that cannot be performed is worse than no
    // verb: it is a door that opens onto nothing.
    expect(ACTIONS.map((a) => a.id).sort()).toEqual(['done', 'followUp', 'log', 'task']);
  });

  it('hides setting a follow-up from somebody who cannot edit a company', () => {
    // The verb writes a follow-up date through PATCH /companies/:id, which
    // asks for company.write. An Employee does not have it; BD does.
    expect(readCommand('follow acme', as('EMPLOYEE'))).toBeNull();
    expect(readCommand('follow acme', as('BD'))?.action.id).toBe('followUp');
  });

  it('is not a ladder — a Head outranks BD and still cannot set a follow-up', () => {
    // Exactly the mismatch this replaced: HEAD scored above SALES on the old
    // scale, so the palette offered a verb the server then refused.
    expect(readCommand('follow acme', as('HEAD'))).toBeNull();
  });

  it('lets everybody log a call and finish their own work', () => {
    expect(readCommand('call acme', as('EMPLOYEE'))?.action.id).toBe('log');
    expect(readCommand('done draft', as('EMPLOYEE'))?.action.id).toBe('done');
  });

  it('offers nothing at all to a caller with no permissions', () => {
    expect(availableActions(undefined)).toHaveLength(0);
    expect(availableActions([])).toHaveLength(0);
    expect(readCommand('call acme', undefined)).toBeNull();
  });

  it('offers every verb to somebody holding every switch', () => {
    expect(availableActions(as('EMPLOYEE')).length).toBeLessThan(
      availableActions(as('MANAGEMENT')).length,
    );
    // Counted from the list rather than written down, so adding a verb does not
    // silently leave this assertion describing the old set.
    expect(availableActions(as('MANAGEMENT'))).toHaveLength(ACTIONS.length);
  });

  it('honours setup.admin as the master switch, exactly as the server does', () => {
    expect(availableActions(['setup.admin'])).toHaveLength(ACTIONS.length);
  });
});

describe('the verb decides the kind of contact', () => {
  it('reports which alias matched, not only which action', () => {
    expect(readCommand('meeting acme', as('MANAGEMENT'))?.alias).toBe('meeting');
    expect(readCommand('email acme', as('MANAGEMENT'))?.alias).toBe('email');
  });

  it('maps the specific words to their own kind', () => {
    expect(activityTypeFor('meeting')).toBe('MEETING');
    expect(activityTypeFor('met')).toBe('MEETING');
    expect(activityTypeFor('email')).toBe('EMAIL');
    expect(activityTypeFor('whatsapp')).toBe('WHATSAPP');
    expect(activityTypeFor('note')).toBe('NOTE');
  });

  it('falls back to a call for the vague ones', () => {
    // "log acme" says nothing about how — a call is the honest default, and the
    // dialog still lets it be changed.
    expect(activityTypeFor('log')).toBe('CALL');
    expect(activityTypeFor('call')).toBe('CALL');
    expect(activityTypeFor('spoke')).toBe('CALL');
  });

  it('survives a word it has never seen', () => {
    expect(activityTypeFor('')).toBe('CALL');
    expect(activityTypeFor('nonsense')).toBe('CALL');
  });
});
