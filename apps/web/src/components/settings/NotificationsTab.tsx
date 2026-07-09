'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import toast from 'react-hot-toast';

const STAGES = ['OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT'];

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-primary">{label}</p>
        <p className="text-xs text-secondary mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${checked ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

export function NotificationsTab() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const [prefs, setPrefs] = useState<any>({
    followUpDue: true,
    staleLead: true,
    dailyDigest: true,
    digestTime: '08:00',
    taskAssigned: true,
    taskDue24h: true,
    taskOverdue: true,
    taskComment: true
  });
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [crmEmail, setCrmEmail] = useState('');
  const [overloadThreshold, setOverloadThreshold] = useState<number>(25);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<any>('/settings/notification-preferences').then(setPrefs).catch(() => {});
    if (isAdmin) {
      api.get<any>('/settings/notification-thresholds').then((d) => {
        setThresholds(d.thresholds || {});
        setCrmEmail(d.crmNotificationEmail || '');
        setOverloadThreshold(d.overloadThreshold ?? 25);
      }).catch(() => {});
    }
  }, [isAdmin]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/settings/notification-preferences', prefs);
      if (isAdmin) {
        // Drop blank/invalid threshold fields so we never persist a 0-day threshold.
        const cleanThresholds = Object.fromEntries(Object.entries(thresholds).filter(([, v]) => Number.isFinite(v) && (v as number) >= 1));
        await api.patch('/settings/notification-thresholds', {
          thresholds: cleanThresholds,
          crmNotificationEmail: crmEmail,
          overloadThreshold
        });
      }
      toast.success('Notification settings saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold text-primary mb-1">Email Notification Preferences</h3>
        <p className="text-xs text-secondary mb-4">
          Configure which events trigger an email alert directly to your inbox. 
          In-app notification badges on your dashboard bell icon will continue to log all events.
        </p>
        <div className="divide-y divide-gray-100">
          <Toggle label="Follow-up due alerts" desc="Notify me when a lead's follow-up date arrives or is overdue." checked={prefs.followUpDue} onChange={(v) => setPrefs((p: any) => ({ ...p, followUpDue: v }))} />
          <Toggle label="Stale lead alerts" desc="Notify me when a lead has had no activity past its stage threshold." checked={prefs.staleLead} onChange={(v) => setPrefs((p: any) => ({ ...p, staleLead: v }))} />
          <Toggle label="Daily email digest" desc="A morning summary of follow-ups due, overdue, and stale leads." checked={prefs.dailyDigest} onChange={(v) => setPrefs((p: any) => ({ ...p, dailyDigest: v }))} />
          
          <div className="border-t border-gray-100 my-4 pt-4">
            <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Project Management Alerts</h4>
            <Toggle label="Task Assigned" desc="Email me when a new task is assigned to me." checked={prefs.taskAssigned !== false} onChange={(v) => setPrefs((p: any) => ({ ...p, taskAssigned: v }))} />
            <Toggle label="Task Due in 24 Hours" desc="Email me when a task assigned to me is due in 24 hours." checked={prefs.taskDue24h !== false} onChange={(v) => setPrefs((p: any) => ({ ...p, taskDue24h: v }))} />
            <Toggle label="Task Overdue Alerts" desc="Email me when a task assigned to me becomes overdue." checked={prefs.taskOverdue !== false} onChange={(v) => setPrefs((p: any) => ({ ...p, taskOverdue: v }))} />
            <Toggle label="Comments on my Tasks" desc="Email me when someone leaves a comment or mentions me on my task." checked={prefs.taskComment !== false} onChange={(v) => setPrefs((p: any) => ({ ...p, taskComment: v }))} />
          </div>
        </div>
      </div>

      {isAdmin && (
        <div>
          <h3 className="text-sm font-semibold text-primary mb-1">Business notification email</h3>
          <p className="text-xs text-secondary mb-2">One daily Sales &amp; CRM summary (follow-ups, stale leads, renewals, reactivations) is emailed here. Separate multiple addresses with commas.</p>
          <input
            type="text"
            value={crmEmail}
            onChange={(e) => setCrmEmail(e.target.value)}
            placeholder="founder@company.com, sales@company.com"
            className="w-full max-w-md rounded-xl border border-border bg-gray-50 px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-white"
          />
        </div>
      )}

      {isAdmin && (
        <div>
          <h3 className="text-sm font-semibold text-primary mb-1">Stale-lead thresholds <span className="font-normal text-secondary">(org-wide)</span></h3>
          <p className="text-xs text-secondary mb-3">Days of inactivity before a lead in each stage is flagged stale.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {STAGES.map((s) => (
              <div key={s}>
                <label className="block text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5">{s.replace(/_/g, ' ')}</label>
                <input type="number" min={1} value={thresholds[s] ?? ''} onChange={(e) => setThresholds((t) => ({ ...t, [s]: Number(e.target.value) }))} className="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-white" />
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="border-t border-gray-100 pt-6">
          <h3 className="text-sm font-semibold text-primary mb-1">Task Overload Threshold <span className="font-normal text-secondary">(org-wide)</span></h3>
          <p className="text-xs text-secondary mb-3">Maximum active (uncompleted) tasks a team member should hold before warning managers that they are overloaded.</p>
          <input
            type="number"
            min={1}
            value={overloadThreshold}
            onChange={(e) => setOverloadThreshold(Number(e.target.value))}
            className="w-full max-w-[150px] rounded-xl border border-border bg-gray-50 px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-white"
          />
        </div>
      )}

      <button onClick={save} disabled={saving} className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  );
}
