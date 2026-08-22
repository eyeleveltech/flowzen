'use client';

/**
 * Winning a deal.
 *
 * This dialog is where the original bug lived. The board's Active column mapped
 * to two stages and the drop handler always picked the first, so a one-off
 * project became a monthly subscription — while the dialog *asked* the question
 * and saved the answer, which had already been overruled (master plan §1.3 ①).
 *
 * Now the stage does not carry the answer at all. This dialog IS the decision,
 * and the server refuses to win a deal without it.
 */

import { useState } from 'react';
import { api, ApiError, type ContractType, type BillingFrequency, type WinTerms } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';

type Props = {
  dealId: string;
  dealTitle: string;
  companyName: string;
  /** Pre-filled from an accepted quotation, when there is one (§3.12). */
  defaults?: Partial<WinTerms>;
  onClose: () => void;
  onWon: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);

const FREQUENCIES = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
  { value: 'ONE_TIME', label: 'Once' },
];

export function WinDealDialog({ dealId, dealTitle, companyName, defaults, onClose, onWon }: Props) {
  const [contractType, setContractType] = useState<ContractType | null>(
    (defaults?.contractType as ContractType) ?? null,
  );
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [amount, setAmount] = useState(String(defaults?.amount ?? ''));
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>(
    (defaults?.billingFrequency as BillingFrequency) ?? 'MONTHLY',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const fieldError = (name: string) => error?.forField(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractType) return;
    setSaving(true);
    setError(null);
    try {
      await api.deals.win(dealId, {
        contractType,
        startDate,
        endDate: endDate || null,
        amount,
        billingFrequency,
      });
      onWon();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Something went wrong', 500));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Win this deal"
      description={`${dealTitle} · ${companyName}`}
      size="md"
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-5">
          {/* The question the whole design turns on. Asked first, and required. */}
          <div>
            <span className="mb-2 block text-sm font-medium text-body">
              What kind of work is this? <span className="text-red-500">*</span>
            </span>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { value: 'RETAINER', label: 'Retainer', hint: 'Bills every month' },
                  { value: 'PROJECT', label: 'Project', hint: 'A one-off piece of work' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setContractType(option.value);
                    setBillingFrequency(option.value === 'PROJECT' ? 'ONE_TIME' : 'MONTHLY');
                  }}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    contractType === option.value
                      ? 'border-primary bg-subtle'
                      : 'border-border hover:bg-subtle'
                  }`}
                >
                  <span className="block text-sm font-semibold text-primary">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-secondary">{option.hint}</span>
                </button>
              ))}
            </div>
            {fieldError('contractType') && (
              <p className="mt-2 text-xs text-red-500">{fieldError('contractType')}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={contractType === 'RETAINER' ? 'Amount per month' : 'Total amount'}
              type="number"
              value={amount}
              onChange={setAmount}
              required
            />
            <FieldSelect
              label="Bills"
              value={billingFrequency}
              onChange={(v) => setBillingFrequency(v as BillingFrequency)}
              options={FREQUENCIES}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Start date"
              type="date"
              value={startDate}
              onChange={setStartDate}
              required
              hint="When billing begins."
              error={fieldError('engagementStartDate')}
            />
            {/*
              A blank end date on a retainer MEANS something: it runs until
              somebody stops it. Saying so is what stops people inventing a date
              to fill the box (§3.6).
            */}
            <Field
              label="End date"
              type="date"
              value={endDate}
              onChange={setEndDate}
              required={contractType === 'PROJECT'}
              hint={
                contractType === 'PROJECT'
                  ? 'A project has a delivery date.'
                  : 'Leave blank if it just runs.'
              }
              error={fieldError('engagementEndDate')}
            />
          </div>

          {error && error.fieldErrors.length === 0 && <ErrorNote>{error.message}</ErrorNote>}

          <Note>
            Winning this deal turns {companyName} into a client, creates what bills them, and closes
            the deal — all at once.
          </Note>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!contractType}>
            Win deal
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
