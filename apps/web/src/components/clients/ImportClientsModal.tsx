'use client';

/**
 * Import a spreadsheet of companies.
 *
 * §4.4 lists three ways a company enters — typed in, imported from a CSV, or
 * posted by the API — and only the first existed.
 *
 * The screen is built around one rule: **nothing is written until somebody has
 * seen what will happen.** The file is sent once as a dry run, which applies
 * every rule the real import applies — the duplicate check included, and against
 * the other rows in the same file — and reports each row's outcome without
 * touching the database. Only then does the import button appear.
 *
 * That matters more here than anywhere else in Flowzen. Every other create is
 * one record a person is looking at; this is two hundred they are not.
 */

import { useState } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api, ApiError, type ImportResult } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Note } from '@/components/ui/empty-state';

// Only what actually lands somewhere. `size` and `follow up` used to be
// listed here and there is no column for either, so the file was promising to
// read two things it then silently dropped.
const RECOGNISED =
  'name, contact name, email, phone, website, industry, address, city, state, zip, country, gst, source';

export function ImportClientsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (created: number) => void;
}) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Carries the name-similarity warnings past. Exact matches never import. */
  const [force, setForce] = useState(false);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setFileName(file.name);
    setCsv(await file.text());
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.companies.import({ csv, dryRun, force });
      if (dryRun) {
        setPreview(result);
      } else {
        onImported(result.created);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const skippedByName = preview?.results.some(
    (r) => r.action === 'SKIPPED' && r.reason?.startsWith('A company with a similar name'),
  );

  return (
    <Modal open onClose={onClose} title="Import companies" description="From a CSV export">
      <ModalBody className="space-y-4">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-4 transition-colors hover:bg-subtle">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-secondary" strokeWidth={1.75} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-primary">
              {fileName || 'Choose a CSV file'}
            </span>
            <span className="block truncate text-xs text-secondary">
              First row is the header. Recognised columns: {RECOGNISED}.
            </span>
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose a CSV of clients"
            className="sr-only"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Tally tone="good" label="will be added" value={preview.wouldCreate} />
              <Tally tone="warn" label="already known" value={preview.skipped} />
              <Tally tone="bad" label="unusable" value={preview.invalid} />
            </div>

            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs data-table">
                <tbody>
                  {preview.results.map((r) => (
                    <tr key={r.row} className="border-b border-border last:border-0">
                      <td className="w-10 text-secondary">{r.row}</td>
                      <td className="">
                        {r.action === 'WOULD_CREATE' ? (
                          <Check className="inline h-3.5 w-3.5 text-success" strokeWidth={2} />
                        ) : r.action === 'SKIPPED' ? (
                          <AlertTriangle className="inline h-3.5 w-3.5 text-warning-ink" strokeWidth={2} />
                        ) : (
                          <X className="inline h-3.5 w-3.5 text-danger" strokeWidth={2} />
                        )}
                      </td>
                      <td className="font-medium text-primary">{r.name || '—'}</td>
                      <td className="text-secondary">{r.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {skippedByName && (
              <label className="flex items-start gap-2 text-xs text-body">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => {
                    setForce(e.target.checked);
                    setPreview(null);
                  }}
                  className="mt-0.5"
                />
                <span>
                  Add the ones flagged only for a <strong>similar name</strong>. Rows matching an
                  existing email or phone are never imported.
                </span>
              </label>
            )}
          </div>
        )}

        {!preview && csv && (
          <Note>Nothing is written until you have seen the preview.</Note>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {preview ? (
          <Button
            variant="primary"
            icon={Upload}
            loading={busy}
            disabled={preview.wouldCreate === 0}
            onClick={() => void run(false)}
          >
            {preview.wouldCreate === 0
              ? 'Nothing to add'
              : `Add ${preview.wouldCreate} ${preview.wouldCreate === 1 ? 'company' : 'companies'}`}
          </Button>
        ) : (
          <Button variant="primary" loading={busy} disabled={!csv} onClick={() => void run(true)}>
            Check the file
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

const TONE = {
  good: 'border-success/30 bg-success-tint text-success',
  warn: 'border-warning/30 bg-warning-tint text-warning-ink',
  bad: 'border-danger/30 bg-danger-tint text-danger',
} as const;

function Tally({ tone, label, value }: { tone: keyof typeof TONE; label: string; value: number }) {
  if (value === 0) return null;
  return (
    <span className={`rounded-full border px-2.5 py-1 ${TONE[tone]}`}>
      <strong>{value}</strong> {label}
    </span>
  );
}
