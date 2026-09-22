'use client';

/**
 * Who a task is for, and who asked for it.
 *
 * ─── One field, four forms ──────────────────────────────────────────────────
 *
 * There are four places a task can be created — the work modal, the assign
 * modal, My Work's own, and the ⌘K panel — and they had three different
 * assignee controls between them: one multi-select, two single pickers, and
 * one that quietly assigned to whoever was typing. Same question, three
 * answers. This is the one control, so a rule added here cannot be missing
 * from a form somebody forgot about.
 *
 * ─── The rule it carries ────────────────────────────────────────────────────
 *
 * §9 separates two switches that look alike: `work.own` is "create my own
 * tasks", and `work.team` is "see and ASSIGN work for my people". So handing a
 * task to somebody else is a work.team act. Nothing enforced that — the API
 * took the list at face value and every form offered the whole roster — which
 * meant anybody signed in could drop work onto anybody else's My Work.
 *
 * The API refuses it now. This makes the screen agree: someone who may only
 * manage their own work sees their own name and no picker, rather than a list
 * that turns out to be a trap.
 */

import { useMemo } from 'react';
import { useConfig, useTeamMembers } from '@/hooks/queries';
import { MultiSelect } from '@/components/ui/multi-select';
import { FieldSelect } from '@/components/ui/field';
import { personOptions } from '@/lib/people';

/** Whether this person may put work on anybody else's plate. */
export function useMayAssignOthers(): { may: boolean; myUserId: string | null } {
  const { data: config } = useConfig();
  const permissions = config?.me?.permissions ?? [];
  return {
    may: permissions.includes('work.team') || permissions.includes('work.all'),
    myUserId: config?.me?.userId ?? null,
  };
}

export function AssigneeField({
  value,
  onChange,
  disabled,
  label = 'Assign to',
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const team = useTeamMembers();
  const { may, myUserId } = useMayAssignOthers();

  const myName = useMemo(
    () => team.find((m) => m.id === myUserId)?.name ?? 'you',
    [team, myUserId],
  );

  if (!may) {
    /*
     * No picker at all, rather than a picker that refuses.
     *
     * A disabled control listing fourteen names still says "you could choose
     * one of these", and the refusal only arrives on save. Showing the one
     * real answer is both shorter and honest.
     */
    return (
      <div>
        <span className="eyebrow mb-1.25 block">{label}</span>
        <div className="w-full rounded-xl border border-border bg-subtle/40 px-4 py-2.5 text-sm font-medium text-primary">
          {myName}
        </div>
        <p className="mt-1 text-micro text-secondary">
          Your own tasks are yours to make. Putting work on somebody else&apos;s list is a head&apos;s to do.
        </p>
      </div>
    );
  }

  return (
    <div>
      <span className="eyebrow mb-1.25 block">{label}</span>
      {/* One box, however many people. The first is the lead — the one the
          load and the overload alerts resolve to — so the order is not
          decoration. */}
      <MultiSelect
        compact={false}
        showSelectAll={false}
        value={value}
        onChange={onChange}
        ariaLabel={label}
        placeholder="Defaults to you"
        options={personOptions(team)}
      />
      {value.length > 1 && (
        <p className="mt-1 text-micro text-secondary">The first is the lead. It counts on all of their desks.</p>
      )}
    </div>
  );
}

/**
 * Who asked for the work — not always who is typing it up.
 *
 * A manager writing out what a Head asked for in a meeting had no way to say
 * so, and the task landed attributed to them. Naming somebody else is itself a
 * work.team act, though: an employee recording their manager as the requester
 * would be writing down a conversation nobody can check, so for them the field
 * is simply not there.
 */
export function AssignedByField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const team = useTeamMembers();
  const { may } = useMayAssignOthers();

  if (!may) return null;

  return (
    <FieldSelect
      label="Assigned by"
      value={value}
      onChange={onChange}
      placeholder="Nobody in particular"
      options={personOptions(team)}
      disabled={disabled}
    />
  );
}
