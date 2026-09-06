'use client';

/**
 * Setup ▸ Assets.
 *
 * Two things live here and nowhere else: the tag prefix, because it is printed
 * on stickers and must be decided once; and the financial-year schedule, because
 * handing the CA a fixed-asset register is an annual administrative act rather
 * than a daily one.
 *
 * The useful-life table is shown but NOT editable. Every asset already carries
 * its own `usefulLifeMonths`, seeded from the category and overridable on the
 * record itself — which is where a disagreement with the CA actually lands, on
 * one purchase rather than on the whole category. An org-wide editor here would
 * quietly re-value everything bought under the old number, and there is no
 * screen anywhere that would show you it had happened.
 */

import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, fileUrl, type AssetRegister } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { ASSET_CATEGORY_LABEL, ASSET_CATEGORY_CODE, ASSET_USEFUL_LIFE } from '@flowzen/shared';
import { assetCategoryLabel, rupees, shortDate } from '@/lib/assets';

/** The current FY and the four before it. Nobody files six years back. */
const fyOptions = (startMonth: number) => {
  const now = new Date();
  const currentStart = now.getMonth() + 1 < startMonth ? now.getFullYear() - 1 : now.getFullYear();
  return Array.from({ length: 5 }, (_, i) => {
    const y = currentStart - i;
    const label = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    return { value: label, label };
  });
};

export function AssetsTab({
  canEdit,
  tagPrefix,
  financialYearStart,
  onSaved,
}: {
  canEdit: boolean;
  tagPrefix: string;
  financialYearStart: number;
  onSaved: () => void;
}) {
  const [prefix, setPrefix] = useState(tagPrefix);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = fyOptions(financialYearStart);
  const [fy, setFy] = useState(options[0]?.value ?? '');
  const [register, setRegister] = useState<AssetRegister | null>(null);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  useEffect(() => setPrefix(tagPrefix), [tagPrefix]);

  const loadRegister = useCallback(async () => {
    if (!fy) return;
    setLoadingRegister(true);
    setRegisterError(null);
    try {
      setRegister(await api.assets.register(fy));
    } catch (e) {
      // A 403 here is the honest answer, not a failure: the schedule needs both
      // money.figures and asset.manage, and plenty of admins have only one.
      setRegisterError(e instanceof Error ? e.message : 'Could not build the schedule');
      setRegister(null);
    } finally {
      setLoadingRegister(false);
    }
  }, [fy]);

  useEffect(() => {
    void loadRegister();
  }, [loadRegister]);

  const savePrefix = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.config.update({ assetTagPrefix: prefix.trim().toUpperCase() });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card padding="none">
        <form onSubmit={savePrefix}>
          <CardHeader>
            <CardTitle>Tag format</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
            <Field
              label="Prefix"
              value={prefix}
              onChange={setPrefix}
              disabled={!canEdit}
              hint="The first part of every tag. The category code and the number come after it."
            />
            <Note>
              A camera body will be tagged{' '}
              <span className="font-mono font-semibold">
                {(prefix || 'EL').replace(/\/+$/, '')}/CAM/001
              </span>
              . Changing this does not renumber anything already on the register — the sticker on the
              lens still says what it said.
            </Note>
          </CardBody>
          {canEdit && (
            <CardFooter>
              <Button type="submit" variant="primary" loading={saving} disabled={!prefix.trim()}>
                Save
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>How long each kind of kit is written off over</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead>
                <tr className="border-b border-border">
                  <th className="eyebrow text-left">
                    Category
                  </th>
                  <th className="eyebrow text-left">
                    Code
                  </th>
                  <th className="eyebrow text-right">
                    Months
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.keys(ASSET_CATEGORY_LABEL).map((key) => (
                  <tr key={key}>
                    <td className="text-body">{ASSET_CATEGORY_LABEL[key]}</td>
                    <td className="font-mono text-xs text-secondary">{ASSET_CATEGORY_CODE[key]}</td>
                    <td className="text-right tabular-nums text-primary">
                      {ASSET_USEFUL_LIFE[key]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 border-t border-border pt-3 text-xs text-secondary">
            These are the defaults a new item starts with, not a rule it is held to — every asset
            carries its own figure and can be changed on its own record. The shape follows Companies
            Act Schedule II; the Income Tax written-down-value rates are a different basis, and which
            one this register should mirror is worth one conversation with the CA before the first
            schedule goes out.
          </p>
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>Fixed-asset schedule</CardTitle>
          {register && (
            <a href={fileUrl(`/assets/register?fy=${fy}&format=csv`)}>
              <Button size="sm" icon={Download}>
                CSV
              </Button>
            </a>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="w-48">
            <FieldSelect label="Financial year" value={fy} onChange={setFy} options={options} />
          </div>

          {registerError && <ErrorNote>{registerError}</ErrorNote>}

          {loadingRegister ? (
            <p className="py-6 text-center text-sm text-secondary">Building it…</p>
          ) : register && register.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full data-table">
                  <thead>
                    <tr className="border-b border-border bg-surface/60">
                      <Th>Tag</Th>
                      <Th>Item</Th>
                      <Th>Bought</Th>
                      <Th right>Cost</Th>
                      <Th right>Opening WDV</Th>
                      <Th right>Depreciation</Th>
                      <Th right>Closing WDV</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {register.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="font-mono text-xs text-secondary">{r.tag}</td>
                        <td className="text-body">
                          {r.name}
                          <span className="ml-1.5 text-micro text-secondary">
                            {assetCategoryLabel(r.category)}
                          </span>
                        </td>
                        <td className="text-xs text-secondary">{shortDate(r.purchasedAt)}</td>
                        <td className="text-right tabular-nums text-body">
                          {rupees(r.purchasePrice)}
                        </td>
                        <td className="text-right tabular-nums text-body">
                          {rupees(r.openingWdv)}
                        </td>
                        <td className="text-right tabular-nums text-body">
                          {rupees(r.depreciationForYear)}
                        </td>
                        <td className="text-right tabular-nums font-semibold text-primary">
                          {rupees(r.closingWdv)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-surface/60">
                      <td className="eyebrow" colSpan={3}>
                        Total
                      </td>
                      <td className="text-right tabular-nums font-semibold text-primary">
                        {rupees(register.totals.purchasePrice)}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-primary">
                        {rupees(register.totals.openingWdv)}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-primary">
                        {rupees(register.totals.depreciationForYear)}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-primary">
                        {rupees(register.totals.closingWdv)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-secondary">
                Straight-line, computed fresh every time this is opened rather than stored — a saved
                book value is wrong the day after it is written.
              </p>
            </>
          ) : (
            !registerError && (
              <p className="py-6 text-center text-sm text-secondary">
                Nothing was on the register during {fy}.
              </p>
            )
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`eyebrow px-3 py-2 ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}
