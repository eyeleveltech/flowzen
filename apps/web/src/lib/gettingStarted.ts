import type { GettingStartedStep } from '@/lib/api-v2';

/**
 * The Getting started steps in words (Ease Plan 2) — the card on My Work and
 * the tooltip on Settings → Usage read the same names.
 */
export const GETTING_STARTED_LABEL: Record<GettingStartedStep, string> = {
  phone: 'Check your details (phone number)',
  phoneApp: 'Get Flowzen on your phone and turn on notifications',
  firstTask: 'Add your first task',
  finishTask: 'Finish a task',
  howItWorks: 'Read How it works',
  google: 'Connect your Google Calendar',
};

/** "Not yet: phone number, phone app" — for the Usage tooltip. */
export const SHORT_LABEL: Record<GettingStartedStep, string> = {
  phone: 'phone number',
  phoneApp: 'phone app and notifications',
  firstTask: 'first task',
  finishTask: 'finished a task',
  howItWorks: 'How it works',
  google: 'Google Calendar',
};

export function missingStepsText(missing: GettingStartedStep[]): string {
  return missing.length === 0 ? 'Every step done' : `Not yet: ${missing.map((k) => SHORT_LABEL[k]).join(', ')}`;
}
