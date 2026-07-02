'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { format, formatDistanceToNow } from 'date-fns';
import { getInitials, getAvatarColor } from '@/lib/utils';
import {
  ArrowRight, Phone, Calendar, Pencil, Mail, Send, IndianRupee, FileText, CheckSquare,
  Brain, UserPlus, Clock, Sparkles, Plus, Activity as ActivityIcon,
} from 'lucide-react';
import { AddActivityModal } from './AddActivityModal';

const FILTERS = [
  { key: 'all', label: 'All' }, { key: 'calls', label: 'Calls' }, { key: 'meetings', label: 'Meetings' },
  { key: 'messages', label: 'Messages' }, { key: 'payments', label: 'Payments' }, { key: 'notes', label: 'Notes' }, { key: 'system', label: 'System' },
];

const ICONS: Record<string, any> = {
  STAGE_CHANGED: ArrowRight, STATUS_CHANGED: ArrowRight, CALL_LOGGED: Phone, MEETING_LOGGED: Calendar,
  NOTE_ADDED: Pencil, EMAIL_LOGGED: Mail, MESSAGE_SENT: Send, PAYMENT_RECEIVED: IndianRupee,
  DOCUMENT_UPLOADED: FileText, QUOTE_GENERATED: FileText, TASK_CREATED: CheckSquare, TASK_COMPLETED: CheckSquare,
  INTELLIGENCE_RUN: Brain, CONTACT_ADDED: UserPlus, ONBOARDING_ITEM_COMPLETED: CheckSquare,
  FOLLOW_UP_SET: Clock, LEAD_CREATED: Sparkles, LEAD_UPDATED: Pencil,
};

type Activity = { id: string; type: string; message: string; metadata?: any; createdAt: string; user?: { name: string; avatar?: string } };

export function TimelineTab({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('all');
  const [items, setItems] = useState<Activity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async (skip: number) => {
    const r = await api.get<{ activities: Activity[]; total: number; hasMore: boolean }>(`/crm/leads/${leadId}/activity?category=${category}&skip=${skip}&take=20`);
    setHasMore(r.hasMore);
    setItems((prev) => (skip === 0 ? r.activities : [...prev, ...r.activities]));
    setLoading(false);
  }, [leadId, category]);

  useEffect(() => { setLoading(true); load(0); }, [load]);

  // Live-prepend new events for this lead (only meaningful on the unfiltered view).
  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;
    const handler = (payload: any) => {
      if (payload?.leadId !== leadId || !payload?.activity) return;
      if (category === 'all') {
        setItems((prev) => (prev.some((a) => a.id === payload.activity.id) ? prev : [payload.activity, ...prev]));
      } else {
        load(0); // re-apply the active filter so matching events still surface live
      }
    };
    sse.on('activity:created', handler);
    return () => sse.off('activity:created', handler);
  }, [leadId, category, load]);

  return (
    <div className="bg-white rounded-2xl border border-border p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 mb-5">
        <h2 className="text-base font-semibold text-primary flex items-center gap-2"><ActivityIcon className="w-4 h-4 text-secondary" /> Activity Timeline</h2>
        <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-gray-800 transition-colors">
          <Plus className="w-4 h-4" /> Add Activity
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex gap-1.5 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setCategory(f.key)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${category === f.key ? 'bg-primary text-white' : 'bg-gray-50 text-secondary hover:text-primary border border-border'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-secondary">No activity yet.</p>
      ) : (
        <div className="relative border-l-2 border-gray-100 ml-3 space-y-6 pb-2">
          {items.map((a) => {
            const Icon = ICONS[a.type] || ActivityIcon;
            const body = a.metadata?.body || a.metadata?.notes;
            const extras = [
              a.metadata?.duration ? `${a.metadata.duration} min` : null,
              a.metadata?.attendees ? `With ${a.metadata.attendees}` : null,
              a.metadata?.nextStep ? `Next: ${a.metadata.nextStep}` : null,
              a.metadata?.subject ? `Subject: ${a.metadata.subject}` : null,
            ].filter(Boolean);
            return (
              <div key={a.id} className="relative pl-6">
                <div className="absolute -left-3.25 top-0 w-6 h-6 rounded-full bg-white border border-border flex items-center justify-center ring-4 ring-white">
                  <Icon className="w-3 h-3 text-secondary" />
                </div>
                <div className="flex items-center gap-2 mb-0.5">
                  <div className={`hidden md:flex w-5 h-5 rounded-full items-center justify-center text-[9px] font-bold ${a.user ? getAvatarColor(a.user.name) : 'bg-gray-100 text-gray-400'}`}>{a.user ? getInitials(a.user.name) : '•'}</div>
                  <p className="text-sm text-primary"><span className="font-medium">{a.user?.name || 'System'}</span> <span className="text-[#4B5563]">{a.message}</span></p>
                </div>
                <p className="text-xs text-secondary ml-7" title={format(new Date(a.createdAt), 'PPpp')}>{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</p>
                {extras.length > 0 && <p className="ml-7 mt-1 text-xs text-secondary">{extras.join(' · ')}</p>}
                {body && <div className="ml-7 mt-2 p-3 bg-gray-50 rounded-xl text-sm text-[#4B5563] border border-gray-100 whitespace-pre-wrap">{body}</div>}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <div className="mt-6 flex justify-center">
          <button onClick={() => load(items.length)} className="px-4 py-2 text-sm font-medium text-secondary bg-gray-50 border border-border rounded-lg hover:text-primary transition-colors">Load more</button>
        </div>
      )}

      <AnimatePresence>
        {modalOpen && (
          <AddActivityModal leadId={leadId} onClose={() => setModalOpen(false)} onSuccess={() => { setModalOpen(false); setCategory('all'); load(0); queryClient.invalidateQueries({ queryKey: ['lead', leadId] }); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
