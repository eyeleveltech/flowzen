'use client';

/**
 * Import an inventory of equipment.
 *
 * The register has to be seeded once from whatever the office already owns —
 * roughly an hour of typing for sixty items, and the only way to get accurate
 * serial numbers and purchase dates in. This is that hour.
 *
 * Same rule as the client importer it mirrors: **nothing is written until
 * somebody has seen what will happen.** The file goes up once as a dry run,
 * which applies exactly the rules the real import applies and reports every
 * row it cannot read, and only then does the import button appear.
 *
 * A row it cannot read is SKIPPED and named, never fatal. A sixty-line
 * inventory that refuses to load because line 40 has a blank price is one
 * nobody imports twice.
 */

import { useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { ASSET_CATEGORY_LABEL } from '@/lib/assets';

const RECOGNISED = 'name, category, make, model, serial, purchase price, purchased at, vendor, bookable';

type DryRun = {
  dryRun: boolean;
  willCreate?: number;
  created?: number;
  problems: { row: number; reason: string }[];
  preview?: { row: number; name: string; category: string; purchasePrice: number }[];
};

export function ImportAssetsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (created: number) => void;
}) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setFileName(file.name);
    setCsv(await file.text());
  };

  const run = async (commit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.assets.import({ csv, commit });
      if (commit) onImported(result.created ?? 0);
      else setPreview(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Import equipment" size="lg">
      <ModalBody className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface px-6 py-8 text-center transition-colors hover:bg-subtle">
          <FileSpreadsheet className="h-6 w-6 text-secondary" strokeWidth={1.75} />
          <span className="text-sm font-medium text-primary">
            {fileName || 'Choose a CSV of what the office owns'}
          </span>
          <span className="text-micro text-secondary">Columns read: {RECOGNISED}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose a CSV of assets"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <Note>
          Each item gets its own tag from its category — a lens becomes EL/LEN/001 — and the
          category also sets how long it is written off over. Both stay editable afterwards.
          Categories accepted: {Object.keys(ASSET_CATEGORY_LABEL).join(', ').toLowerCase()}.
        </Note>

        {preview && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-white p-4">
              <p className="text-sm font-semibold text-primary">
                {preview.willCreate} item{preview.willCreate === 1 ? '' : 's'} will be added
              </p>
              {preview.preview && preview.preview.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {preview.preview.map((r) => (
                    <li key={r.row} className="text-xs text-secondary">
                      row {r.row}: {r.name}{' '}
                      <span className="text-micro">
                        ({ASSET_CATEGORY_LABEL[r.category] ?? r.category})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {preview.problems.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning-tint p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-warning-ink">
                  <AlertTriangle className="h-4 w-4" strokeWidth={2} />
                  {preview.problems.length} row{preview.problems.length === 1 ? '' : 's'} will be skipped
                </p>
                <ul className="mt-2 space-y-1">
                  {preview.problems.slice(0, 10).map((p) => (
                    <li key={p.row} className="text-xs text-warning-ink">
                      row {p.row}: {p.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-micro text-warning-ink">
                  The rest still import. Fix these in the file and run it again for the stragglers.
                </p>
              </div>
            )}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {preview ? (
          <Button
            type="button"
            variant="primary"
            icon={Upload}
            loading={busy}
            disabled={!preview.willCreate}
            onClick={() => void run(true)}
          >
            Import {preview.willCreate}
          </Button>
        ) : (
          <Button type="button" variant="primary" loading={busy} disabled={!csv} onClick={() => void run(false)}>
            Check the file
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
