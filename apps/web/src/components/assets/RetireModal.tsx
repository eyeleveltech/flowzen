'use client';

/**
 * Taking something off the floor, and sending it for repair.
 *
 * Retiring is three different endings wearing one dialog, and the difference
 * matters to the books: written off is worth its salvage value, SOLD is worth
 * what it actually fetched — which is rarely the same number and is what a
 * gain-or-loss line needs — and LOST is neither, it is a fact somebody has to
 * record. None of the three deletes anything: the item stays on the register
 * with its whole history, because "we used to own a camera and now we do not"
 * is exactly what an asset register is for.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { CONDITION_OPTIONS } from '@/lib/assets';

const OUTCOMES = [
  { value: 'RETIRED', label: 'Written off — kept, but no longer in service' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'LOST', label: 'Lost or stolen' },
];

const today = () => new Date().toISOString().slice(0, 10);

export function RetireModal({
  open,
  assetId,
  assetLabel,
  canSeeFigures,
  onClose,
  onDone,
}: {
  open: boolean;
  assetId: string;
  assetLabel: string;
  canSeeFigures: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState('RETIRED');
  const [disposalValue, setDisposalValue] = useState('');
  const [disposedAt, setDisposedAt] = useState(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOutcome('RETIRED');
    setDisposalValue('');
    setDisposedAt(today());
    setNote('');
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.assets.retire(assetId, {
        outcome,
        disposedAt,
        disposalValue: outcome === 'SOLD' ? Number(disposalValue) || 0 : undefined,
        note: note.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Take it off the floor" description={assetLabel}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <Note>
            It stays on the register with its whole history. Nothing is deleted — the point of the
            record is that it survives the thing it describes.
          </Note>

          <FieldSelect label="What happened to it" value={outcome} onChange={setOutcome} options={OUTCOMES} />
          <Field label="On" type="date" value={disposedAt} onChange={setDisposedAt} />

          {outcome === 'SOLD' && canSeeFigures && (
            <Field
              label="What it fetched"
              type="number"
              value={disposalValue}
              onChange={setDisposalValue}
              hint="Rarely the book value, which is exactly why it is asked for separately."
            />
          )}

          <Field label="Why" value={note} onChange={setNote} textarea rows={2} />
        </ScrollingModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Record it
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Sending something to the shop, and getting it back. */
export function MaintenanceModal({
  open,
  assetId,
  assetLabel,
  canSeeFigures,
  onClose,
  onDone,
}: {
  open: boolean;
  assetId: string;
  assetLabel: string;
  canSeeFigures: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState('REPAIR');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [sentAt, setSentAt] = useState(today());
  const [notes, setNotes] = useState('');
  const [recordCost, setRecordCost] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind('REPAIR');
    setVendor('');
    setAmount('');
    setSentAt(today());
    setNotes('');
    setRecordCost(false);
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.assets.maintenance(assetId, {
        kind,
        vendor: vendor.trim() || null,
        amount: amount ? Number(amount) : undefined,
        sentAt,
        notes: notes.trim() || null,
        recordCost,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send it for repair" description={assetLabel}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <FieldSelect
            label="What kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'REPAIR', label: 'Repair — something is wrong with it' },
              { value: 'SERVICE', label: 'Service — routine' },
              { value: 'AMC', label: 'Annual maintenance contract' },
            ]}
          />
          <Field label="Where it went" value={vendor} onChange={setVendor} placeholder="Sony service centre" />
          <Field label="Sent on" type="date" value={sentAt} onChange={setSentAt} />
          {canSeeFigures && (
            <>
              <Field label="What it cost" type="number" value={amount} onChange={setAmount} />
              <label className="flex items-start gap-3 rounded-xl border border-border bg-subtle p-3">
                <input
                  type="checkbox"
                  checked={recordCost}
                  onChange={(e) => setRecordCost(e.target.checked)}
                  className="mt-0.5 h-4 w-4 cursor-pointer rounded border-line text-primary focus:ring-primary"
                />
                <span>
                  <span className="text-xs font-medium text-body">Also put this in Money</span>
                  <span className="mt-0.5 block text-micro text-secondary">
                    Off by default — small repairs are noise in the P&amp;L, and this log holds the
                    number either way.
                  </span>
                </span>
              </label>
            </>
          )}
          <Field label="What is wrong" value={notes} onChange={setNotes} textarea rows={2} />
        </ScrollingModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Send it
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** It came back from the shop. */
export function CloseMaintenanceModal({
  open,
  assetId,
  maintenanceId,
  assetLabel,
  canSeeFigures,
  onClose,
  onDone,
}: {
  open: boolean;
  assetId: string;
  maintenanceId: string;
  assetLabel: string;
  canSeeFigures: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [condition, setCondition] = useState('GOOD');
  const [amount, setAmount] = useState('');
  const [returnedAt, setReturnedAt] = useState(today());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCondition('GOOD');
    setAmount('');
    setReturnedAt(today());
    setNotes('');
    setError(null);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.assets.closeMaintenance(assetId, maintenanceId, {
        condition,
        returnedAt,
        amount: amount ? Number(amount) : undefined,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="It came back" description={assetLabel}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <FieldSelect
            label="Condition now"
            value={condition}
            onChange={setCondition}
            options={CONDITION_OPTIONS}
          />
          <Field label="Back on" type="date" value={returnedAt} onChange={setReturnedAt} />
          {canSeeFigures && (
            <Field
              label="Final bill"
              type="number"
              value={amount}
              onChange={setAmount}
              hint="Leave blank to keep what was estimated"
            />
          )}
          <Field label="What was done" value={notes} onChange={setNotes} textarea rows={2} />
        </ScrollingModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Back in stock
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
