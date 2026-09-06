'use client';

/**
 * Creating a proposal (brief §11.1 step 6) — the step that's been missing
 * end to end: the backend has taken `POST /proposals` since it was built, but
 * nothing in the UI ever called it, so a proposal could only exist if someone
 * put it there directly in the database.
 *
 * When `companyId` is passed in (opened from a company record) the company is
 * fixed and shown as plain text. Opened from the Proposals list with no
 * company in context, a picker appears instead — same create call either way.
 */

import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { personOptions } from '@/lib/people';

type Props = {
  companyId?: string;
  companyName?: string;
  onConfirm: (proposal: { id: string }) => void;
  onCancel: () => void;
};

export function NewProposalModal({ companyId, companyName, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId ?? '');
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);

  const [kind, setKind] = useState<'RETAINER' | 'PROJECT'>('RETAINER');
  const [initialValue, setInitialValue] = useState('');
  const [scopeSummary, setScopeSummary] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [ownerId, setOwnerId] = useState('');

  useEffect(() => {
    if (!companyId) {
      void api.companies.list().then((res) => setCompanies(res.companies)).catch(() => {});
    }
    void api.team.members().then((res) => setTeam(res.members)).catch(() => {});
  }, [companyId]);

  const parsedValue = Number(initialValue);
  // Value and scope are both optional — a proposal can be logged before
  // there's a real number or a written scope yet. Company still can't be
  // skipped: a proposal has no meaning without one (§5, "one spine").
  const canSave =
    Boolean(selectedCompanyId) &&
    Number.isFinite(parsedValue) &&
    parsedValue >= 0 &&
    !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.proposals.create({
        companyId: selectedCompanyId,
        kind,
        initialValue: parsedValue,
        scopeSummary: scopeSummary.trim(),
        fileUrl: fileUrl.trim() || undefined,
        ownerId: ownerId || undefined,
      });
      const created = (res as { proposal?: { id: string } }).proposal;
      toast.success('Proposal created — v1 is live');
      if (created?.id) onConfirm(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the proposal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="New proposal" description="Version 1. The stage becomes Proposal sent." onClose={onCancel} size="md">
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void handleSave();
        }}
      >
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          {companyId ? (
            <div>
              <span className="block text-sm font-medium text-body mb-1.5">Company</span>
              <div className="w-full rounded-xl border border-border bg-subtle/40 px-4 py-2.5 text-sm text-primary font-medium">
                {companyName}
              </div>
            </div>
          ) : (
            <FieldSelect
              label="Company"
              value={selectedCompanyId}
              onChange={setSelectedCompanyId}
              required
              placeholder="Choose a company…"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}

          <FieldSelect
            label="Kind"
            value={kind}
            onChange={(v) => setKind(v as 'RETAINER' | 'PROJECT')}
            required
            options={[
              { value: 'RETAINER', label: 'Retainer — ongoing monthly work' },
              { value: 'PROJECT', label: 'Project — one time, start and end' },
            ]}
          />

          <Field
            label="Value (₹)"
            value={initialValue}
            onChange={setInitialValue}
            type="number"
            disabled={busy}
            hint={`Optional — leave blank for not yet quoted. ${kind === 'RETAINER' ? 'Monthly value.' : 'Total quoted value for the job.'}`}
          />

          <Field
            label="Scope summary"
            value={scopeSummary}
            onChange={setScopeSummary}
            disabled={busy}
            textarea
            rows={3}
            placeholder="Optional — what this version covers."
          />

          <Field
            label="Proposal document URL"
            value={fileUrl}
            onChange={setFileUrl}
            disabled={busy}
            placeholder="Optional — link to the PDF/deck sent to the client"
          />

          <FieldSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            placeholder="Defaults to you"
            options={personOptions(team)}
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Create proposal
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
