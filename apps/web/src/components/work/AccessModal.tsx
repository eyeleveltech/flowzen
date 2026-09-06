'use client';

/**
 * Editing one person's access and cost — the permission-matrix editor the
 * brief describes for Setup, built as a per-person drawer instead of one
 * giant grid: a preset is the starting point, and only the switches it
 * doesn't already grant are shown as togglable extras.
 *
 * The additive model is real, not simplified for this screen: resolvePermissions
 * unions the preset's defaults with this person's extra array, so there is no
 * way to revoke a preset-granted switch here short of moving them to a
 * smaller preset first — the disabled, checked rows say so.
 */

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { ROLE_PRESET_PERMISSIONS, type PermissionKey, type RolePreset } from '@flowzen/shared';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

const PRESET_OPTIONS = [
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'HEAD', label: 'Department head' },
  { value: 'BD', label: 'Business development' },
  { value: 'ACCOUNTS', label: 'Accounts' },
  { value: 'MANAGEMENT', label: 'Management' },
];

const PERMS: { key: PermissionKey; label: string; hint: string }[] = [
  { key: 'work.own', label: 'My Work', hint: 'See and complete work assigned to them' },
  { key: 'work.team', label: 'Team work', hint: "See and assign their people's work" },
  { key: 'work.all', label: 'All work', hint: 'See every retainer and project' },
  { key: 'company.read', label: 'Companies', hint: 'See companies, people and history' },
  { key: 'company.write', label: 'Edit companies', hint: 'Add and edit companies and people' },
  { key: 'pipeline.read', label: 'Pipeline and proposals', hint: 'See the stage board, proposals and proformas' },
  { key: 'pipeline.write', label: 'Create proposals', hint: 'Create proposals, versions and proformas' },
  { key: 'money.status', label: 'Money, status only', hint: 'See paid or unpaid, never an amount' },
  { key: 'money.figures', label: 'Money, figures', hint: 'See values, costs, margin and profit' },
  { key: 'cost.enter', label: 'Enter costs', hint: 'Record vendor bills and expenses' },
  { key: 'reports.read', label: 'Reports and brief', hint: 'Open management reports and the Monday brief' },
  { key: 'setup.admin', label: 'Setup', hint: 'People, salaries, access, templates, numbering' },
  // The escape hatch the asset register depends on. Only MANAGEMENT has this by
  // preset, which means every shoot checkout needs one of them to perform it —
  // the intended control. When gear starts leaving without being checked out
  // because nobody with the key was around, the fix is this switch on one
  // person, not a wider preset.
  { key: 'asset.manage', label: 'Issue equipment', hint: 'Enter kit, hand it over, check it back in, retire it' },
];

type Person = { id: string; name: string; dept?: string | null; preset?: string | null; permissions?: string[]; monthlyCost?: number | null };

export function AccessModal({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: () => void }) {
  const [preset, setPreset] = useState((person.preset as RolePreset) || 'EMPLOYEE');
  const [extra, setExtra] = useState<Set<PermissionKey>>(new Set((person.permissions ?? []) as PermissionKey[]));
  const [monthlyCost, setMonthlyCost] = useState(person.monthlyCost != null ? String(person.monthlyCost) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const granted = new Set(ROLE_PRESET_PERMISSIONS[preset] ?? []);

  const toggle = (key: PermissionKey) => {
    if (granted.has(key)) return;
    setExtra((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.users.update(person.id, {
        preset,
        permissions: Array.from(extra),
        monthlyCost: monthlyCost ? Number(monthlyCost) : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save access for this person');
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Access · ${person.name}`}>
      <ModalBody className="space-y-4">
        <div>
          <FieldSelect
            label="Preset"
            value={preset}
            onChange={(v) => setPreset(v as RolePreset)}
            required
            options={PRESET_OPTIONS}
          />
          <p className="mt-1 text-xs text-secondary">A starting point. Anything it doesn&apos;t grant can be added for this one person below.</p>
        </div>

        <Field label="Monthly cost (₹)" value={monthlyCost} onChange={setMonthlyCost} type="number" hint="Salary — visible only to Setup access." />

        <div className="space-y-1">
          {PERMS.map((p) => {
            const isGranted = granted.has(p.key);
            const isExtra = extra.has(p.key);
            const on = isGranted || isExtra;
            return (
              <label
                key={p.key}
                className={`flex items-start gap-3 rounded-xl border border-border p-3 ${isGranted ? 'bg-subtle/50' : 'cursor-pointer hover:bg-subtle/30'}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={isGranted}
                  onChange={() => toggle(p.key)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-body">
                    {p.label}
                    {isGranted && <span className="ml-1.5 text-xs font-normal text-secondary">from {preset.toLowerCase()}</span>}
                  </p>
                  <p className="text-xs text-secondary">{p.hint}</p>
                </div>
              </label>
            );
          })}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" loading={saving} onClick={() => void save()}>
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
