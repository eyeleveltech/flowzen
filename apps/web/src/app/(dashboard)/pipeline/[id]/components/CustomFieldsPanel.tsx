'use client';

import { useState } from 'react';
import { api, ApiError, type OrgConfig } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type FieldValue = {
  fieldId: string;
  key: string;
  label: string;
  type: string;
  value: unknown;
};

type Props = {
  dealId: string;
  fieldValues: FieldValue[];
  config: OrgConfig;
  canEdit: boolean;
  onChanged: () => void;
};

export function CustomFieldsPanel({ dealId, fieldValues, canEdit, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const acc: Record<string, unknown> = {};
    for (const f of fieldValues) acc[f.fieldId] = f.value ?? '';
    return acc;
  });

  if (fieldValues.length === 0) {
    return null;
  }

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deals.update(dealId, { customFields: values });
      setEditing(false);
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Could not save custom fields');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none">
      <CardHeader>
        <CardTitle>Additional Details</CardTitle>
        {canEdit && !editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {error && (
          <div className="mb-4">
            <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {fieldValues.map((f) => {
            if (editing) {
              return (
                <Field
                  key={f.fieldId}
                  label={f.label}
                  value={String(values[f.fieldId] ?? '')}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.fieldId]: v }))}
                  disabled={busy}
                />
              );
            }
            return (
              <div key={f.fieldId}>
                <p className="text-xs text-secondary">{f.label}</p>
                <p className="text-sm font-medium text-primary">
                  {f.value !== null && f.value !== undefined && f.value !== '' ? String(f.value) : '—'}
                </p>
              </div>
            );
          })}
        </div>

        {editing && (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={busy}>
              Save
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
