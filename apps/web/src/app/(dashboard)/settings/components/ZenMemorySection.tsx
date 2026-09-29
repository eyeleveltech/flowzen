'use client';

/**
 * What Zen has learned about how you work.
 *
 * Shown, because a memory nobody can read is a memory nobody can correct. Zen
 * writes these itself when somebody tells it a preference — who design work
 * goes to, that a due date should be a date and not "next week" — and the
 * failure mode of any such feature is a wrong note repeated with confidence
 * for months. One list and a bin fixes that.
 *
 * Deliberately not facts about clients or money: those come from the tools,
 * which read the database as it is this second. A remembered figure goes stale
 * and then contradicts the thing that fetched it, which is worse than not
 * remembering at all.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';

export function ZenMemorySection() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['zen-memory'],
    queryFn: () => api.assistant.memory(),
  });
  const memories = data?.memories ?? [];

  const forget = async (id: string, text: string) => {
    try {
      await api.assistant.forget(id);
      toast.success('Forgotten');
      void queryClient.invalidateQueries({ queryKey: ['zen-memory'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Could not forget "${text.slice(0, 30)}…"`);
    }
  };

  return (
    <SectionCard
      title="What Zen remembers"
      description="Preferences it has picked up from talking to you — how you like things done, not facts about clients or money. Those it looks up fresh every time."
    >
      {isPending ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-secondary">
          Nothing yet. Tell Zen how you like something done — who design work usually goes to, say — and it will keep
          that.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {memories.map((m) => (
            <li key={m.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-primary">{m.text}</p>
                <p className="mt-0.5 text-micro text-secondary">Learned {formatDate(m.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => void forget(m.id, m.text)}
                aria-label={`Forget: ${m.text}`}
                title="Forget this"
                className="shrink-0 rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
