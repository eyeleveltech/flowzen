'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useUIStore } from '@/stores';
import { api } from '@/lib/api-v2';
import {
  Search,
  Building2,
  FolderKanban,
  CheckSquare,
  TrendingUp,
  FileText,
  Receipt,
  ArrowRight,
  X,
} from 'lucide-react';

/**
 * What one search box finds.
 *
 * Quotations and invoices are only searched for people allowed to see money, and
 * that is decided by the SERVER — this component never filters by role, so a
 * mistake here cannot expose a figure (master plan §5).
 */
interface SearchResults {
  companies: { id: string; name: string; status: string }[];
  deals: { id: string; title: string | null; company: { name: string }; stage: { name: string } }[];
  projects: { id: string; name: string; company: { name: string } }[];
  /** The API works out where a task links to — it belongs to a project OR a deal. */
  tasks: { id: string; title: string; context: string; href: string }[];
  quotes: { id: string; number: string; company: { name: string } }[];
  invoices: { id: string; number: string; company: { name: string } }[];
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
      setResults(await api.search(q));
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

  // The sections in the exact order they render — drives both the list UI and
  // keyboard navigation, so up/down always moves through what is on screen.
  const sections = useMemo(() => {
    if (!results) return [] as { title: string; icon: typeof Building2; items: FlatItem[] }[];
    const s: { title: string; icon: typeof Building2; items: FlatItem[] }[] = [];

    if (results.companies.length) {
      s.push({
        title: 'Clients',
        icon: Building2,
        items: results.companies.map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.status.toLowerCase().replace('_', ' '),
          href: `/clients/${c.id}`,
        })),
      });
    }
    if (results.deals.length) {
      s.push({
        title: 'Deals',
        icon: TrendingUp,
        items: results.deals.map((d) => ({
          id: d.id,
          label: d.title ?? 'Untitled deal',
          sub: `${d.company.name} · ${d.stage.name}`,
          href: `/pipeline/${d.id}`,
        })),
      });
    }
    if (results.projects.length) {
      s.push({
        title: 'Projects',
        icon: FolderKanban,
        items: results.projects.map((p) => ({
          id: p.id,
          label: p.name,
          sub: p.company.name,
          href: `/projects/${p.id}`,
        })),
      });
    }
    if (results.tasks.length) {
      s.push({
        title: 'Tasks',
        icon: CheckSquare,
        items: results.tasks.map((t) => ({ id: t.id, label: t.title, sub: t.context, href: t.href })),
      });
    }
    if (results.quotes.length) {
      s.push({
        title: 'Quotations',
        icon: FileText,
        items: results.quotes.map((q) => ({
          id: q.id,
          label: q.number,
          sub: q.company.name,
          href: '/quotations',
        })),
      });
    }
    if (results.invoices.length) {
      s.push({
        title: 'Invoices',
        icon: Receipt,
        items: results.invoices.map((i) => ({
          id: i.id,
          label: i.number,
          sub: i.company.name,
          href: '/revenue',
        })),
      });
    }
    return s;
  }, [results]);

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
            <div className="flex items-center gap-3 px-5 py-4 border-b border-subtle">
              <Search className="h-5 w-5 text-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients, deals, projects, tasks, documents…"
                className="flex-1 text-sm text-primary placeholder:text-secondary outline-none bg-transparent"
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults(null); }} className="p-1 rounded-lg hover:bg-subtle">
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
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-subtle text-xs text-secondary">
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
  icon: typeof Building2;
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
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors group ${isSelected ? 'bg-subtle' : 'hover:bg-surface'}`}
          >
            <span className="text-primary font-medium truncate">{item.label}</span>
            <span className="text-secondary text-xs truncate">{item.sub}</span>
            <ArrowRight className={`h-3.5 w-3.5 ml-auto shrink-0 text-line transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
          </button>
        );
      })}
    </div>
  );
}
