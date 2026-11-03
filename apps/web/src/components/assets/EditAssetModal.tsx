'use client';

/**
 * Correcting a piece of kit.
 *
 * The register could take an asset in and never change it: the server has
 * accepted edits all along (`PATCH /assets/:id`) and nothing called it, so a
 * mistyped serial, a wrong price or a lens filed under the wrong category
 * stayed wrong — and insured-until and the photo, which entry never asks for,
 * could not be filled in at all.
 *
 * Only what changed is sent. The tag is not here: the sticker on the kit says
 * what it says, whatever the record is corrected to.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError, type AssetListItem } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect, FieldCheckbox } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { CATEGORY_OPTIONS, CONDITION_OPTIONS } from '@/lib/assets';

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');

export function EditAssetModal({
  asset,
  canSeeFigures,
  onClose,
  onSaved,
}: {
  asset: AssetListItem;
  /** Prices are Management's; without them the money fields are not offered. */
  canSeeFigures: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = {
    name: asset.name ?? '',
    category: asset.category ?? '',
    condition: asset.condition ?? 'GOOD',
    make: asset.make ?? '',
    model: asset.model ?? '',
    serialNumber: asset.serialNumber ?? '',
    bookable: Boolean(asset.bookable),
    purchasePrice: asset.purchasePrice != null ? String(asset.purchasePrice) : '',
    purchasedAt: day(asset.purchasedAt),
    vendor: asset.vendor ?? '',
    invoiceNumber: asset.invoiceNumber ?? '',
    usefulLifeMonths: asset.usefulLifeMonths != null ? String(asset.usefulLifeMonths) : '',
    salvageValue: asset.salvageValue != null ? String(asset.salvageValue) : '',
    warrantyUntil: day(asset.warrantyUntil),
    insuredUntil: day(asset.insuredUntil),
    billUrl: asset.billUrl ?? '',
    photoUrl: asset.photoUrl ?? '',
    notes: asset.notes ?? '',
  };
  const [f, setF] = useState(start);
  const set = <K extends keyof typeof start>(k: K) => (v: (typeof start)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = (k: keyof typeof start) => (f[k] !== start[k] ? { [k]: String(f[k]).trim() || null } : {});
  const body: Record<string, unknown> = {
    ...(f.name.trim() && f.name !== start.name ? { name: f.name.trim() } : {}),
    ...(f.category !== start.category ? { category: f.category } : {}),
    ...(f.condition !== start.condition ? { condition: f.condition } : {}),
    ...(f.bookable !== start.bookable ? { bookable: f.bookable } : {}),
    ...text('make'),
    ...text('model'),
    ...text('serialNumber'),
    ...text('vendor'),
    ...text('invoiceNumber'),
    ...text('billUrl'),
    ...text('photoUrl'),
    ...text('notes'),
    ...(f.purchasedAt && f.purchasedAt !== start.purchasedAt ? { purchasedAt: f.purchasedAt } : {}),
    ...(f.warrantyUntil !== start.warrantyUntil ? { warrantyUntil: f.warrantyUntil || null } : {}),
    ...(f.insuredUntil !== start.insuredUntil ? { insuredUntil: f.insuredUntil || null } : {}),
    ...(f.usefulLifeMonths !== start.usefulLifeMonths && Number(f.usefulLifeMonths) > 0
      ? { usefulLifeMonths: Math.round(Number(f.usefulLifeMonths)) }
      : {}),
    ...(canSeeFigures && f.purchasePrice !== start.purchasePrice && Number(f.purchasePrice) >= 0
      ? { purchasePrice: Number(f.purchasePrice) }
      : {}),
    ...(canSeeFigures && f.salvageValue !== start.salvageValue && Number(f.salvageValue) >= 0
      ? { salvageValue: Number(f.salvageValue) }
      : {}),
  };
  const changed = Object.keys(body).length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed || busy || !f.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.assets.update(asset.id, body);
      toast.success(`${asset.tag} updated`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${asset.tag}`} description="The tag stays as it is — it is on the sticker." size="lg">
      <form onSubmit={submit} className="flex h-full flex-col">
        <ScrollingModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="What is it" value={f.name} onChange={set('name')} required className="sm:col-span-2" />
            <FieldSelect label="Category" value={f.category} onChange={set('category')} options={CATEGORY_OPTIONS} required />
            <FieldSelect label="Condition" value={f.condition} onChange={set('condition')} options={CONDITION_OPTIONS} />
            <Field label="Make" value={f.make} onChange={set('make')} />
            <Field label="Model" value={f.model} onChange={set('model')} />
            <Field label="Serial number" value={f.serialNumber} onChange={set('serialNumber')} className="sm:col-span-2" />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {canSeeFigures && (
              <Field label="What it cost" type="number" value={f.purchasePrice} onChange={set('purchasePrice')} />
            )}
            <Field label="Bought on" type="date" value={f.purchasedAt} onChange={set('purchasedAt')} required />
            <Field label="From" value={f.vendor} onChange={set('vendor')} />
            <Field label="Their invoice number" value={f.invoiceNumber} onChange={set('invoiceNumber')} />
            <Field label="Written off over (months)" type="number" value={f.usefulLifeMonths} onChange={set('usefulLifeMonths')} />
            {canSeeFigures && (
              <Field label="Worth at the end" type="number" value={f.salvageValue} onChange={set('salvageValue')} />
            )}
            <Field label="Under warranty until" type="date" value={f.warrantyUntil} onChange={set('warrantyUntil')} />
            <Field label="Insured until" type="date" value={f.insuredUntil} onChange={set('insuredUntil')} />
            <Field label="Bill (link)" value={f.billUrl} onChange={set('billUrl')} placeholder="Drive link" />
            <Field label="Photo (link)" value={f.photoUrl} onChange={set('photoUrl')} placeholder="Drive link" />
          </div>

          <FieldCheckbox
            label="This goes out on shoots"
            checked={f.bookable}
            onChange={set('bookable')}
            hint="Puts it on the availability check and the Out now board."
          />
          <Field label="Anything else" value={f.notes} onChange={set('notes')} textarea rows={2} />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!changed || !f.name.trim()}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
