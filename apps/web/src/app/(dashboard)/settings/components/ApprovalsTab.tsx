'use client';

/**
 * Settings → Approvals: who signs off each type of work, and how a stuck one
 * is chased.
 *
 * One row per task type, each with the people who can approve it. Any ONE of
 * them is enough. A task can only be marked "Needs approval" when its type has
 * at least one approver, so an empty row is also the answer to "why can't I
 * tick that box".
 *
 * Beside the approvers, who it escalates to (Akmal for Video). Above them, the
 * org's two timings: after "Remind after" working time with no answer the
 * approvers get a bell alert and an email; after "Escalate after" the
 * escalation people do too, and can decide it themselves.
 *
 * Only Video is expected to be set up at first, but every type works the same.
 * Admins edit; everybody else reads.
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
import { TASK_TYPE_OPTIONS } from '@/lib/task-type';
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
        title="Approvals"
        description="Who can approve each type of work. Any one of them is enough, and nobody approves their own task."
        bodyClassName=""
      >
        {isPending ? (
          <div className="space-y-2" aria-busy="true">
            {TASK_TYPE_OPTIONS.map((t) => (
              <div key={t.value} className="h-12 animate-pulse rounded-lg bg-subtle" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {TASK_TYPE_OPTIONS.map((type) => (
              <TypeRow
                key={type.value}
                type={type}
                approvers={data?.approvers[type.value] ?? []}
                escalation={data?.escalation[type.value] ?? []}
                options={options}
                canEdit={canEdit}
              />
            ))}
          </ul>
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

// ── One row per task type ───────────────────────────────────────────────────

const idsKey = (people: { id: string }[]) =>
  people
    .map((p) => p.id)
    .sort()
    .join(',');
const sameIds = (a: string[], key: string) => [...a].sort().join(',') === key;

function TypeRow({
  type,
  approvers,
  escalation,
  options,
  canEdit,
}: {
  type: { value: string; label: string };
  approvers: { id: string; name: string }[];
  escalation: { id: string; name: string }[];
  options: { value: string; label: string }[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const approversKey = idsKey(approvers);
  const escalationKey = idsKey(escalation);
  const [picked, setPicked] = useState<string[]>(approvers.map((p) => p.id));
  const [pickedEscalation, setPickedEscalation] = useState<string[]>(escalation.map((p) => p.id));
  const [saving, setSaving] = useState(false);
  // Follow the server when it changes underneath (a save, a refetch).
  useEffect(() => {
    setPicked(approversKey ? approversKey.split(',') : []);
  }, [approversKey]);
  useEffect(() => {
    setPickedEscalation(escalationKey ? escalationKey.split(',') : []);
  }, [escalationKey]);

  const changed = !sameIds(picked, approversKey) || !sameIds(pickedEscalation, escalationKey);

  const save = async () => {
    setSaving(true);
    try {
      await api.config.saveApprovers(type.value, picked, pickedEscalation);
      toast.success(`${type.label} approvals saved`);
      void queryClient.invalidateQueries({ queryKey: ['approvers'] });
      // Somebody's own "approver for" / "escalates to" list may have just changed.
      void queryClient.invalidateQueries({ queryKey: qk.config });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the approvers');
    } finally {
      setSaving(false);
    }
  };

  const summary =
    approvers.length === 0
      ? 'No approvers — approval is off for this type'
      : [
          `${approvers.length} approver${approvers.length === 1 ? '' : 's'}`,
          escalation.length > 0 ? `escalates to ${escalation.map((p) => p.name.split(' ')[0]).join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <li className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 lg:flex-row lg:items-start lg:gap-4">
      <div className="lg:w-48 lg:shrink-0 lg:pt-6">
        <p className="text-sm font-semibold text-primary">{type.label}</p>
        <p className="text-micro text-secondary">{summary}</p>
      </div>
      {canEdit ? (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="eyebrow mb-1">Approvers</p>
              <MultiSelect
                ariaLabel={`${type.label} approvers`}
                value={picked}
                onChange={setPicked}
                options={options}
                placeholder="Nobody"
                showSelectAll={false}
                compact={false}
              />
            </div>
            <div className="min-w-0">
              <p className="eyebrow mb-1">Escalate to</p>
              <MultiSelect
                ariaLabel={`${type.label} escalate to`}
                value={pickedEscalation}
                onChange={setPickedEscalation}
                options={options}
                placeholder="Nobody"
                showSelectAll={false}
                compact={false}
              />
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
      ) : (
        <div className="grid min-w-0 flex-1 gap-1 text-sm text-body sm:grid-cols-2 lg:pt-6">
          <p>
            <span className="text-secondary">Approvers: </span>
            {approvers.length > 0 ? approvers.map((p) => p.name).join(', ') : 'Nobody'}
          </p>
          <p>
            <span className="text-secondary">Escalate to: </span>
            {escalation.length > 0 ? escalation.map((p) => p.name).join(', ') : 'Nobody'}
          </p>
        </div>
      )}
    </li>
  );
}
