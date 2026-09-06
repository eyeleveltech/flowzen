'use client';

import Link from 'next/link';
import type { DuplicateVerdict } from '@/lib/api-v2';

/**
 * "This company is already here" — and WHICH one.
 *
 * The server has always sent the match: id, name, and why it matched. Both the
 * new-company and edit-company screens kept only `error.message`, so the reader
 * was told "a company with a similar name already exists" and could not learn
 * which one, open it, or get past it. One component so the two screens cannot
 * drift into saying different things about the same rule.
 *
 * Two verdicts, and the difference matters (§3.12):
 *
 *   BLOCK  exact email or phone. The same company, typed twice. No way past.
 *   WARN   similar name. "Sharma Traders" and "Sharma Trading" really can be two
 *          customers, so this offers a way through — because a rule with no way
 *          through is one people route around by misspelling the name on purpose.
 */
export function DuplicateNotice({
  verdict,
  checking,
  force,
  onForce,
}: {
  verdict: DuplicateVerdict | null;
  checking?: boolean;
  /** Whether the person has already chosen to go ahead despite a name warning. */
  force: boolean;
  onForce: (value: boolean) => void;
}) {
  if (checking && !verdict) {
    return <p className="-mt-2 text-xs text-secondary">Checking whether they are already here…</p>;
  }

  if (!verdict?.matches?.length) return null;

  const blocked = verdict.action === 'BLOCK';

  return (
    <div
      className={`-mt-2 rounded-xl border px-3.5 py-3 text-sm ${
        blocked
          ? 'border-danger/30 bg-danger-tint text-danger'
          : 'border-warning/30 bg-warning-tint text-warning-ink'
      }`}
    >
      <p className="font-semibold">
        {blocked
          ? 'This company is already in Flowzen.'
          : 'A company with a very similar name already exists.'}
      </p>

      <ul className="mt-1.5 space-y-1">
        {verdict.matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* A new tab, deliberately: opening the existing record must not
                throw away everything already typed into this form. */}
            <Link
              href={`/companies/${m.id}`}
              target="_blank"
              className="font-semibold underline underline-offset-2"
            >
              {m.name}
            </Link>
            <span className="text-xs opacity-80">
              {m.reason === 'email'
                ? `same email — ${m.matchedOn}`
                : m.reason === 'phone'
                  ? `same phone — ${m.matchedOn}`
                  : 'similar name'}
            </span>
          </li>
        ))}
      </ul>

      {blocked ? (
        <p className="mt-2 text-xs">
          An exact email or phone match is the same company. Open the record above and add what you
          need to it — or change the email and phone here, if this really is somebody else.
        </p>
      ) : force ? (
        <p className="mt-2 text-xs font-medium">
          Saving it as a separate company.{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => onForce(false)}>
            Undo
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs">
          Two businesses really can have similar names.{' '}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => onForce(true)}
          >
            Keep it as a separate company
          </button>
        </p>
      )}
    </div>
  );
}
