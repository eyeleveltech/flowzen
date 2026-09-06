'use client';

/**
 * Editing a company's own record.
 *
 * Only the fields the brief calls genuinely editable are here. `status` and
 * `lostReason` are deliberately absent — §3's "status is derived, never
 * typed" applies to a general edit form exactly as much as it applies to a
 * pipeline board, even though the server would technically accept a status
 * override if sent. A company moves to Client by winning a proposal, not by
 * someone picking it from a dropdown here.
 */

import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { personOptions } from '@/lib/people';

const VERTICALS = [
  'HEALTHCARE', 'REAL_ESTATE', 'D2C', 'SPORTS', 'IT_AND_SAAS', 'RETAIL', 'B2B', 'HOSPITALITY',
] as const;
const SOURCES = ['OUTREACH', 'REFERRAL', 'INBOUND', 'PARTNER_AGENCY', 'NETWORK'] as const;

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Company = {
  id: string;
  name: string;
  vertical: string;
  source: string;
  city: string;
  website: string | null;
  gstin: string | null;
  billingAddress: string | null;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
};

type Props = {
  company: Company;
  onConfirm: () => void;
  onCancel: () => void;
};

export function EditCompanyModal({ company, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<{ value: string; label: string }[]>([]);

  const [name, setName] = useState(company.name ?? '');
  const [vertical, setVertical] = useState(company.vertical ?? 'B2B');
  const [source, setSource] = useState(company.source ?? 'OUTREACH');
  const [city, setCity] = useState(company.city ?? '');
  const [website, setWebsite] = useState(company.website ?? '');
  const [gstin, setGstin] = useState(company.gstin ?? '');
  const [billingAddress, setBillingAddress] = useState(company.billingAddress ?? '');
  const [ownerId, setOwnerId] = useState(company.ownerId ?? company.owner?.id ?? '');

  useEffect(() => {
    api.team
      .members()
      .then((res) => setMembers(personOptions(res.members)))
      .catch(() => {});
  }, []);

  const canSave = Boolean(name.trim()) && !busy;

  const handleSave = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.companies.update(company.id, {
        name: name.trim(),
        vertical,
        source,
        city: city.trim(),
        website: website.trim() || null,
        gstin: gstin.trim() || null,
        billingAddress: billingAddress.trim() || null,
        ...(ownerId ? { ownerId } : {}),
      } as never);
      toast.success('Company updated');
      onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update company');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="Edit company" size="lg" onClose={onCancel}>
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void handleSave();
        }}
      >
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field label="Company name" value={name} onChange={setName} disabled={busy} required />

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect
              label="Vertical"
              value={vertical}
              onChange={setVertical}
              options={VERTICALS.map((v) => ({ value: v, label: titleCase(v) }))}
              disabled={busy}
            />
            <FieldSelect
              label="Source"
              value={source}
              onChange={setSource}
              options={SOURCES.map((s) => ({ value: s, label: titleCase(s) }))}
              disabled={busy}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" value={city} onChange={setCity} disabled={busy} />
            <FieldSelect
              label="Account owner"
              value={ownerId}
              onChange={setOwnerId}
              options={members}
              disabled={busy}
            />
          </div>

          <Field
            label="Website"
            value={website}
            onChange={setWebsite}
            disabled={busy}
            placeholder="https://company.com"
          />

          <Field
            label="GSTIN"
            value={gstin}
            onChange={setGstin}
            disabled={busy}
            placeholder="e.g. 33AABCC1234F1Z5"
          />

          <Field
            label="Billing address"
            value={billingAddress}
            onChange={setBillingAddress}
            disabled={busy}
            textarea
            rows={2}
            placeholder="What appears on their proformas and invoices."
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
