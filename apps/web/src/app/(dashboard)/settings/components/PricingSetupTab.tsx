'use client';

/**
 * Setup → Services & pricing (AI Proposal Builder, phase 1). Management only.
 *
 * The floors: the lowest monthly fee a proposal may quote, for any client and
 * for particular industries. Below it, Finalise needs a written reason. And
 * the service list: what the studio sells, at its standard rate, for the
 * Pricing tab to pick from. Anyone writing a proposal sees the names; only
 * Management sees the rates. And (phase 3) the rates agreed with particular
 * clients, which a proposal uses before the standard one while they hold.
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, ApiError, formatDate, formatMoney, type ClientRateRow, type ServiceCatalogItem, type ServiceCatalogInput } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ErrorNote } from '@/components/ui/empty-state';
import { INDUSTRY_OPTIONS } from '@/lib/vertical';

const INPUT =
  'w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25';

export function PricingSetupTab() {
  return (
    <div className="space-y-6">
      <FloorsCard />
      <ServicesCard />
      <ClientRatesCard />
    </div>
  );
}

// ── Floors ──────────────────────────────────────────────────────────────────

function FloorsCard() {
  const [base, setBase] = useState('');
  const [rows, setRows] = useState<{ key: string; industry: string; amount: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.proposalDocs
      .floors()
      .then((r) => {
        setBase(String(r.floorBase));
        setRows(Object.entries(r.floors).map(([industry, amount]) => ({ key: industry, industry, amount: String(amount) })));
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load the floors.'));
  }, []);

  const save = async () => {
    const floors: Record<string, number> = {};
    for (const r of rows) {
      if (!r.industry) continue;
      floors[r.industry] = Number(r.amount) || 0;
    }
    setSaving(true);
    try {
      const r = await api.proposalDocs.saveFloors(Number(base) || 0, floors);
      setBase(String(r.floorBase));
      toast.success('Floors saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the floors.');
    } finally {
      setSaving(false);
    }
  };

  const taken = new Set(rows.map((r) => r.industry));

  return (
    <SectionCard
      title="Pricing floors"
      description="The lowest monthly fee a proposal may quote. One-time project fees have no floor. Below it, Management records a reason before the proposal can be finalised."
    >
      {loadError && <ErrorNote>{loadError}</ErrorNote>}
      <label className="block max-w-xs">
        <span className="text-xs font-medium text-body">Any client (₹ a month)</span>
        <input type="number" min={0} className={`${INPUT} mt-1`} value={base} onChange={(e) => setBase(e.target.value)} />
      </label>

      <div className="space-y-2">
        <p className="text-xs font-medium text-body">Higher for these industries</p>
        {rows.length === 0 && <p className="text-xs text-secondary">None. Every client uses the floor above.</p>}
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_9rem_auto] items-center gap-2">
            <Select
              ariaLabel="Industry"
              value={r.industry}
              onChange={(v) => setRows((list) => list.map((x) => (x.key === r.key ? { ...x, industry: v } : x)))}
              options={INDUSTRY_OPTIONS.filter((o) => o.value === r.industry || !taken.has(o.value))}
              placeholder="Choose an industry"
            />
            <input
              type="number"
              min={0}
              aria-label={`Floor for ${r.industry || 'this industry'}`}
              className={INPUT}
              value={r.amount}
              onChange={(e) => setRows((list) => list.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))}
            />
            <button
              type="button"
              aria-label={`Remove the floor for ${r.industry || 'this industry'}`}
              onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
              className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => setRows((list) => [...list, { key: Math.random().toString(36).slice(2), industry: '', amount: '' }])}
        >
          Add an industry
        </Button>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void save()} loading={saving}>
          Save floors
        </Button>
      </div>
    </SectionCard>
  );
}

// ── Services ────────────────────────────────────────────────────────────────

type Draft = { name: string; category: string; billing: 'MONTHLY' | 'ONE_TIME'; unit: string; standardRate: string; description: string };

const draftOf = (i?: ServiceCatalogItem): Draft => ({
  name: i?.name ?? '',
  category: i?.category ?? '',
  billing: i?.billing ?? 'MONTHLY',
  unit: i?.unit ?? 'month',
  standardRate: i?.standardRate === null || i?.standardRate === undefined ? '' : String(i.standardRate),
  description: i?.description ?? '',
});

const bodyOf = (d: Draft): ServiceCatalogInput => ({
  name: d.name.trim(),
  category: d.category.trim() || null,
  billing: d.billing,
  unit: d.unit.trim() || (d.billing === 'MONTHLY' ? 'month' : 'project'),
  standardRate: d.standardRate === '' ? null : Number(d.standardRate),
  description: d.description.trim() || null,
});

function ServicesCard() {
  const [items, setItems] = useState<ServiceCatalogItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Draft | null>(null);

  const load = () =>
    api.proposalDocs
      .catalog(true)
      .then((r) => setItems(r.items))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load the services.'));

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!adding) return;
    try {
      await api.proposalDocs.addService(bodyOf(adding));
      setAdding(null);
      toast.success('Service added');
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not add the service.');
    }
  };

  return (
    <SectionCard
      title="Services"
      description="What the studio sells, at its standard rate. The Pricing tab of a proposal picks from this list; the rate can still be changed there."
    >
      {loadError && <ErrorNote>{loadError}</ErrorNote>}
      {items && items.length === 0 && !adding && <p className="text-sm text-secondary">No services yet. Add the ones you quote most.</p>}
      <div className="space-y-2">
        {items?.map((i) => <ServiceRow key={i.id} item={i} onSaved={() => void load()} />)}
      </div>

      {adding ? (
        <div className="rounded-xl border border-primary/30 p-3">
          <ServiceFields value={adding} onChange={setAdding} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void add()} disabled={!adding.name.trim()}>Add service</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(draftOf())}>
          Add a service
        </Button>
      )}
    </SectionCard>
  );
}

function ServiceRow({ item, onSaved }: { item: ServiceCatalogItem; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftOf(item));
  const [saving, setSaving] = useState(false);

  const save = async (body: Partial<ServiceCatalogInput>) => {
    setSaving(true);
    try {
      await api.proposalDocs.updateService(item.id, body);
      toast.success('Service saved');
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the service.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border p-3 ${item.active ? 'border-border' : 'border-dashed border-border opacity-70'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">{item.name}</p>
          <p className="text-xs text-secondary">
            {item.billing === 'MONTHLY' ? 'Monthly' : 'One-time'} · per {item.unit}
            {item.category ? ` · ${item.category}` : ''}
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-primary">
          {item.standardRate === null || item.standardRate === undefined ? 'No standard rate' : formatMoney(item.standardRate)}
        </span>
        <Toggle size="sm" checked={item.active} onChange={(on) => void save({ active: on })} label={item.active ? 'In use' : 'Retired'} />
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          <ServiceFields value={draft} onChange={setDraft} />
          <div className="mt-3 flex justify-end">
            <Button variant="primary" size="sm" loading={saving} onClick={() => void save(bodyOf(draft))} disabled={!draft.name.trim()}>
              Save service
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceFields({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block sm:col-span-2">
        <span className="text-micro text-secondary">Name</span>
        <input className={INPUT} value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="Social media management" />
      </label>
      <label className="block">
        <span className="text-micro text-secondary">Billed</span>
        <select className={INPUT} value={value.billing} onChange={(e) => set({ billing: e.target.value as Draft['billing'] })}>
          <option value="MONTHLY">Monthly</option>
          <option value="ONE_TIME">One-time</option>
        </select>
      </label>
      <label className="block">
        <span className="text-micro text-secondary">Per</span>
        <input className={INPUT} value={value.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={30} placeholder="month, video…" />
      </label>
      <label className="block">
        <span className="text-micro text-secondary">Standard rate (₹)</span>
        <input type="number" min={0} className={INPUT} value={value.standardRate} onChange={(e) => set({ standardRate: e.target.value })} />
      </label>
      <label className="block sm:col-span-2">
        <span className="text-micro text-secondary">Category</span>
        <input className={INPUT} value={value.category} onChange={(e) => set({ category: e.target.value })} maxLength={60} placeholder="Social, Performance, Production…" />
      </label>
      <label className="block sm:col-span-2 lg:col-span-3">
        <span className="text-micro text-secondary">Description (prints under the service)</span>
        <input className={INPUT} value={value.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} />
      </label>
    </div>
  );
}

// ── Agreed client rates (phase 3) ───────────────────────────────────────────

function ClientRatesCard() {
  const [rates, setRates] = useState<ClientRateRow[] | null>(null);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ companyId: '', catalogItemId: '', rate: '', from: '', to: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  const load = () =>
    api.proposalDocs
      .clientRates()
      .then((r) => setRates(r.rates))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load the agreed rates.'));

  useEffect(() => {
    void load();
    api.companies
      .list()
      .then((r) => setCompanies(r.companies.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => undefined);
    api.proposalDocs
      .catalog(true)
      .then((r) => setServices(r.items))
      .catch(() => undefined);
  }, []);

  const add = async () => {
    setSaving(true);
    try {
      await api.proposalDocs.addClientRate({
        companyId: form.companyId,
        catalogItemId: form.catalogItemId,
        agreedRate: Number(form.rate),
        ...(form.from ? { validFrom: form.from } : {}),
        validTo: form.to || null,
        note: form.note.trim() || null,
      });
      toast.success('Agreed rate saved');
      setAdding(false);
      setForm({ companyId: '', catalogItemId: '', rate: '', from: '', to: '', note: '' });
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the agreed rate.');
    } finally {
      setSaving(false);
    }
  };

  const end = async (r: ClientRateRow) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.proposalDocs.updateClientRate(r.id, { validTo: today < r.validFrom ? r.validFrom : today });
      toast.success(`${r.company.name}'s rate for ${r.service.name} ends today`);
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not end that rate.');
    }
  };

  const shown = (rates ?? []).filter((r) => showEnded || r.active || r.validFrom > new Date().toISOString().slice(0, 10));
  const canAdd = form.companyId && form.catalogItemId && Number(form.rate) > 0;

  return (
    <SectionCard
      title="Agreed client rates"
      description="A rate agreed with one client for one service: a partner rate, a renewal price. A proposal for that client uses it before the standard rate while it holds."
    >
      {loadError && <ErrorNote>{loadError}</ErrorNote>}
      {rates && shown.length === 0 && !adding && <p className="text-sm text-secondary">No agreed rates. Every client gets the standard rates.</p>}
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-micro text-secondary">
                <th className="py-1.5 font-medium">Client</th>
                <th className="py-1.5 font-medium">Service</th>
                <th className="py-1.5 text-right font-medium">Rate</th>
                <th className="py-1.5 font-medium pl-4">Holds</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`border-t border-border ${r.active ? '' : 'opacity-60'}`}>
                  <td className="py-2 font-semibold text-primary">{r.company.name}</td>
                  <td className="py-2 text-body">
                    {r.service.name}
                    {r.note && <span className="block text-micro text-secondary">{r.note}</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-primary">
                    {formatMoney(r.agreedRate)}
                    <span className="text-micro text-secondary"> / {r.service.unit}</span>
                  </td>
                  <td className="py-2 pl-4 text-xs text-secondary">
                    {formatDate(r.validFrom, undefined, undefined, true)} to {r.validTo ? formatDate(r.validTo, undefined, undefined, true) : 'until ended'}
                  </td>
                  <td className="py-2 text-right">
                    {r.active && !r.validTo && (
                      <Button size="sm" variant="ghost" onClick={() => void end(r)}>
                        End it
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rates && rates.some((r) => !r.active) && (
        <button type="button" onClick={() => setShowEnded((v) => !v)} className="text-xs text-secondary hover:text-primary">
          {showEnded ? 'Hide ended rates' : 'Show ended rates'}
        </button>
      )}

      {adding ? (
        <div className="rounded-xl border border-primary/30 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-micro text-secondary">Client</span>
              <select className={INPUT} value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
                <option value="">Choose a client…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-micro text-secondary">Service</span>
              <select className={INPUT} value={form.catalogItemId} onChange={(e) => setForm({ ...form, catalogItemId: e.target.value })}>
                <option value="">Choose a service…</option>
                {services.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.standardRate != null ? ` (standard ${formatMoney(c.standardRate)})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-micro text-secondary">Agreed rate (₹)</span>
              <input type="number" min={0} className={INPUT} value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-micro text-secondary">From</span>
                <input type="date" className={INPUT} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-micro text-secondary">Until (optional)</span>
                <input type="date" className={INPUT} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </label>
            </div>
            <label className="block sm:col-span-2">
              <span className="text-micro text-secondary">Why (optional)</span>
              <input className={INPUT} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} placeholder="e.g. Partner rate through Vyoma" />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={saving} disabled={!canAdd} onClick={() => void add()}>
              Save agreed rate
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
          Add an agreed rate
        </Button>
      )}
    </SectionCard>
  );
}
