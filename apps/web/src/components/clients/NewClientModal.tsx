'use client';

/**
 * Adding a company.
 *
 * ─── What this used to ask for ──────────────────────────────────────────────
 *
 * Twenty fields, across four sections: industry, company size, website,
 * LinkedIn, Twitter, Instagram, street, city, state, ZIP, country, a company
 * email, a full contact block, and an optional deal with its own title, value
 * and stage. To write down that somebody gave you a phone number.
 *
 * ─── The rule now ───────────────────────────────────────────────────────────
 *
 * **A form asks only what the next step needs.** Everything else moves onto the
 * record and is filled in when it is known — GST and the billing address are
 * asked at Negotiation, which is a rule the pipeline already enforces and this
 * form used to ignore.
 *
 * So: a name, and four things that are either free or load-bearing.
 *
 *   Contact and phone   what you were actually handed
 *   City                used — with the state field — to decide CGST+SGST vs IGST
 *   Source              the only chance to record where they came from
 *   Follow up on        defaulted, and the reason the lead ever gets called again
 *
 * The OWNER is not a field. It defaults to whoever is adding the record, server
 * side, and can be changed on the record afterwards. It has to exist, because
 * every reminder Flowzen sends is addressed to an owner and a company without
 * one is invisible to all of them — but that is a default, not a question.
 *
 * ─── It does NOT land on the pipeline ───────────────────────────────────────
 *
 * Saving used to create the company AND a card on the board, in a TALKING
 * stage, with no value and nothing quoted. That was the wrong shape: the
 * pipeline renders PROPOSALS, so the card stood for a proposal nobody had
 * sent, it could not be dragged forward, and quoting the client wrote a second
 * row and left the first behind for good.
 *
 * A company is a company. It reaches the board when somebody sends it a
 * number, and until then the follow-up date below is what keeps the lead
 * alive — that is what Today and the morning signals actually read.
 *
 * The company and its contact are still ONE request. They used to be two calls
 * made after this one returned, each wrapped in a try/catch that logged to the
 * console and carried on — so a company could save with its contact quietly
 * missing.
 */

import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { api, ApiError, type OrgConfig, type DuplicateVerdict } from '@/lib/api-v2';
import { useConfig } from '@/hooks/queries';
import { DuplicateNotice } from './DuplicateNotice';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  onConfirm: (client: { id: string; name: string }) => void;
  onCancel: () => void;
};

/** Two days out, in the browser's own calendar, as `yyyy-mm-dd`. */
const inTwoDays = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function NewClientModal({ onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shared, hour-cached. This modal refetched the whole org config every time
  // it was opened, for a list of five sources that changes about never.
  const { data: config } = useConfig();

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [followUpDate, setFollowUpDate] = useState(inTwoDays);
  /*
   * A prospect, or somebody you already work with.
   *
   * §3 says a company's status is derived, never set — it becomes a CLIENT
   * because a proposal was won, which is what stops "clients" existing who
   * never bought anything. That rule is right for new business and has no
   * answer for the day you start using this, when every client you have
   * predates the system.
   *
   * Recording one as existing is a different act from winning it, so it is a
   * deliberate choice on the form rather than a status anybody can edit later,
   * and the server writes a separate activity verb for it so migrated clients
   * never count towards a win rate.
   */
  const [existing, setExisting] = useState(false);

  /**
   * Whether this company is already here.
   *
   * `POST /companies/check-duplicate` exists so the warning can arrive while
   * somebody is still typing, rather than only after they press Add — and when
   * it does arrive it names the company it clashed with, because the server has
   * always sent the match and this screen used to throw it away.
   */
  const [verdict, setVerdict] = useState<DuplicateVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  /** Set once the person has seen a name warning and chosen to go ahead. */
  const [force, setForce] = useState(false);

  // Debounced — this runs on every keystroke. The phone is in here too: a phone
  // match BLOCKS rather than warns, so it matters more than the name.
  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setVerdict(null);
      return;
    }

    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      api.companies
        .checkDuplicate({ name: trimmed, phone: phone || undefined })
        .then((v) => {
          if (cancelled) return;
          setVerdict(v.action === 'CREATE' ? null : v);
          // Editing the name after choosing "add anyway" asks the question again.
          setForce(false);
        })
        .catch(() => {
          // A failed check must never block adding a company. The server runs the
          // same rule again on save, so nothing gets through unchecked.
          if (!cancelled) setVerdict(null);
        })
        .finally(() => !cancelled && setChecking(false));
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [name, phone]);

  const handleConfirm = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.companies.create({
        name: name.trim(),
        phone: phone || null,
        city: city || null,
        sourceId: sourceId || null,
        // A prospect gets chased; somebody you already work with does not.
        followUpDate: existing ? null : followUpDate || null,
        ...(existing ? { status: 'CLIENT' as const, existingClient: true } : {}),
        // One transaction on the server: the company, the person, and the card.
        ...(contactName.trim()
          ? { contact: { name: contactName.trim(), phone: phone || null } }
          : {}),
        // Carries a NAME warning past. The server ignores it for a phone or email
        // match, which is the point: those are the same company.
        ...(force ? { force: true } : {}),
      });

      /*
       * Nobody is "on the board" any more.
       *
       * This used to say so for a new lead, because adding a company opened a
       * proposal in a TALKING stage. It opened an EMPTY one -- no number sent,
       * nothing quoted -- and the board is a list of proposals, so the message
       * was announcing a card that stood for nothing. They go on the board
       * when you send them a proposal.
       */
      toast.success(
        existing ? `${created.name} added as a client` : `${created.name} added as a prospect`,
      );
      onConfirm(created);
    } catch (e) {
      /**
       * The 409 carries the match, not just a sentence — `{ action, matches,
       * canForce }`, with the id and name of what it clashed with.
       */
      if (e instanceof ApiError && e.status === 409 && e.data) {
        setVerdict(e.data as DuplicateVerdict);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not add this company');
      }
    } finally {
      setBusy(false);
    }
  };

  const blocked = verdict?.action === 'BLOCK';
  const warned = verdict?.action === 'WARN';
  /** A name clash can be overridden; a phone or email clash cannot. */
  const canSave = Boolean(name.trim()) && !busy && !blocked && (!warned || force);

  const sources = config?.sources ?? [];

  return (
    <Modal
      open
      title="New company"
      description="They go straight onto the board, in New Lead."
      onClose={onCancel}
      size="md"
    >
      {/*
        `ScrollingModalBody`, not `ModalBody`, even though this form is short.
        The dialog is a full-height slide-over on desktop, and only the scrolling
        body carries `flex-1` — with the plain body the footer stops directly
        under the last field and leaves the bottom half of the panel blank.
      */}
      <ScrollingModalBody className="space-y-4">
        <Field
          label="Company name"
          value={name}
          onChange={setName}
          placeholder="e.g. Acme Foods"
          required
          disabled={busy}
          hint={checking ? 'Checking for duplicates…' : undefined}
        />

        {/*
          `onForce` takes the value, so it is wired to the setter rather than to
          `() => setForce(true)` — a checkbox that can only ever be ticked cannot
          be unticked, and the person would be stuck past a warning they wanted
          to reconsider.
        */}
        <DuplicateNotice verdict={verdict} checking={checking} force={force} onForce={setForce} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Contact person"
            value={contactName}
            onChange={setContactName}
            placeholder="e.g. Priya Sharma"
            disabled={busy}
          />
          <Field
            label="Phone"
            value={phone}
            onChange={setPhone}
            placeholder="e.g. 98765 43210"
            disabled={busy}
          />
        </div>

        <FieldSelect
          label="Are you already working with them?"
          value={existing ? 'CLIENT' : 'PROSPECT'}
          onChange={(v) => setExisting(v === 'CLIENT')}
          options={[
            { value: 'PROSPECT', label: 'No — someone we are pitching' },
            { value: 'CLIENT', label: 'Yes — an existing client' },
          ]}
          disabled={busy}
        />
        {/* `FieldSelect` carries no hint slot, so the explanation sits under it
            — and it earns the space, because this choice is the difference
            between a deal you are chasing and a client you already bill. */}
        <p className="-mt-2 text-xs text-secondary">
          {existing
            ? 'Added as a client straight away, so you can put their retainer or project on today. They do not go on the pipeline board, and you can still send them a proposal for new work.'
            : 'They start as a prospect and become a client when a proposal is won.'}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="City"
            value={city}
            onChange={setCity}
            placeholder="e.g. Chennai"
            disabled={busy}
          />
          <FieldSelect
            label="Where did they come from?"
            value={sourceId}
            onChange={setSourceId}
            options={[
              { value: '', label: 'Not sure' },
              ...sources.map((s) => ({ value: s.id, label: s.name })),
            ]}
            disabled={busy}
          />
        </div>

        {/*
          The one field that stops a lead being forgotten.

          Verified: a company surfaces on Today and in notifications only if it
          has an owner AND a follow-up date. The owner is defaulted server-side;
          this is the other half, defaulted to two days out.
        */}
        {/* Only a prospect needs chasing. */}
        {!existing && (
          <Field
            label="Follow up on"
            type="date"
            value={followUpDate}
            onChange={setFollowUpDate}
            disabled={busy}
            hint="When you will come back to them. Change it any time."
          />
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <p className="text-xs text-secondary">
          Everything else — website, GST, billing address, the rest of the team — is added on
          their record when you know it.
        </p>
      </ScrollingModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm} loading={busy} disabled={!canSave}>
          Add company
        </Button>
      </ModalFooter>
    </Modal>
  );
}
