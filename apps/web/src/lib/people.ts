import { getInitials, getAvatarColor } from '@/lib/utils';

/**
 * How a person is written down, in one place.
 *
 * ─── Three different questions ──────────────────────────────────────────────
 *
 *   name         who they are             "Vikram"
 *   designation  what they are called     "Developer"
 *   dept         which team they sit in   "Development"
 *   preset       what the app lets them do EMPLOYEE
 *
 * All four used to arrive as two: the job title was folded into `name` —
 * "Vikram (Developer)", "Janani (Head, Design)" — on thirteen of fourteen
 * people, while `designation`, which exists for exactly this and is editable
 * from /profile, sat empty. So a screen that wanted a name got a name and a
 * title it could not separate, and a screen that wanted the title had nothing
 * to read.
 *
 * ─── The system role is not a job title ─────────────────────────────────────
 *
 * `preset` is an access level. A Head is a Head because the app shows them
 * their team's work, not because "Head" is printed on anybody's card, and the
 * two genuinely come apart: Priya's designation is "Accounts Desk" and her
 * preset is ACCOUNTS, but Harish's designation is "Developer" and his preset
 * is MANAGEMENT. Labelling them the same way would suggest one follows the
 * other.
 *
 * The two label maps that existed before this — one in `shared/constants` and
 * one written again inside the profile page — listed SUPER_ADMIN, ADMIN,
 * PROJECT_MANAGER, TEAM_MEMBER and MANAGER, SALES, MEMBER. Not one of those is
 * a value of the `RolePreset` enum, so both fell through to a title-casing
 * fallback and had never labelled anything.
 */

const PRESET_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  HEAD: 'Head',
  BD: 'Business Dev',
  ACCOUNTS: 'Accounts',
  MANAGEMENT: 'Management',
};

/** The access level, in words. Falls back to title case for a preset added later. */
export function presetLabel(preset?: string | null): string {
  if (!preset) return '—';
  return PRESET_LABEL[preset] ?? preset.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A person on one line — "Vikram · Developer" — for somewhere too tight to
 * stack them. Returns just the name when no designation is set, rather than a
 * trailing separator pointing at nothing.
 */
export function personLine(person?: { name: string; designation?: string | null } | null): string {
  if (!person) return 'Unassigned';
  return person.designation ? `${person.name} · ${person.designation}` : person.name;
}

export type PickablePerson = {
  id: string;
  name: string;
  designation?: string | null;
  dept?: string | null;
};

/**
 * A person, as a `Select` or `MultiSelect` option.
 *
 * Written once because thirteen pickers had thirteen answers: `name`, `name
 * (dept)`, `name · dept`, and one — the asset issue modal — that already used
 * the `sublabel` field both components support and nothing else had touched.
 * So the same dropdown looked different depending on which screen opened it,
 * and a list of bare first names ("Akmal", "Charles", "Naif") gave no way to
 * tell who does what.
 *
 * `image` and `avatar` are the same thing under two names — `MultiSelect`
 * predates `Select` and each named the field for itself. Both are set here so
 * a caller does not have to know which component it is feeding.
 */
export function personOption(p: PickablePerson) {
  return {
    value: p.id,
    label: p.name,
    // Designation first: it is what they are called. Department is the
    // fallback for somebody who has not set one.
    sublabel: p.designation || p.dept || undefined,
    avatar: getInitials(p.name),
    image: getInitials(p.name),
    colorClass: getAvatarColor(p.name),
  };
}

export const personOptions = (people: PickablePerson[]) => people.map(personOption);
