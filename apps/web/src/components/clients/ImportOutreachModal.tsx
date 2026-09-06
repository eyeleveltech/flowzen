'use client';

/**
 * Import a spreadsheet of cold names into the Outreach list.
 *
 * §11.1 step 1: "Names imported into OutreachEntry." The button existed —
 * "Import CSV" on the Outreach screen — with nothing behind it; the CSV
 * parser it needed (`parseCsv`) was already built and tested, just never
 * wired to a route.
 *
 * Same shape as company import: a dry run first, so nothing is written until
 * someone has seen what each row will do.
 */

import { useState } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api, ApiError, type ImportResult } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Note } from '@/components/ui/empty-state';

const RECOGNISED = 'name, vertical, source';

export function ImportOutreachModal({
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
  /** Carries duplicate-within-file warnings past. A name matching an existing company or entry is never imported. */
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
      const result = await api.outreach.import({ csv, dryRun, force });
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

  const skippedByDuplicate = preview?.results.some(
    (r) => r.action === 'SKIPPED' && r.reason === 'Duplicate name within this file',
  );

  return (
    <Modal open onClose={onClose} title="Import to outreach list" description="From a CSV export">
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
            aria-label="Choose a CSV of outreach targets"
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

            {skippedByDuplicate && (
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
                  Add rows that only repeat a name <strong>within this file</strong> too. Rows
                  matching an existing company or outreach entry are never imported.
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
              : `Add ${preview.wouldCreate} ${preview.wouldCreate === 1 ? 'name' : 'names'}`}
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
