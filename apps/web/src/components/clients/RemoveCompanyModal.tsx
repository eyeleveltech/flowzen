'use client';

/**
 * Taking a company off the books — the two ways, said side by side.
 *
 * ─── Why one dialog with two answers ────────────────────────────────────────
 *
 * "Remove" used to archive, and the server refused when there was real work on
 * the company — so somebody pressed Remove, was turned down, and was offered
 * "mark them a past client" in a second dialog as a consolation. The choice was
 * never presented; it was discovered by being refused.
 *
 * Both are here now, with what each one keeps or destroys under it, because
 * they answer different questions. A client who has stopped is a past client:
 * their invoices, their projects and their history are the record of a year of
 * work and none of it should go. A company typed in twice is not history, and
 * archiving it leaves it in every picker for ever.
 *
 * ─── Why the name has to be typed ───────────────────────────────────────────
 *
 * The second option destroys everything attached — proposals, retainers,
 * months, projects, tasks, costs, documents — and there is no undo, because
 * that is what "permanently" means. Typing the name is the only confirmation
 * that cannot be clicked through on the way to somewhere else. The server
 * checks it too: the browser is not the gate.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Archive } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

export type Holdings = {
  people: number;
  proposals: number;
  quoted: number;
  proformas: number;
  retainers: number;
  projects: number;
  invoices: number;
  paidInvoices: number;
  tasks: number;
  costs: number;
};

type Choice = 'PAST' | 'PERMANENT';

/** "3 proposals, a retainer and 14 tasks" — only what is actually there. */
const holdingsLine = (h: Holdings): string => {
  const parts: [number, string, string][] = [
    [h.quoted, 'proposal', 'proposals'],
    [h.retainers, 'retainer', 'retainers'],
    [h.projects, 'project', 'projects'],
    [h.tasks, 'task', 'tasks'],
    [h.invoices, 'invoice', 'invoices'],
    [h.proformas, 'proforma', 'proformas'],
    [h.costs, 'recorded cost', 'recorded costs'],
    [h.people, 'contact', 'contacts'],
  ];
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (said.length === 0) return 'nothing on it yet';
  if (said.length === 1) return said[0];
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
};

export function RemoveCompanyModal({
  companyId,
  companyName,
  status,
  canDeletePermanently,
  onClose,
  onDone,
}: {
  companyId: string;
  companyName: string;
  status: string;
  /** `setup.admin`. The server enforces it; this decides whether to offer it. */
  canDeletePermanently: boolean;
  onClose: () => void;
  onDone: (outcome: 'PAST' | 'DELETED') => void;
}) {
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [choice, setChoice] = useState<Choice>('PAST');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.companies
      .holdings(companyId)
      .then((r) => setHoldings(r.holdings))
      .catch(() => setHoldings(null));
  }, [companyId]);

  const line = holdings ? holdingsLine(holdings) : 'its record';
  const alreadyPast = status === 'PAST';
  const nameMatches = typed.trim() === companyName;
  const canGo = choice === 'PAST' ? !alreadyPast && !busy : nameMatches && !busy;

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    setError(null);
    try {
      if (choice === 'PAST') {
        await api.companies.update(companyId, { status: 'PAST' } as never);
        toast.success(`${companyName} is a past client`);
        onDone('PAST');
      } else {
        const res = await api.companies.deletePermanently(companyId, typed.trim());
        toast.success(`${res.deleted.name} deleted`);
        onDone('DELETED');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Remove ${companyName}?`}
      description="Two ways, and they are not the same size."
      size="md"
    >
      <ModalBody className="space-y-3">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        <Option
          icon={<Archive className="h-4 w-4" strokeWidth={1.75} />}
          title="Make them a past client"
          selected={choice === 'PAST'}
          disabled={alreadyPast}
          onSelect={() => setChoice('PAST')}
        >
          {alreadyPast
            ? 'They are already a past client.'
            : `They come out of the active lists and the pipeline. Nothing is destroyed — ${line} stays exactly where it is, and they can be made a client again.`}
        </Option>

        {canDeletePermanently && (
          <Option
            icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
            title="Delete permanently"
            tone="danger"
            selected={choice === 'PERMANENT'}
            onSelect={() => setChoice('PERMANENT')}
          >
            The company and everything on it — {line} — is destroyed. There is no undo, and it is
            not in Trash afterwards. For a company entered twice, or one that was never real.
          </Option>
        )}

        {choice === 'PERMANENT' && (
          <Field
            label={`Type ${companyName} to confirm`}
            value={typed}
            onChange={setTyped}
            placeholder={companyName}
            disabled={busy}
            hint="Exactly as it is written above. Nothing else will do."
          />
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={choice === 'PERMANENT' ? 'danger' : 'primary'}
          onClick={() => void go()}
          loading={busy}
          disabled={!canGo}
        >
          {choice === 'PERMANENT' ? 'Delete for ever' : 'Make them a past client'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** One of the two ways out, with what it costs written underneath it. */
function Option({
  icon,
  title,
  children,
  selected,
  disabled,
  tone = 'default',
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 ${
        selected
          ? tone === 'danger'
            ? 'border-danger/40 bg-danger-tint'
            : 'border-primary/40 bg-primary/5'
          : 'border-border hover:bg-subtle'
      }`}
    >
      <span className={`flex items-center gap-2 text-sm font-medium ${tone === 'danger' ? 'text-danger' : 'text-primary'}`}>
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-xs text-secondary">{children}</span>
    </button>
  );
}
