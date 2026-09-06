'use client';

/**
 * What ⌘K can DO, as opposed to what it can find.
 *
 * ─── The problem ────────────────────────────────────────────────────────────
 *
 * The palette searched companies, deals, projects, tasks, quotations and
 * invoices — correctly, and role-aware — and then did exactly one thing with what
 * it found: `router.push(href)`. It was a fast way to ARRIVE somewhere. It was
 * not a way to do anything. For the most common action in the product — logging
 * that you spoke to a client — it got you to step 5 of 9.
 *
 * ─── The shape ──────────────────────────────────────────────────────────────
 *
 * A registry, not a switch statement buried in the component: a list of what can
 * be done, what kind of thing each one needs, and which role may do it. Adding an
 * action is adding a row.
 *
 * The query is read as a VERB followed by a subject — `"call suvai"` is the verb
 * `call` and the search term `suvai`. The verb has to come first, because that is
 * the order people say it and because a trailing verb cannot be told apart from a
 * client whose name happens to end in "call".
 *
 * ─── Who is offered what ────────────────────────────────────────────────────
 *
 * `needs` names the permission the verb's own request requires, so the palette
 * offers only what will actually go through. It is still a courtesy, never a
 * control — every one of these ends in an API call the server refuses on its
 * own terms, and a mistake in this file cannot let anybody do anything.
 *
 * It used to name a rung on the old MEMBER-to-SUPER_ADMIN ladder, which asked a
 * different question from the one the API asks. This file is the last thing
 * that spoke that vocabulary.
 */

import {
  CalendarClock,
  Check,
  MessageSquare,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@flowzen/shared';

/** The kinds of thing an action can be pointed at. */
export type SubjectKind = 'company' | 'deal' | 'project' | 'task';

export type Subject = {
  kind: SubjectKind;
  id: string;
  /** What to call it on screen. */
  name: string;
  /** The second line — the client, the stage, the amount outstanding. */
  context?: string;
};

export type CommandAction = {
  id: 'log' | 'task' | 'done' | 'followUp';
  /** The label, once a subject is chosen: "Log activity · Suvai Foods". */
  verb: string;
  /**
   * The words that select it.
   *
   * Generous on purpose — people type what they are doing ("call", "spoke"),
   * not what the software calls it. Matching is by prefix, so "cal" finds it.
   */
  aliases: string[];
  applies: SubjectKind[];
  /**
   * The permission the API asks for when this verb is carried out. Undefined
   * means everybody — logging a call is not gated on the server either.
   */
  needs?: PermissionKey;
  icon: LucideIcon;
  /** Shown when the verb is typed with nothing after it yet. */
  hint: string;
};

export const ACTIONS: CommandAction[] = [
  {
    id: 'log',
    verb: 'Log activity',
    // "call" first: it is the single most common thing anybody records.
    aliases: ['call', 'log', 'note', 'meeting', 'met', 'email', 'spoke', 'whatsapp'],
    applies: ['company', 'deal', 'project'],
    // POST /activities takes any signed-in person, so this verb does too.
    icon: MessageSquare,
    hint: 'Who did you speak to?',
  },
  {
    id: 'task',
    verb: 'New task',
    aliases: ['task', 'todo'],
    // A task belongs to a PROJECT. Offering it on a client would open a form
    // with nothing filled in, which is a navigation wearing a shortcut's costume.
    applies: ['project'],
    needs: 'work.own',
    icon: Plus,
    hint: 'On which project?',
  },
  {
    id: 'done',
    verb: 'Mark done',
    aliases: ['done', 'complete', 'finish'],
    applies: ['task'],
    needs: 'work.own',
    icon: Check,
    hint: 'Which task?',
  },
  {
    id: 'followUp',
    verb: 'Set follow-up',
    aliases: ['follow', 'followup', 'chase', 'remind'],
    // Setting a follow-up date is an edit to the company record.
    applies: ['company'],
    needs: 'company.write',
    icon: CalendarClock,
    hint: 'Come back to whom?',
  },
];

/**
 * Mirrors `canSee` in config/navigation.ts, and `hasPermission` on the server.
 *
 * These verbs used to be scored on the old role ladder — a different question
 * from the one the API asks, and the reason a Head was offered "follow", which
 * PATCH /companies/:id then refused. A verb that cannot be carried out is a
 * door onto nothing.
 */
const permitted = (action: CommandAction, permissions: readonly string[] | undefined) => {
  if (!permissions || permissions.length === 0) return false;
  if (!action.needs) return true;
  return permissions.includes(action.needs) || permissions.includes('setup.admin');
};

/**
 * Read a query as a verb plus what to do it to.
 *
 * Returns null when the first word is not a verb, which is the common case — the
 * palette then behaves exactly as it always has and finds things.
 *
 * The verb must be the WHOLE first word. Matching a prefix of the query instead
 * would make "paint" select "pay", and typing a client's name would keep
 * flickering into action mode as it was typed.
 */
export const readCommand = (
  query: string,
  permissions: readonly string[] | undefined,
): { action: CommandAction; term: string; alias: string } | null => {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const [head, ...rest] = trimmed.split(/\s+/);
  const word = head.toLowerCase();

  let alias = '';
  const action = ACTIONS.find((a) => {
    if (!permitted(a, permissions)) return false;
    const hit = a.aliases.find((candidate) => candidate.startsWith(word) && word.length >= 3);
    if (hit) alias = hit;
    return Boolean(hit);
  });
  if (!action) return null;

  return { action, term: rest.join(' '), alias };
};

/**
 * The kind of contact, taken from the word that was typed.
 *
 * "meeting acme" and "email acme" both log an activity, and they are not the
 * same activity. The dialog defaults to a call, which is right when somebody
 * types "log" and wrong when they were specific — and a timeline where every
 * entry says CALL is one nobody can read a negotiation out of.
 */
export const activityTypeFor = (alias: string): string => {
  if (alias === 'meeting' || alias === 'met') return 'MEETING';
  if (alias === 'email') return 'EMAIL';
  if (alias === 'whatsapp') return 'WHATSAPP';
  if (alias === 'note') return 'NOTE';
  return 'CALL';
};

/** Every verb somebody could type, for the empty-state hint. */
export const availableActions = (permissions: readonly string[] | undefined) =>
  ACTIONS.filter((a) => permitted(a, permissions));
