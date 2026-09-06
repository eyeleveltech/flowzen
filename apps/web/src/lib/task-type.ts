/**
 * What kind of work a task is.
 *
 * The same names the team is split into rather than a second vocabulary: a
 * studio that already says "that's a Design job" does not need a different
 * word for it, and it means the type reads against `User.dept` — "how much of
 * Design's month went to Video work" is one group-by rather than a mapping
 * table somebody has to keep up to date.
 *
 * Mirrors the `TaskType` enum in the schema. Adding one means adding it there.
 */
export const TASK_TYPE_OPTIONS = [
  { value: 'DESIGN', label: 'Design' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'DIGITAL_MARKETING', label: 'Digital Marketing' },
  { value: 'DEVELOPMENT', label: 'Development' },
  { value: 'BUSINESS_DEVELOPMENT', label: 'Business Development' },
  { value: 'ACCOUNTS', label: 'Accounts' },
  { value: 'MANAGEMENT', label: 'Management' },
];

/** Null for an unset type, so a caller can decide whether to show the row at all. */
export const taskTypeLabel = (v?: string | null): string | null =>
  TASK_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? null;
