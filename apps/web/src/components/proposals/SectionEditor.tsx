'use client';

/**
 * The words of a proposal, section by section.
 *
 * Saves itself a moment after you stop typing, so the preview beside it keeps
 * up. Prices are not typed here: the Investment section is drawn from the
 * Pricing tab, and Finalise refuses text that names a rupee figure the line
 * items do not back.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type ProposalDoc, type ProposalDocResponse, type ProposalSection } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';

const INPUT =
  'w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:bg-subtle disabled:text-secondary';

/** What each section is for, under its title while it is empty. */
const PROMPT: Partial<Record<ProposalSection['type'], string>> = {
  COVER: 'A line under the title, if you want one. The client, the date and the reference print on their own.',
  INTRO: 'Who the studio is, in a short paragraph.',
  UNDERSTANDING: 'What the client told you: where they are, what they want, what is in the way.',
  SCOPE: 'What you will do each month or for the project. A line starting "- " becomes a bullet.',
  TIMELINE: 'When things happen: the first 30 days, launch dates, review points.',
  TERMS: 'One term per line, each starting "- ".',
  NEXT_STEPS: 'What the client does to start.',
  CUSTOM: 'Anything else the client should read.',
};

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export function SectionEditor({
  doc,
  editable,
  onSaved,
}: {
  doc: ProposalDoc;
  editable: boolean;
  onSaved: (res: ProposalDocResponse) => void;
}) {
  const [title, setTitle] = useState(doc.title ?? '');
  const [sections, setSections] = useState<ProposalSection[]>(doc.sections);
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  // Counts edits. Nothing is saved until somebody has changed something.
  const [edits, setEdits] = useState(0);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const changeTitle = (v: string) => {
    setTitle(v);
    setState('unsaved');
    setEdits((n) => n + 1);
  };
  const changeSections = (fn: (list: ProposalSection[]) => ProposalSection[]) => {
    setSections(fn);
    setState('unsaved');
    setEdits((n) => n + 1);
  };

  // A moment after the last keystroke, save — and the preview follows.
  useEffect(() => {
    if (!edits || !editable) return;
    const t = setTimeout(async () => {
      if (!title.trim()) {
        setState('error');
        setError('Give the proposal a title.');
        return;
      }
      setState('saving');
      try {
        const res = await api.proposalDocs.save(doc.id, { title: title.trim(), sections });
        setError(null);
        setState('saved');
        onSavedRef.current(res);
      } catch (e) {
        setState('error');
        setError(e instanceof ApiError ? e.message : 'Could not save. Check your connection and keep typing to try again.');
      }
    }, 900);
    return () => clearTimeout(t);
    // Keyed on the edit count: title and sections are read as they stand then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, editable, doc.id]);

  const update = (i: number, patch: Partial<ProposalSection>) =>
    changeSections((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) =>
    changeSections((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addSection = () =>
    changeSections((list) => [
      ...list,
      { id: `custom-${Date.now().toString(36)}`, type: 'CUSTOM', title: 'New section', body: '', visible: true },
    ]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <label className="block min-w-0 flex-1">
          <span className="eyebrow mb-1.5 block text-secondary">Title</span>
          <input
            className={`${INPUT} text-base font-semibold text-primary`}
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            disabled={!editable}
            maxLength={160}
          />
        </label>
        {editable && (
          <span
            aria-live="polite"
            className={`shrink-0 pb-2.5 text-micro ${state === 'error' ? 'text-danger' : 'text-secondary'}`}
          >
            {state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Editing…' : state === 'error' ? 'Not saved' : 'Saved'}
          </span>
        )}
      </div>
      {error && <p className="text-micro text-danger">{error}</p>}

      <ol className="space-y-3">
        {sections.map((s, i) => {
          const drawn = s.type === 'COMMERCIAL';
          return (
            <li
              key={s.id}
              className={`rounded-2xl border bg-white p-4 transition-opacity ${s.visible ? 'border-border' : 'border-dashed border-border opacity-60'}`}
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label="Section title"
                  className={`${INPUT} min-w-0 flex-1 font-semibold text-primary`}
                  value={s.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  disabled={!editable || s.type === 'COVER'}
                  maxLength={120}
                />
                {editable && (
                  <div className="flex shrink-0 items-center">
                    <IconButton label={s.visible ? 'Hide from the proposal' : 'Show in the proposal'} onClick={() => update(i, { visible: !s.visible })}>
                      {s.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </IconButton>
                    <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === sections.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </IconButton>
                    {s.type === 'CUSTOM' && (
                      <IconButton label="Remove section" onClick={() => changeSections((list) => list.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    )}
                  </div>
                )}
              </div>
              {drawn ? (
                <p className="mt-3 rounded-xl bg-subtle px-3 py-2.5 text-xs text-secondary">
                  Drawn from the Pricing tab: the services, the monthly and one-time fees, and GST. Prices never go in the text.
                </p>
              ) : (
                <textarea
                  aria-label={`${s.title} text`}
                  className={`${INPUT} mt-3 min-h-[5.5rem] resize-y leading-relaxed`}
                  rows={s.type === 'COVER' ? 2 : Math.min(14, Math.max(4, s.body.split('\n').length + 1))}
                  value={s.body}
                  placeholder={PROMPT[s.type]}
                  onChange={(e) => update(i, { body: e.target.value })}
                  disabled={!editable}
                />
              )}
            </li>
          );
        })}
      </ol>

      {editable && (
        <Button variant="ghost" icon={Plus} onClick={addSection}>
          Add a section
        </Button>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-subtle hover:text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </button>
  );
}
