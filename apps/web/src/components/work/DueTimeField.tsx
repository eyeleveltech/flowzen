'use client';

/**
 * "Due time" on a task form: a list of times with am and pm, every 15 minutes.
 *
 * The browser's own time box showed 24-hour or 12-hour depending on the
 * computer, with nothing to say which, and on some there was no visible am/pm
 * at all. A list that says "5:30 pm" leaves no doubt. It opens at 9:00 am when
 * nothing is chosen, and its search box narrows it: type "5:30" and pick am or
 * pm. "No time" is the first option and the default.
 */

import { FieldSelect } from '@/components/ui/field';
import { dueTimeOptions } from '@/lib/due-time';

export function DueTimeField({
  value,
  onChange,
  label = 'Due time',
  hint = 'Optional — leave as No time for any time that day.',
  disabled,
}: {
  /** "17:30", or '' for none. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <FieldSelect
      label={label}
      value={value}
      onChange={onChange}
      options={dueTimeOptions(value)}
      placeholder="No time"
      hint={hint}
      disabled={disabled}
      scrollTo="09:00"
    />
  );
}
