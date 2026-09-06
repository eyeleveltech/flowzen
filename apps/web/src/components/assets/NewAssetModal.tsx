'use client';

/**
 * Entering a piece of kit.
 *
 * Two things here are doing more work than they look like:
 *
 * **The tag is shown before anything is saved.** It comes from the server the
 * moment a category is picked, so somebody can write the label while they have
 * the pen in their hand rather than entering the asset, finding the tag, and
 * going back to the cupboard.
 *
 * **"Also record this as a company cost" is on by default for a new purchase.**
 * The alternative is typing ₹2,40,000 into the register and again into Money,
 * and then having two numbers that can disagree. Off is still available, for
 * kit that was bought before any of this existed.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect, FieldCheckbox } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import {
  ASSET_BOOKABLE_BY_DEFAULT,
  ASSET_USEFUL_LIFE,
  CATEGORY_OPTIONS,
  CONDITION_OPTIONS,
} from '@/lib/assets';

const today = () => new Date().toISOString().slice(0, 10);

export function NewAssetModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('CAMERA_BODY');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [bookable, setBookable] = useState(true);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasedAt, setPurchasedAt] = useState(today());
  const [vendor, setVendor] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('60');
  const [salvageValue, setSalvageValue] = useState('0');
  const [warrantyUntil, setWarrantyUntil] = useState('');
  const [billUrl, setBillUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [createCost, setCreateCost] = useState(true);

  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCategory('CAMERA_BODY');
    setMake('');
    setModel('');
    setSerialNumber('');
    setCondition('NEW');
    setPurchasePrice('');
    setPurchasedAt(today());
    setVendor('');
    setInvoiceNumber('');
    setSalvageValue('0');
    setWarrantyUntil('');
    setBillUrl('');
    setNotes('');
    setCreateCost(true);
    setError(null);
    setWarnings([]);
  }, [open]);

  // The category decides three defaults at once — the tag, how long it is
  // written off over, and whether it is the kind of thing that leaves the
  // office. All three stay editable; none of them should have to be typed.
  useEffect(() => {
    if (!open || !category) return;
    setUsefulLifeMonths(String(ASSET_USEFUL_LIFE[category] ?? 60));
    setBookable(ASSET_BOOKABLE_BY_DEFAULT.includes(category));
    let cancelled = false;
    void api.assets
      .nextTag(category)
      .then((res) => {
        if (!cancelled) setTag(res.tag);
      })
      .catch(() => {
        if (!cancelled) setTag('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, category]);

  const price = Number(purchasePrice) || 0;
  const canSave = Boolean(name.trim()) && Boolean(category) && price >= 0 && Boolean(purchasedAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.assets.create({
        name: name.trim(),
        category,
        make: make.trim() || null,
        model: model.trim() || null,
        serialNumber: serialNumber.trim() || null,
        condition,
        bookable,
        purchasePrice: price,
        purchasedAt,
        vendor: vendor.trim() || null,
        invoiceNumber: invoiceNumber.trim() || null,
        usefulLifeMonths: Number(usefulLifeMonths) || undefined,
        salvageValue: Number(salvageValue) || 0,
        warrantyUntil: warrantyUntil || null,
        billUrl: billUrl.trim() || null,
        notes: notes.trim() || null,
        createCost,
      });
      // A duplicate serial is a warning, not a refusal — two identical bodies
      // bought together genuinely exist. It is shown and the asset is created.
      if (res.warnings?.length) {
        setWarnings(res.warnings);
        setSaving(false);
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Enter a piece of kit" size="lg">
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          {warnings.length > 0 && (
            <Note tone="warn">
              {warnings.join(' ')}{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setWarnings([]);
                  onCreated();
                }}
              >
                It is saved — close this
              </button>
            </Note>
          )}

          {tag && (
            <Note>
              This will be tagged <span className="font-mono font-semibold">{tag}</span>. Write that on
              the sticker before it goes in the cupboard.
            </Note>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="What is it"
              value={name}
              onChange={setName}
              required
              placeholder="Sony A7 IV"
              className="sm:col-span-2"
            />
            <FieldSelect label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} required />
            <FieldSelect label="Condition" value={condition} onChange={setCondition} options={CONDITION_OPTIONS} />
            <Field label="Make" value={make} onChange={setMake} placeholder="Sony" />
            <Field label="Model" value={model} onChange={setModel} placeholder="ILCE-7M4" />
            <Field
              label="Serial number"
              value={serialNumber}
              onChange={setSerialNumber}
              placeholder="Off the body, if it has one"
              className="sm:col-span-2"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="What it cost" type="number" value={purchasePrice} onChange={setPurchasePrice} required />
            <Field label="Bought on" type="date" value={purchasedAt} onChange={setPurchasedAt} required />
            <Field label="From" value={vendor} onChange={setVendor} placeholder="Foto Centre" />
            <Field label="Their invoice number" value={invoiceNumber} onChange={setInvoiceNumber} />
            <Field
              label="Written off over (months)"
              type="number"
              value={usefulLifeMonths}
              onChange={setUsefulLifeMonths}
              hint="Defaulted from the category"
            />
            <Field
              label="Worth at the end"
              type="number"
              value={salvageValue}
              onChange={setSalvageValue}
              hint="What it will still fetch"
            />
            <Field label="Under warranty until" type="date" value={warrantyUntil} onChange={setWarrantyUntil} />
            <Field
              label="Bill (link)"
              value={billUrl}
              onChange={setBillUrl}
              placeholder="Drive link"
              hint="A link, not an upload"
            />
          </div>

          <FieldCheckbox
            label="This goes out on shoots"
            checked={bookable}
            onChange={setBookable}
            hint="Puts it on the availability check and the Out now board. A monitor never leaves; a lens always does."
          />

          <FieldCheckbox
            label="Also record this as a capital cost"
            checked={createCost}
            onChange={setCreateCost}
            hint="Raises the CAPITAL row in Money so the amount is typed once and the two can never disagree. Turn it off for kit bought before the register existed."
          />

          <Field label="Anything else" value={notes} onChange={setNotes} textarea rows={2} />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Add to the register
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
