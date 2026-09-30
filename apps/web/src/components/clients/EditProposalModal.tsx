'use client';

/**
 * Correcting a proposal after it has been raised — all of it.
 *
 * This used to offer the owner and the kind, and send everything else to "Add
 * a version". That is still the way to RE-QUOTE: a revised price the client
 * sees is v(N+1), and both are kept. But there was no way to CORRECT one — a
 * figure typed with an extra zero, the wrong deck linked, a scope pasted from
 * another client — short of a new version that then counted the typo as a
 * discount given away in negotiation.
 *
 * So the figures here correct the version on the table in place: the winning
 * one if the deal is won, otherwise the latest. The activity log keeps what
 * each field said before.
 *
 * Two things stay fixed once they have consequences:
 *   · the kind, once won or lost — winning built a retainer or a project;
 *   · the company, once won or lost, or once a proforma has gone to it — the
 *     server says which when it refuses.
 */

import toast from 'react-hot-toast';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { personOptions } from '@/lib/people';

type Version = {
  id: string;
  n: number;
  value: number | string;
  scopeSummary: string;
  fileUrl: string | null;
  sentAt: string;
};

type Proposal = {
  id: string;
  kind: 'RETAINER' | 'PROJECT';
  outcome: 'WON' | 'LOST' | null;
  companyId?: string;
  owner?: { id: string; name: string } | null;
  ownerId?: string | null;
  /** Newest first, as the company page loads them. */
  versions?: Version[];
  wonVersion?: Version | null;
};

type Props = {
  proposal: Proposal;
  companyName: string;
  onSaved: () => void;
  onClose: () => void;
};

const dayOf = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '');

export function EditProposalModal({ proposal, companyName, onSaved, onClose }: Props) {
  const team = useTeamMembers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = proposal.outcome !== null;
  // The version these figures belong to: the one that won, or the one on the table.
  const version = proposal.wonVersion ?? proposal.versions?.[0] ?? null;

  const original = useMemo(
    () => ({
      ownerId: proposal.owner?.id ?? proposal.ownerId ?? '',
      kind: proposal.kind,
      companyId: proposal.companyId ?? '',
      value: version ? String(Number(version.value)) : '',
      scopeSummary: version?.scopeSummary ?? '',
      fileUrl: version?.fileUrl ?? '',
      sentAt: dayOf(version?.sentAt),
    }),
    [proposal, version],
  );

  const [ownerId, setOwnerId] = useState(original.ownerId);
  const [kind, setKind] = useState<'RETAINER' | 'PROJECT'>(original.kind);
  const [companyId, setCompanyId] = useState(original.companyId);
  const [value, setValue] = useState(original.value);
  const [scopeSummary, setScopeSummary] = useState(original.scopeSummary);
  const [fileUrl, setFileUrl] = useState(original.fileUrl);
  const [sentAt, setSentAt] = useState(original.sentAt);

  // Only an open deal can move, so only an open deal needs the list.
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (closed) return;
    void api.companies
      .list()
      .then((res) => setCompanies(res.companies))
      .catch(() => {});
  }, [closed]);

  const parsedValue = Number(value);
  const valueOk = !version || (value.trim() !== '' && Number.isFinite(parsedValue) && parsedValue >= 0);

  // Only what actually changed is sent — an untouched field is not an edit.
  const body: Record<string, unknown> = {
    ...(ownerId && ownerId !== original.ownerId ? { ownerId } : {}),
    ...(kind !== original.kind ? { kind } : {}),
    ...(companyId && companyId !== original.companyId ? { companyId } : {}),
    ...(version && valueOk && parsedValue !== Number(original.value) ? { value: parsedValue } : {}),
    ...(version && scopeSummary.trim() !== original.scopeSummary ? { scopeSummary: scopeSummary.trim() } : {}),
    ...(version && fileUrl.trim() !== original.fileUrl ? { fileUrl: fileUrl.trim() || null } : {}),
    ...(version && sentAt && sentAt !== original.sentAt ? { sentAt } : {}),
  };
  const changed = Object.keys(body).length > 0;
  const moving = 'companyId' in body;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed || !valueOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.proposals.update(proposal.id, body);
      toast.success(
        moving
          ? `Moved to ${companies.find((c) => c.id === companyId)?.name ?? 'the other company'}`
          : 'Proposal updated',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this proposal');
    } finally {
      setBusy(false);
    }
  };

  const money = kind === 'RETAINER' ? 'Monthly value' : 'Total quoted value';

  return (
    <Modal open onClose={onClose} title="Edit proposal" description={companyName} size="md">
      <form className="flex h-full flex-col" onSubmit={submit}>
        <ScrollingModalBody className="space-y-5">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          {/* ── The deal ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {closed ? (
                <>
                  <span className="eyebrow mb-1.25 block">Company</span>
                  <div className="rounded-xl border border-border bg-subtle/40 px-4 py-2.5 text-sm font-medium text-primary">
                    {companyName}
                  </div>
                  <p className="mt-1 text-micro text-secondary">
                    {proposal.outcome === 'WON'
                      ? 'Won deals stay with the company they made a client.'
                      : 'Lost deals stay with the company they were lost with.'}
                  </p>
                </>
              ) : (
                <FieldSelect
                  label="Company"
                  value={companyId}
                  onChange={setCompanyId}
                  options={
                    companies.length > 0
                      ? companies.map((c) => ({ value: c.id, label: c.name }))
                      : [{ value: original.companyId, label: companyName }]
                  }
                  disabled={busy}
                  hint={moving ? 'The deal moves to this company’s pipeline.' : undefined}
                />
              )}
            </div>

            <div>
              <FieldSelect
                label="Kind of work"
                value={kind}
                onChange={(v) => setKind(v as 'RETAINER' | 'PROJECT')}
                options={[
                  { value: 'RETAINER', label: 'Monthly retainer' },
                  { value: 'PROJECT', label: 'One-time project' },
                ]}
                disabled={busy || closed}
              />
              <p className="mt-1 text-micro text-secondary">
                {closed ? 'Settled when it closed — it decided what was built.' : 'Decides what winning this creates.'}
              </p>
            </div>

            <FieldSelect
              label="Owner"
              value={ownerId}
              onChange={setOwnerId}
              options={personOptions(team)}
              placeholder="Nobody in particular"
              disabled={busy}
            />
          </div>

          {/* ── The figures, on the version they belong to ── */}
          {version ? (
            <div className="space-y-4 border-t border-border pt-5">
              <div>
                <p className="eyebrow">
                  {proposal.wonVersion ? `The winning version · v${version.n}` : `Latest version · v${version.n}`}
                </p>
                <p className="mt-1 text-micro text-secondary">
                  {proposal.outcome === 'WON'
                    ? 'Corrects what was won. The retainer or project built from it keeps its own fee — change that on its own page.'
                    : 'Corrects this version in place. To send the client a revised quote, use Add version instead — both are kept.'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={`${money} (₹)`}
                  type="number"
                  value={value}
                  onChange={setValue}
                  disabled={busy}
                  required
                  error={!valueOk ? 'Enter a value of 0 or more' : undefined}
                />
                <Field label="Sent on" type="date" value={sentAt} onChange={setSentAt} disabled={busy} />
              </div>

              <Field
                label="Scope summary"
                value={scopeSummary}
                onChange={setScopeSummary}
                textarea
                rows={4}
                disabled={busy}
                placeholder="What this version covers."
              />

              <Field
                label="Proposal document link"
                value={fileUrl}
                onChange={setFileUrl}
                disabled={busy}
                placeholder="Link to the PDF or deck sent to the client"
              />
            </div>
          ) : (
            <p className="border-t border-border pt-5 text-micro text-secondary">
              Nothing has been quoted on this deal yet. Write the proposal from the card first — then its value,
              scope and link can be corrected here.
            </p>
          )}
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!changed || !valueOk || busy}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
