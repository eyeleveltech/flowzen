'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { formatDate, toDateInput } from '@/lib/utils';

/**
 * Hours logged against a task.
 *
 * Deliberately a LIST of dated entries rather than one "hours spent" box. A single total can only
 * be overwritten — you cannot see that Tuesday was four hours and Thursday was one, you cannot
 * tell whose hours they were, and a mistake can only be replaced, never corrected. The rolled-up
 * cost of a client depends on all three, so the entries are the record and the total is derived.
 *
 * There is no timer here and no cost shown. The point of this data is answering "did this client
 * make us money", not policing how long anyone took, and the API strips cost from the response
 * for everyone but an admin regardless of what this component asks for.
 */
export function TaskTimeLog({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hours, setHours] = useState('');
  // Defaults to today, but editable — hours are usually filled in a day or two late, and the
  // entry has to land on the day the work HAPPENED or every weekly total is wrong.
  const [date, setDate] = useState(toDateInput(new Date().toISOString()));
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ entries: any[]; totalHours: number }>(`/time-entries?taskId=${taskId}`);
      setEntries(r.entries || []);
      setTotalHours(r.totalHours || 0);
    } catch {
      /* a task with no time is the normal case, not an error worth shouting about */
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const parsed = parseFloat(hours);
    if (isNaN(parsed) || parsed <= 0) { toast.error('Enter how many hours you spent'); return; }
    if (parsed > 24) { toast.error('A single entry cannot exceed 24 hours'); return; }
    setSaving(true);
    try {
      await api.post('/time-entries', { taskId, hours: parsed, date, note: note.trim() || undefined });
      setHours(''); setNote('');
      await load();
      onChanged?.();
      toast.success('Time logged');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to log time');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.delete(`/time-entries/${id}`);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove entry');
    }
  };

  return (
    <div className="mt-8 border-t border-subtle pt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
          <Clock className="h-4 w-4 text-secondary" /> Time Logged
        </h3>
        {totalHours > 0 && (
          <span className="text-xs font-semibold text-primary bg-subtle border border-border px-2 py-0.5 rounded-md tabular-nums">
            {totalHours}h total
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div className="w-24">
          <label htmlFor="tl-hours" className="block text-[11px] font-medium text-secondary mb-1">Hours</label>
          <input
            id="tl-hours" type="number" step="0.25" min="0" max="24"
            value={hours} onChange={(e) => setHours(e.target.value)} placeholder="1.5"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="w-40">
          <label htmlFor="tl-date" className="block text-[11px] font-medium text-secondary mb-1">Date</label>
          <input
            id="tl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1 min-w-40">
          <label htmlFor="tl-note" className="block text-[11px] font-medium text-secondary mb-1">Note (optional)</label>
          <input
            id="tl-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={add} disabled={saving}
          className="bg-primary text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-black transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Log Time'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-secondary italic py-2">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-secondary italic py-2">No time logged on this task yet.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface">
              <span className="text-sm font-semibold text-primary tabular-nums w-14 shrink-0">{Number(e.hours)}h</span>
              <span className="text-xs text-secondary w-24 shrink-0">{formatDate(e.date)}</span>
              <span className="text-xs font-medium text-body shrink-0">{e.user?.name}</span>
              {e.note && <span className="text-xs text-secondary truncate flex-1">{e.note}</span>}
              <button
                onClick={() => remove(e.id)}
                className="ml-auto p-1 text-secondary hover:text-red-500 rounded shrink-0"
                aria-label={`Remove ${Number(e.hours)} hour entry`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
