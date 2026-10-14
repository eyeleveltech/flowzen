'use client';

/**
 * The three things a person does to keep a deal or a lead current (Sales
 * next step plan):
 *
 *   · Log touch — a call, WhatsApp, email or meeting: what was said and what
 *     happens next. It moves the last touch to now, so the deal leaves the
 *     "going stale" count.
 *   · Set next step — just the plan, without a touch.
 *   · Set last contact date — corrects the record when the real last contact
 *     is older than what Flowzen has (an import stamped everything with the
 *     import date). One row or many.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError, type TouchBody } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { NextStepFields, nextStepBody, nextStepDraft, nextStepReady, useStudioToday } from './NextStep';

export type SalesTarget = {
  kind: 'DEAL' | 'LEAD';
  id: string;
  /** The client or the lead, for the title. */
  name: string;
  nextStep?: string | null;
  nextStepDate?: string | null;
};

const CHANNELS: { value: TouchBody['channel']; label: string }[] = [
  { value: 'CALL', label: 'Call' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'OTHER', label: 'Other' },
];

export function LogTouchModal({ target, onClose, onDone }: { target: SalesTarget; onClose: () => void; onDone: () => void }) {
  const today = useStudioToday();
  const [channel, setChannel] = useState<TouchBody['channel']>('CALL');
  const [note, setNote] = useState('');
  const [step, setStep] = useState(nextStepDraft(target.nextStep, target.nextStepDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = Boolean(note.trim()) && nextStepReady(step, today) && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: TouchBody = { channel, note: note.trim(), nextStep: step.nextStep.trim(), nextStepDate: step.nextStepDate };
      if (target.kind === 'DEAL') await api.proposals.touch(target.id, body);
      else await api.outreach.touch(target.id, body);
      toast.success(`${CHANNELS.find((c) => c.value === channel)?.label} logged`);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not log that touch');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Log touch" description={`${target.name} — what was said, and what happens next.`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <FieldSelect label="How" value={channel} onChange={(v) => setChannel(v as TouchBody['channel'])} required options={CHANNELS} />
          <Field
            label="What was said"
            value={note}
            onChange={setNote}
            required
            textarea
            rows={3}
            placeholder="e.g. Liked v2, wants the timeline split into phases"
            disabled={busy}
          />
          <NextStepFields value={step} onChange={setStep} disabled={busy} hint={null} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Log touch
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function NextStepModal({ target, onClose, onDone }: { target: SalesTarget; onClose: () => void; onDone: () => void }) {
  const today = useStudioToday();
  const [step, setStep] = useState(nextStepDraft(target.nextStep, target.nextStepDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = nextStepReady(step, today) && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = nextStepBody(step);
      if (target.kind === 'DEAL') await api.proposals.update(target.id, body);
      else await api.outreach.update(target.id, { nextStep: body.nextStep, nextActionDate: body.nextStepDate });
      toast.success('Next step saved');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the next step');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Next step" description={`${target.name} — what happens next, and by when.`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <NextStepFields value={step} onChange={setStep} disabled={busy} hint="Setting it is not contact — to record a call or a message, use Log touch." />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Save next step
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * When they were last really in touch. For one row, or several selected at
 * once — imported data corrected in one go. A date, not in the future.
 */
export function LastContactModal({
  kind,
  ids,
  label,
  onClose,
  onDone,
}: {
  kind: 'DEAL' | 'LEAD';
  ids: string[];
  /** "Carlton Hotels", or "6 leads". */
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = useStudioToday();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const future = Boolean(date) && date > today;
  const canSave = Boolean(date) && !future && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        ids.length === 1
          ? kind === 'DEAL'
            ? await api.proposals.setLastContact(ids[0], date)
            : await api.outreach.setLastContact(ids[0], date)
          : kind === 'DEAL'
            ? await api.proposals.bulkLastContact(ids, date)
            : await api.outreach.bulkLastContact(ids, date);
      toast.success(res.updated === 1 ? 'Last contact date set' : `Last contact date set on ${res.updated}`);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not set the last contact date');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Set last contact date"
      description={`${label} — when you were last really in touch. "Going stale" counts from this date.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <Field
            label="Last contact"
            type="date"
            required
            max={today}
            value={date}
            onChange={setDate}
            disabled={busy}
            error={future ? "Can't be in the future" : undefined}
            hint="For correcting the record — imported names carry the import date. To record a new call or message, use Log touch."
          />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Set date
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * Verbal yes: agreed, nothing signed. The one manual stage flag — and the deal
 * stays open, so it says what happens next (the contract, the advance) and by
 * when.
 */
export function VerbalYesModal({ target, onClose, onDone }: { target: SalesTarget; onClose: () => void; onDone: () => void }) {
  const today = useStudioToday();
  const [step, setStep] = useState(nextStepDraft(target.nextStep, target.nextStepDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = nextStepReady(step, today) && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.proposals.updateStage(target.id, 'VERBAL_YES', nextStepBody(step));
      toast.success('Flagged verbal yes');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not flag verbal yes');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Flag verbal yes"
      description={`${target.name} has agreed verbally, before anything is signed. Winning still needs the win step.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <NextStepFields value={step} onChange={setStep} disabled={busy} />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Flag verbal yes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
