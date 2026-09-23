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

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api, ApiError, type ImportResult } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Note } from '@/components/ui/empty-state';

/*
 * The columns are no longer written down here.
 *
 * They were — a single string listing thirteen names — and it had drifted from
 * the parser twice over: it promised `country` and `zip`, which land nowhere on
 * their own, and said nothing about `status`, which decides whether an imported
 * company is a prospect or somebody you already work with. A list the server
 * does not own describes the importer as it was when somebody last remembered
 * to edit this file, so it comes from `/companies/import/rules` now.
 */
type Rule = { column: string; also: string[]; required: boolean; note: string };

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
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [showRules, setShowRules] = useState(false);

  // Not fatal if it fails: the template download and the file picker both still
  // work, and the rules are in the template itself as comment lines.
  useEffect(() => {
    let cancelled = false;
    void api.companies
      .importRules()
      .then((r) => {
        if (!cancelled) setRules(r.rules);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
              First row is the header. One row per company.
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

        {/*
          * Somewhere to start, and the rules, before a file is chosen.
          *
          * An empty file picker tells you nothing about thirteen accepted
          * columns, three that silently default, and two duplicate rules — and a
          * silent default is not an error, so a wrong file looks like a
          * successful import. The template is a plain link because the browser
          * should save it; the session cookie rides along as on any other call.
          */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <a
            href={api.companies.importTemplateUrl()}
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            Download template
          </a>
          {rules && (
            <button
              type="button"
              onClick={() => setShowRules((v) => !v)}
              className="text-secondary hover:text-primary hover:underline"
              aria-expanded={showRules}
            >
              {showRules ? 'Hide the rules' : `What the columns mean (${rules.length})`}
            </button>
          )}
        </div>

        {showRules && rules && (
          <dl className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border bg-surface p-3 text-xs">
            {rules.map((r) => (
              <div key={r.column}>
                <dt className="font-medium text-body">
                  {r.column}
                  {r.required && <span className="ml-1.5 text-danger">required</span>}
                  {r.also.length > 0 && (
                    <span className="ml-1.5 font-normal text-secondary">
                      or {r.also.join(', ')}
                    </span>
                  )}
                </dt>
                <dd className="text-secondary">{r.note}</dd>
              </div>
            ))}
            <p className="border-t border-border pt-2 text-secondary">
              Retainers, project values, fees and dates are not imported — add those in the app.
            </p>
          </dl>
        )}

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
