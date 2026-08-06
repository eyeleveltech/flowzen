'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useUIStore, useAuthStore } from '@/stores';
import { getClientDisplayName } from '@/lib/utils';
import { api } from '@/lib/api';
import { leadStageLabel } from '@/lib/lead-stage';
import {
  Search,
  Users,
  FolderKanban,
  CheckSquare,
  UsersRound,
  TrendingUp,
  FileText,
  ArrowRight,
  X,
} from 'lucide-react';

interface SearchResults {
  clients: { id: string; name: string; company?: string; status: string }[];
  projects: { id: string; name: string; status: string; client: { name: string } }[];
  tasks: { id: string; title: string; status: string; project: { name: string } }[];
  members: { id: string; name: string; email: string; role: string }[];
  leads?: { id: string; leadId?: string; companyName?: string; contactName?: string; stage: string }[];
  quotes?: { id: string; documentNumber: string; clientName: string; status: string; documentType: string }[];
}

interface FlatItem {
  id: string;
  label: string;
  sub: string;
  href: string;
}

export function CommandPalette() {
  const shouldReduceMotion = useReducedMotion();
  const router = useRouter();
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const { user: currentUser } = useAuthStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`);
      setResults(data);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const isCrmRole = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';
  const showMembers = currentUser?.role !== 'TEAM_MEMBER';

  // The sections in the exact order they render — drives both the list UI and keyboard
  // navigation, so ↑↓ always moves through what's actually on screen.
  const sections = useMemo(() => {
    if (!results) return [] as { title: string; icon: typeof Users; items: FlatItem[] }[];
    const s: { title: string; icon: typeof Users; items: FlatItem[] }[] = [];
    if (isCrmRole && results.leads && results.leads.length > 0) {
      s.push({
        title: 'Leads',
        icon: TrendingUp,
        items: results.leads.map((l) => ({
          id: l.id,
          label: l.companyName || l.contactName || l.leadId || 'Lead',
          sub: [l.contactName && l.companyName ? l.contactName : null, leadStageLabel(l.stage)].filter(Boolean).join(' · '),
          href: `/pipeline/${l.id}`,
        })),
      });
    }
    if (results.clients.length > 0) {
      s.push({
        title: 'Clients',
        icon: Users,
        items: results.clients.map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.company || '',
          href: `/clients/${c.id}`,
        })),
      });
    }
    if (results.projects.length > 0) {
      s.push({
        title: 'Projects',
        icon: FolderKanban,
        items: results.projects.map((p) => ({
          id: p.id,
          label: p.name,
          sub: p.client ? getClientDisplayName(p.client) : 'Internal',
          href: `/projects/${p.id}`,
        })),
      });
    }
    if (results.tasks.length > 0) {
      s.push({
        title: 'Tasks',
        icon: CheckSquare,
        items: results.tasks.map((t) => ({
          id: t.id,
          label: t.title,
          sub: t.project?.name || '',
          // The tasks page opens the detail drawer from ?taskId= — ?highlight= was a dead link.
          href: `/tasks?taskId=${t.id}`,
        })),
      });
    }
    if (isCrmRole && results.quotes && results.quotes.length > 0) {
      s.push({
        title: 'Quotations',
        icon: FileText,
        items: results.quotes.map((q) => ({
          id: q.id,
          label: q.documentNumber,
          sub: `${q.clientName} · ${q.status}`,
          href: '/quotations',
        })),
      });
    }
    if (showMembers && results.members.length > 0) {
      s.push({
        title: 'Team',
        icon: UsersRound,
        items: results.members.map((m) => ({
          id: m.id,
          label: m.name,
          sub: m.email,
          href: `/members?memberId=${m.id}`,
        })),
      });
    }
    return s;
  }, [results, isCrmRole, showMembers]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Keep the selection inside the current result set.
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const navigate = useCallback((path: string) => {
    router.push(path);
    setCommandPaletteOpen(false);
    setQuery('');
    setResults(null);
  }, [router, setCommandPaletteOpen]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }
      if (!commandPaletteOpen) return;
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        return;
      }
      // The footer promises ↑↓/↵ — deliver it.
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (flatItems.length ? (i + 1) % flatItems.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (flatItems.length ? (i - 1 + flatItems.length) % flatItems.length : 0));
      } else if (e.key === 'Enter') {
        const item = flatItems[selectedIndex];
        if (item) {
          e.preventDefault();
          navigate(item.href);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, flatItems, selectedIndex, navigate]);

  const hasResults = flatItems.length > 0;

  // Global running index so highlight + keyboard selection line up across sections.
  let runningIndex = 0;

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
            onClick={() => setCommandPaletteOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -20 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 rounded-2xl border border-border bg-white shadow-modal shadow-black/10"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-sunken">
              <Search className="h-5 w-5 text-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isCrmRole ? 'Search leads, clients, projects, tasks, quotes...' : 'Search clients, projects, tasks, team...'}
                className="flex-1 text-sm text-primary placeholder:text-secondary outline-none bg-transparent"
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults(null); }} className="p-1 rounded-lg hover:bg-surface-sunken">
                  <X className="h-4 w-4 text-secondary" />
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto p-2">
              {loading && (
                <div className="py-8 text-center text-sm text-secondary">Searching...</div>
              )}

              {!loading && query.length >= 2 && !hasResults && (
                <div className="py-8 text-center text-sm text-secondary">No results found</div>
              )}

              {!loading && query.length < 2 && (
                <div className="py-8 text-center text-sm text-secondary">Type at least 2 characters to search</div>
              )}

              {hasResults && (
                <div className="space-y-2">
                  {sections.map((section) => {
                    const startIndex = runningIndex;
                    runningIndex += section.items.length;
                    return (
                      <ResultSection
                        key={section.title}
                        title={section.title}
                        icon={section.icon}
                        items={section.items}
                        startIndex={startIndex}
                        selectedIndex={selectedIndex}
                        onHover={setSelectedIndex}
                        onNavigate={navigate}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-surface-sunken text-xs text-secondary">
              <span>↑↓ Navigate</span>
              <span>↵ Open</span>
              <span>ESC Close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function ResultSection({
  title,
  icon: Icon,
  items,
  startIndex,
  selectedIndex,
  onHover,
  onNavigate,
}: {
  title: string;
  icon: typeof Users;
  items: FlatItem[];
  startIndex: number;
  selectedIndex: number;
  onHover: (index: number) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-secondary uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {items.map((item, i) => {
        const globalIndex = startIndex + i;
        const isSelected = globalIndex === selectedIndex;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.href)}
            onMouseEnter={() => onHover(globalIndex)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors group ${isSelected ? 'bg-surface-sunken' : 'hover:bg-[#F9FAFB]'}`}
          >
            <span className="text-primary font-medium truncate">{item.label}</span>
            <span className="text-secondary text-xs truncate">{item.sub}</span>
            <ArrowRight className={`h-3.5 w-3.5 ml-auto shrink-0 text-[#D1D5DB] transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
          </button>
        );
      })}
    </div>
  );
}
