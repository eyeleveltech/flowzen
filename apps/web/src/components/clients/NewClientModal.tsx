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
 * ─── And it lands on the board ──────────────────────────────────────────────
 *
 * Saving creates the company AND its first card, in New Lead, with no title, no
 * value and no close date. Before this, a company with no deal appeared nowhere
 * on the pipeline — the board renders cards — so a lead you were given on Tuesday
 * was invisible to it and to every morning signal that reads it.
 *
 * All of it is ONE request now. The contact and the deal used to be two more
 * calls made after this one returned, each wrapped in a try/catch that logged to
 * the console and carried on — so a company could save with its contact quietly
 * missing.
 */

import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { api, ApiError, type OrgConfig, type DuplicateVerdict } from '@/lib/api-v2';
import { DuplicateNotice } from './DuplicateNotice';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  onConfirm: (client: { id: string; name: string; dealId?: string | null }) => void;
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
  const [config, setConfig] = useState<OrgConfig | null>(null);

  useEffect(() => {
    api.config.get().then(setConfig).catch(console.error);
  }, []);

  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [followUpDate, setFollowUpDate] = useState(inTwoDays);

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
        followUpDate: followUpDate || null,
        // One transaction on the server: the company, the person, and the card.
        ...(contactName.trim()
          ? { contact: { name: contactName.trim(), phone: phone || null } }
          : {}),
        // Carries a NAME warning past. The server ignores it for a phone or email
        // match, which is the point: those are the same company.
        ...(force ? { force: true } : {}),
      });

      toast.success(
        created.dealId ? `${created.name} added — they are on the board` : `${created.name} added`,
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
        <Field
          label="Follow up on"
          type="date"
          value={followUpDate}
          onChange={setFollowUpDate}
          disabled={busy}
          hint="When you will come back to them. Change it any time."
        />

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
