'use client';

/**
 * Settings → Approvals: who signs off work, and how a stuck one is chased.
 *
 * One list for all work. It was a row per task type — seven lists to keep in
 * step when the same three people approve everything, which is how the studio
 * actually works. Saving writes this list onto every type, so nothing that
 * reads approvers per type had to change.
 *
 * Any ONE approver is enough, and nobody approves their own task. "Escalate
 * to" is optional: whoever is listed is brought in when nobody has answered by
 * the escalation time. Somebody who is already an approver gets that anyway.
 *
 * Above them, the org's two timings. Admins edit; everybody else reads.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTeamMembers } from '@/hooks/queries';
import { personOptions } from '@/lib/people';
import { TASK_TYPE_OPTIONS, taskTypeLabel } from '@/lib/task-type';
import { useApprovalSettings } from '@/lib/approvals';
import { qk } from '@/hooks/queries';

/** 120 → "2h", 90 → "1h 30m", 15 → "15m". */
const minutesLabel = (total: number) => {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

/** The server's rule, said before the round trip. Null when fine. */
const timingsProblem = (remind: number, escalate: number): string | null => {
  if (remind < 15 || remind > 1440) return 'Remind after has to be between 15 minutes and 1 day.';
  if (escalate <= remind) return 'Escalate after has to be later than the reminder.';
  if (escalate > 2880) return 'Escalate after can be at most 2 days.';
  return null;
};

export function ApprovalsTab({ canEdit }: { canEdit: boolean }) {
  const { data, isPending } = useApprovalSettings();
  const team = useTeamMembers();
  const options = personOptions(team);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Chasing a stuck approval"
        description="Counted in working time only — the office's hours, days and holidays. Each happens once per round."
        bodyClassName=""
      >
        {isPending || !data ? (
          <div className="h-20 animate-pulse rounded-lg bg-subtle" aria-busy="true" />
        ) : (
          <Timings remind={data.remindMinutes} escalate={data.escalateMinutes} canEdit={canEdit} />
        )}
      </SectionCard>

      <SectionCard
        title="Who approves"
        description="The same people approve all work. Any one of them is enough, and nobody approves their own task."
        bodyClassName=""
      >
        {isPending || !data ? (
          <div className="h-24 animate-pulse rounded-lg bg-subtle" aria-busy="true" />
        ) : (
          <AllWork approvers={data.approvers} escalation={data.escalation} options={options} canEdit={canEdit} />
        )}
      </SectionCard>
    </div>
  );
}

// ── The two timings ─────────────────────────────────────────────────────────

const HOUR_OPTIONS = Array.from({ length: 49 }, (_, h) => ({ value: String(h), label: `${h} h` }));
const MINUTE_OPTIONS = [0, 15, 30, 45].map((m) => ({ value: String(m), label: `${m} min` }));

function Timings({ remind, escalate, canEdit }: { remind: number; escalate: number; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState({ remind, escalate });
  const [saving, setSaving] = useState(false);
  // Follow the server when it changes underneath (a save, a refetch).
  useEffect(() => setPicked({ remind, escalate }), [remind, escalate]);

  const changed = picked.remind !== remind || picked.escalate !== escalate;
  const problem = timingsProblem(picked.remind, picked.escalate);

  const save = async () => {
    setSaving(true);
    try {
      await api.config.saveApprovalTimings(picked.remind, picked.escalate);
      toast.success('Approval timings saved');
      void queryClient.invalidateQueries({ queryKey: ['approvers'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the timings');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <p className="text-sm text-body">
        Approvers are reminded after <span className="font-semibold text-primary">{minutesLabel(remind)}</span> with no
        answer, and it escalates after <span className="font-semibold text-primary">{minutesLabel(escalate)}</span>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <DurationPicker
          label="Remind after"
          hint="Bell and email to the approvers."
          value={picked.remind}
          onChange={(v) => setPicked((p) => ({ ...p, remind: v }))}
        />
        <DurationPicker
          label="Escalate after"
          hint="Bell and email to the approvers and the escalation people."
          value={picked.escalate}
          onChange={(v) => setPicked((p) => ({ ...p, escalate: v }))}
        />
      </div>
      {changed && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {problem && <p className="text-sm text-danger sm:mr-auto">{problem}</p>}
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={Boolean(problem)}
            onClick={() => void save()}
            className="w-full sm:w-auto"
          >
            Save timings
          </Button>
        </div>
      )}
    </div>
  );
}

function DurationPicker({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (minutes: number) => void;
}) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  // A value saved in steps other than 15 still shows, rather than going blank.
  const minuteOptions = MINUTE_OPTIONS.some((o) => Number(o.value) === minutes)
    ? MINUTE_OPTIONS
    : [...MINUTE_OPTIONS, { value: String(minutes), label: `${minutes} min` }];
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-semibold text-primary">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <Select
          ariaLabel={`${label}, hours`}
          value={String(hours)}
          onChange={(h) => onChange(Number(h) * 60 + minutes)}
          options={HOUR_OPTIONS}
        />
        <Select
          ariaLabel={`${label}, minutes`}
          value={String(minutes)}
          onChange={(m) => onChange(hours * 60 + Number(m))}
          options={minuteOptions}
        />
      </div>
      <p className="mt-1 text-micro text-secondary">{hint}</p>
    </div>
  );
}

// ── One list for all work ───────────────────────────────────────────────────

type PeopleByType = Record<string, { id: string; name: string }[]>;

/** Everybody on any type's list, by name — what the one list starts from. */
const everyone = (byType: PeopleByType) => {
  const map = new Map<string, { id: string; name: string }>();
  for (const list of Object.values(byType)) for (const p of list) map.set(p.id, p);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/** Whether every type carries the same list — false while it was set per type. */
const sameOnEveryType = (byType: PeopleByType) => {
  const keys = TASK_TYPE_OPTIONS.map((t) =>
    (byType[t.value] ?? [])
      .map((p) => p.id)
      .sort()
      .join(','),
  );
  return keys.every((k) => k === keys[0]);
};

const idsKey = (ids: string[]) => [...ids].sort().join(',');

function AllWork({
  approvers,
  escalation,
  options,
  canEdit,
}: {
  approvers: PeopleByType;
  escalation: PeopleByType;
  options: { value: string; label: string }[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const current = everyone(approvers);
  const currentEscalation = everyone(escalation);
  const approversKey = idsKey(current.map((p) => p.id));
  const escalationKey = idsKey(currentEscalation.map((p) => p.id));
  // Set per type before this was one list: say so, and say what saving does.
  const uneven = !sameOnEveryType(approvers) || !sameOnEveryType(escalation);

  const [picked, setPicked] = useState<string[]>(current.map((p) => p.id));
  const [pickedEscalation, setPickedEscalation] = useState<string[]>(currentEscalation.map((p) => p.id));
  const [saving, setSaving] = useState(false);
  // Follow the server when it changes underneath (a save, a refetch).
  useEffect(() => setPicked(approversKey ? approversKey.split(',') : []), [approversKey]);
  useEffect(() => setPickedEscalation(escalationKey ? escalationKey.split(',') : []), [escalationKey]);

  const changed = idsKey(picked) !== approversKey || idsKey(pickedEscalation) !== escalationKey || uneven;
  // Somebody in both lists gets every alert as an approver already.
  const alsoApprover = pickedEscalation.filter((id) => picked.includes(id));

  const save = async () => {
    setSaving(true);
    try {
      await api.config.saveAllApprovers(picked, pickedEscalation);
      toast.success('Approvers saved for all work');
      void queryClient.invalidateQueries({ queryKey: ['approvers'] });
      // Somebody's own "approver for" / "escalates to" list may have just changed.
      void queryClient.invalidateQueries({ queryKey: qk.config });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the approvers');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="grid gap-2 text-sm text-body sm:grid-cols-2">
        <p>
          <span className="text-secondary">Approvers: </span>
          {current.length > 0 ? current.map((p) => p.name).join(', ') : 'Nobody — approval is off'}
        </p>
        <p>
          <span className="text-secondary">Escalate to: </span>
          {currentEscalation.length > 0 ? currentEscalation.map((p) => p.name).join(', ') : 'Nobody'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {uneven && (
        <p className="rounded-lg border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-ink">
          These were set per type of work before (
          {TASK_TYPE_OPTIONS.filter((t) => (approvers[t.value] ?? []).length > 0)
            .map((t) => `${taskTypeLabel(t.value)}: ${(approvers[t.value] ?? []).map((p) => p.name).join(', ')}`)
            .join(' · ') || 'none set'}
          ). Saving puts this one list on all work.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1.5 text-sm font-semibold text-primary">Approvers for all work</p>
          <MultiSelect
            ariaLabel="Approvers for all work"
            value={picked}
            onChange={setPicked}
            options={options}
            placeholder="Nobody"
            showSelectAll={false}
            compact={false}
          />
          <p className="mt-1 text-micro text-secondary">
            {picked.length === 0
              ? 'Nobody — "Needs approval" cannot be ticked on any task.'
              : 'Reminded after the reminder time; any one of them can approve.'}
          </p>
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 text-sm font-semibold text-primary">Escalate to</p>
          <MultiSelect
            ariaLabel="Escalate to"
            value={pickedEscalation}
            onChange={setPickedEscalation}
            options={options}
            placeholder="Nobody"
            showSelectAll={false}
            compact={false}
          />
          <p className="mt-1 text-micro text-secondary">
            {alsoApprover.length > 0
              ? `${options
                  .filter((o) => alsoApprover.includes(o.value))
                  .map((o) => o.label)
                  .join(', ')} ${alsoApprover.length === 1 ? 'is' : 'are'} already an approver, so ${
                  alsoApprover.length === 1 ? 'gets' : 'get'
                } every alert anyway.`
              : 'Optional. Brought in, and able to decide, once nobody has answered by the escalation time.'}
          </p>
        </div>
      </div>
      {changed && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()} className="w-full sm:w-auto">
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
