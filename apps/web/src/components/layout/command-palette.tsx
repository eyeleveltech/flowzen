'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores';
import { getInitials, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  Search,
  Users,
  FolderKanban,
  CheckSquare,
  UsersRound,
  ArrowRight,
  X,
} from 'lucide-react';

interface SearchResults {
  clients: { id: string; name: string; company?: string; status: string }[];
  projects: { id: string; name: string; status: string; client: { name: string } }[];
  tasks: { id: string; title: string; status: string; project: { name: string } }[];
  members: { id: string; name: string; email: string; role: string }[];
}

export function CommandPalette() {
  const router = useRouter();
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  function navigate(path: string) {
    router.push(path);
    setCommandPaletteOpen(false);
    setQuery('');
    setResults(null);
  }

  const hasResults = results && (results.clients.length > 0 || results.projects.length > 0 || results.tasks.length > 0 || results.members.length > 0);

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
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl shadow-black/10"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[#F3F4F6]">
              <Search className="h-5 w-5 text-[#9CA3AF]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients, projects, tasks, team..."
                className="flex-1 text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none bg-transparent"
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults(null); }} className="p-1 rounded-lg hover:bg-[#F3F4F6]">
                  <X className="h-4 w-4 text-[#9CA3AF]" />
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto p-2">
              {loading && (
                <div className="py-8 text-center text-sm text-[#9CA3AF]">Searching...</div>
              )}

              {!loading && query.length >= 2 && !hasResults && (
                <div className="py-8 text-center text-sm text-[#9CA3AF]">No results found</div>
              )}

              {!loading && query.length < 2 && (
                <div className="py-8 text-center text-sm text-[#9CA3AF]">Type at least 2 characters to search</div>
              )}

              {hasResults && (
                <div className="space-y-2">
                  {results!.clients.length > 0 && (
                    <ResultSection
                      title="Clients"
                      icon={Users}
                      items={results!.clients.map((c) => ({
                        id: c.id,
                        label: c.name,
                        sub: c.company || '',
                        href: `/clients/${c.id}`,
                      }))}
                      onNavigate={navigate}
                    />
                  )}
                  {results!.projects.length > 0 && (
                    <ResultSection
                      title="Projects"
                      icon={FolderKanban}
                      items={results!.projects.map((p) => ({
                        id: p.id,
                        label: p.name,
                        sub: p.client ? getClientDisplayName(p.client) : 'Internal',
                        href: `/projects/${p.id}`,
                      }))}
                      onNavigate={navigate}
                    />
                  )}
                  {results!.tasks.length > 0 && (
                    <ResultSection
                      title="Tasks"
                      icon={CheckSquare}
                      items={results!.tasks.map((t) => ({
                        id: t.id,
                        label: t.title,
                        sub: t.project.name,
                        href: `/tasks?highlight=${t.id}`,
                      }))}
                      onNavigate={navigate}
                    />
                  )}
                  {results!.members.length > 0 && (
                    <ResultSection
                      title="Team"
                      icon={UsersRound}
                      items={results!.members.map((m) => ({
                        id: m.id,
                        label: m.name,
                        sub: m.email,
                        href: `/team/${m.id}`,
                      }))}
                      onNavigate={navigate}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#F3F4F6] text-[10px] text-[#9CA3AF]">
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
  onNavigate,
}: {
  title: string;
  icon: typeof Users;
  items: { id: string; label: string; sub: string; href: string }[];
  onNavigate: (path: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.href)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-[#F9FAFB] transition-colors group"
        >
          <span className="text-[#111827] font-medium">{item.label}</span>
          <span className="text-[#9CA3AF] text-xs">{item.sub}</span>
          <ArrowRight className="h-3.5 w-3.5 ml-auto text-[#D1D5DB] opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      ))}
    </div>
  );
}
