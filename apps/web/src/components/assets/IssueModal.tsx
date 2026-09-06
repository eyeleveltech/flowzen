'use client';

/**
 * Handing something over.
 *
 * ONE dialog for three verbs — assign, check out, transfer — because they are
 * one question with a different tail. All three ask "who is taking it, and in
 * what condition"; only a booking also asks "and when is it back". Three
 * dialogs would be three copies of the person picker drifting apart.
 *
 * The distinction the form does insist on is custody against booking, because
 * that is the distinction the whole register is built around: a laptop with a
 * designer has no due date and never goes overdue, and a lens on a shoot has
 * both. Making somebody choose is the point, not friction.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { CONDITION_OPTIONS } from '@/lib/assets';
import { personOptions } from '@/lib/people';

export type IssueMode = 'ASSIGN' | 'CHECKOUT' | 'TRANSFER';

const COPY: Record<IssueMode, { title: string; verb: string; hint: string }> = {
  ASSIGN: {
    title: 'Assign it to somebody',
    verb: 'Assign',
    hint: 'Long-term custody. No due date — this records who is responsible for it, not a loan.',
  },
  CHECKOUT: {
    title: 'Check it out for a shoot',
    verb: 'Check out',
    hint: 'A short loan with a date it is due back. It appears on the Out now board and goes overdue if it does not return.',
  },
  TRANSFER: {
    title: 'Hand it straight to somebody else',
    verb: 'Transfer',
    hint: 'Closes the current record and opens the next one in the same breath, so the chain of custody never has a gap in it.',
  },
};

const inAWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

export function IssueModal({
  open,
  mode,
  assetId,
  assetLabel,
  onClose,
  onDone,
}: {
  open: boolean;
  mode: IssueMode;
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [team, setTeam] = useState<{ id: string; name: string; dept: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [conditionOut, setConditionOut] = useState('GOOD');
  const [dueAt, setDueAt] = useState(inAWeek());
  const [projectId, setProjectId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUserId('');
    setConditionOut('GOOD');
    setDueAt(inAWeek());
    setProjectId('');
    setPurpose('');
    setNotes('');
    setError(null);
    void api.team
      .members()
      .then((res) => setTeam(res.members))
      .catch(() => {});
    if (mode === 'CHECKOUT') {
      void api.projects
        .list()
        .then((res: any) => setProjects(res.projects ?? res ?? []))
        .catch(() => {});
    }
  }, [open, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const base = { userId, conditionOut, notes: notes.trim() || null };
      if (mode === 'CHECKOUT') {
        await api.assets.checkout(assetId, {
          ...base,
          dueAt,
          projectId: projectId || null,
          purpose: purpose.trim() || null,
        });
      } else if (mode === 'TRANSFER') {
        await api.assets.transfer(assetId, base);
      } else {
        await api.assets.assign(assetId, base);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that');
    } finally {
      setSaving(false);
    }
  };

  const copy = COPY[mode];

  return (
    <Modal open={open} onClose={onClose} title={copy.title} description={assetLabel}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <Note>{copy.hint}</Note>

          <FieldSelect
            label="Who is taking it"
            value={userId}
            onChange={setUserId}
            required
            placeholder="Pick somebody"
            options={personOptions(team)}
          />

          <FieldSelect
            label="Condition going out"
            value={conditionOut}
            onChange={setConditionOut}
            options={CONDITION_OPTIONS}
          />

          {mode === 'CHECKOUT' && (
            <>
              <Field label="Due back" type="date" value={dueAt} onChange={setDueAt} required />
              <Field
                label="What for"
                value={purpose}
                onChange={setPurpose}
                placeholder="Friday shoot at the Adyar site"
              />
              {projects.length > 0 && (
                <FieldSelect
                  label="Against which project"
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="Not a billable job"
                  options={[
                    { value: '', label: 'Not a billable job' },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              )}
            </>
          )}

          <Field label="Anything to note" value={notes} onChange={setNotes} textarea rows={2} />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!userId}>
            {copy.verb}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * Checking something back in.
 *
 * The condition dropdown is the whole dialog, and DAMAGED is not a cosmetic
 * choice: it sends the item to In repair instead of back onto the shelf, so the
 * next person looking for a free lens is not offered a broken one.
 */
export function CheckInModal({
  open,
  assetId,
  assetLabel,
  onClose,
  onDone,
}: {
  open: boolean;
  assetId: string;
  assetLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [conditionIn, setConditionIn] = useState('GOOD');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConditionIn('GOOD');
    setNotes('');
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.assets.checkin(assetId, { conditionIn, notes: notes.trim() || null });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Check it back in" description={assetLabel}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <FieldSelect
            label="How did it come back"
            value={conditionIn}
            onChange={setConditionIn}
            options={CONDITION_OPTIONS}
          />
          {conditionIn === 'DAMAGED' && (
            <Note tone="warn">
              Marking it damaged sends it to In repair rather than back on the shelf, so nobody is
              offered it for the next shoot.
            </Note>
          )}
          <Field label="Anything to note" value={notes} onChange={setNotes} textarea rows={2} />
        </ScrollingModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Check in
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
