'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores';
import { FolderKanban, TrendingUp } from 'lucide-react';

const MODULE_META: Record<string, { label: string; description: string; icon: any }> = {
  PM: { label: 'Project Management', description: 'Projects, tasks, calendar, team & reports.', icon: FolderKanban },
  CRM: { label: 'CRM', description: 'Sales pipeline & lead management (Admins only).', icon: TrendingUp },
};

export function ModulesTab({ modules, fetchModules }: { modules: { key: string; enabled: boolean }[]; fetchModules: () => void }) {
  const { setAuth } = useAuthStore();
  const [saving, setSaving] = useState<string | null>(null);

  const toggle = async (key: string, enabled: boolean) => {
    setSaving(key);
    try {
      await api.put(`/settings/modules/${key}`, { enabled });
      toast.success(`${MODULE_META[key]?.label || key} ${enabled ? 'enabled' : 'disabled'}`);
      fetchModules();
      // Refresh own session so the sidebar / picker reflect the change immediately.
      const fresh = await api.get('/auth/me');
      setAuth(fresh as any);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update module');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-primary">Modules</h2>
        <p className="text-sm text-secondary">Turn features on or off for your organization.</p>
      </div>

      <div className="space-y-3">
        {modules.map((m) => {
          const meta = MODULE_META[m.key] || { label: m.key, description: '', icon: FolderKanban };
          const Icon = meta.icon;
          return (
            <div key={m.key} className="flex items-center justify-between rounded-2xl border border-border bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3F4F6] text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-primary">{meta.label}</p>
                  <p className="text-xs text-secondary">{meta.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggle(m.key, !m.enabled)}
                disabled={saving === m.key}
                aria-pressed={m.enabled}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${m.enabled ? 'bg-primary' : 'bg-[#D1D5DB]'} disabled:opacity-50`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${m.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-secondary">
        Disabling a module hides it from everyone in your organization. Project Management is required for most teams.
      </p>
    </div>
  );
}
