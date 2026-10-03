'use client';

/**
 * Settings → Integrations: whether people may connect their Google Calendar,
 * and whether they may turn on phone notifications.
 *
 * Each is offered only when the server has its keys (the tab is hidden when it
 * has neither).
 *
 * Google off: the Profile button disappears and nothing syncs; the connections
 * people already made are kept, and pick up again when it is switched back on.
 *
 * Phone notifications off: nothing is sent and the Profile card is hidden.
 * Devices people turned on are kept, so switching it back on needs nothing
 * from anybody.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { Toggle } from '@/components/ui/toggle';
import { qk } from '@/hooks/queries';

export function IntegrationsTab({
  googleConfigured,
  enabled,
  pushConfigured,
  pushEnabled,
  canEdit,
  onChanged,
}: {
  googleConfigured: boolean;
  enabled: boolean;
  pushConfigured: boolean;
  pushEnabled: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      {googleConfigured && <GoogleSwitch enabled={enabled} canEdit={canEdit} onChanged={onChanged} />}
      {pushConfigured && <PushSwitch enabled={pushEnabled} canEdit={canEdit} onChanged={onChanged} />}
    </div>
  );
}

function GoogleSwitch({ enabled, canEdit, onChanged }: { enabled: boolean; canEdit: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [on, setOn] = useState(enabled);
  const [saving, setSaving] = useState(false);

  const change = async (next: boolean) => {
    setOn(next);
    setSaving(true);
    try {
      await api.config.update({ googleCalendarEnabled: next });
      await queryClient.invalidateQueries({ queryKey: qk.config });
      void queryClient.invalidateQueries({ queryKey: ['google-status'] });
      toast.success(next ? 'Google Calendar connection on' : 'Google Calendar connection off');
      onChanged();
    } catch (e) {
      setOn(!next);
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Google Calendar connection"
      description={
        <>
          Lets each person connect their own company Google Calendar from their Profile. Flowzen then reads their
          busy time — everyone else sees only &ldquo;Busy&rdquo; — and writes the meetings and shoots they are on into
          a &ldquo;Flowzen&rdquo; calendar in their Google. It is optional for every person.
        </>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">{on ? 'On' : 'Off'}</p>
          <p className="text-xs text-secondary">
            {on
              ? 'People can connect from their Profile. Busy time syncs every 15 minutes.'
              : 'The Profile button is hidden and nothing syncs. Existing connections wait until it is back on.'}
          </p>
        </div>
        <Toggle
          checked={on}
          onChange={(v) => !saving && canEdit && void change(v)}
          label="Google Calendar connection"
          labelClassName="sr-only"
        />
      </div>
    </SectionCard>
  );
}

function PushSwitch({ enabled, canEdit, onChanged }: { enabled: boolean; canEdit: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [on, setOn] = useState(enabled);
  const [saving, setSaving] = useState(false);

  const change = async (next: boolean) => {
    setOn(next);
    setSaving(true);
    try {
      await api.config.update({ pushEnabled: next });
      await queryClient.invalidateQueries({ queryKey: qk.config });
      void queryClient.invalidateQueries({ queryKey: ['push-config'] });
      toast.success(next ? 'Phone notifications on' : 'Phone notifications off');
      onChanged();
    } catch (e) {
      setOn(!next);
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Phone notifications"
      description={
        <>
          Lets each person turn on notifications on their phone from their Profile — approvals, bookings and task
          changes, in working hours only. Android works in Chrome; an iPhone needs Flowzen added to its Home Screen.
          Lock-screen text never shows money figures.
        </>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">{on ? 'On' : 'Off'}</p>
          <p className="text-xs text-secondary">
            {on
              ? 'People can turn them on from their Profile, per device.'
              : 'Nothing is sent and the Profile card is hidden. Devices people turned on wait until it is back on.'}
          </p>
        </div>
        <Toggle
          checked={on}
          onChange={(v) => !saving && canEdit && void change(v)}
          label="Phone notifications"
          labelClassName="sr-only"
        />
      </div>
    </SectionCard>
  );
}
