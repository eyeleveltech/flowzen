'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useUIStore } from '@/stores';
import { api } from '@/lib/api-v2';
import {
  Search,
  Building2,
  type LucideIcon,
  FolderKanban,
  CheckSquare,
  TrendingUp,
  FileText,
  Receipt,
  ArrowRight,
  X,
} from 'lucide-react';
import { ENQUIRY, enquiryName } from '@/lib/vocabulary';
import {
  readCommand,
  availableActions,
  activityTypeFor,
  type CommandAction,
  type Subject,
} from '@/lib/actions';
import { useAuthStore } from '@/stores';
import type { Role } from '@/lib/api-v2';
import toast from 'react-hot-toast';
import { LogActivityDialog } from '@/components/activities/LogActivityDialog';
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel';
import { QuickEditDialog, type QuickEditSpec } from '@/components/ui/quick-edit-dialog';

/**
 * What one search box finds.
 *
 * Quotations and invoices are only searched for people allowed to see money, and
 * that is decided by the SERVER — this component never filters by role, so a
 * mistake here cannot expose a figure (master plan §5).
 */
interface SearchResults {
  companies: { id: string; name: string; status: string }[];
  deals: {
    id: string;
    title: string | null;
    company: { id: string; name: string };
    stage: { name: string };
    /** What tells two of one client's proposals apart — a proposal has no title. */
    kind?: 'RETAINER' | 'PROJECT';
    raisedAt?: string;
  }[];
  projects: { id: string; name: string; company: { name: string } }[];
  /** The API works out where a task links to — it belongs to a project OR a deal. */
  tasks: { id: string; title: string; context: string | null; href: string }[];
  quotes: { id: string; number: string; company: { name: string } }[];
  invoices: { id: string; number: string; company: { name: string } }[];
}

/** One group of rows in the palette, with its heading. */
interface Section {
  title: string;
  icon: LucideIcon;
  items: FlatItem[];
}

interface FlatItem {
  id: string;
  label: string;
  sub: string;
  /** Where Enter goes, when Enter goes somewhere. */
  href?: string;
  /**
   * What Enter DOES, when there is something to do.
   *
   * The whole point of the rebuild: an item may now be an action rather than a
   * destination. Exactly one of `href` and `run` is set.
   */
  run?: () => void;
}

export function CommandPalette() {
  const shouldReduceMotion = useReducedMotion();
  const router = useRouter();
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // The same permission switches the API enforces decide which verbs are
  // offered. A courtesy — see `lib/actions.ts`.
  const permissions = useAuthStore((state) => state.user?.permissions);

  // Whatever the chosen action opened. One at a time, by construction.
  const [logging, setLogging] = useState<{ subject: Subject; type: string } | null>(null);
  const [addingTaskTo, setAddingTaskTo] = useState<Subject | null>(null);
  const [editing, setEditing] = useState<QuickEditSpec | null>(null);

  /**
   * What Enter actually does.
   *
   * Every branch ends by closing the palette and opening a dialog with the
   * subject already filled in — or, for marking done, by simply doing it: a
   * confirmation dialog for a thing that is one click to undo is a step charged
   * for nothing.
   *
   * The dialogs live HERE rather than on each page, because ⌘K is available on
   * every screen and the whole point is not having to be on the right one.
   */
  const runAction = useCallback(
    (id: CommandAction['id'], subject: Subject, alias: string) => {
      setCommandPaletteOpen(false);
      setQuery('');
      setResults(null);

      if (id === 'log') {
        // The word that was typed decides the kind: "meeting acme" is a meeting.
        setLogging({ subject, type: activityTypeFor(alias) });
        return;
      }
      if (id === 'task') {
        setAddingTaskTo(subject);
        return;
      }
      if (id === 'done') {
        void api.projects
          .updateTask(subject.id, { status: 'DONE' })
          .then(() => toast.success(`${subject.name} — done`))
          .catch((e: any) => toast.error(e instanceof Error ? e.message : 'Could not update that task.'));
        return;
      }
      if (id === 'followUp') {
        setEditing({
          kind: 'date',
          title: 'Follow up on',
          subject: subject.name,
          label: 'Come back to them on',
          hint: 'They appear on Today, and their owner is reminded.',
          initial: '',
          onSave: async (value) => {
            await api.companies.update(subject.id, { followUpDate: value || null } as never);
          },
        });
      }
    },
    [setCommandPaletteOpen],
  );

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

  /**
   * A verb, and the thing to do it to.
   *
   * `"call suvai"` searches for `suvai` and offers to log against what it finds.
   * When the first word is not a verb this is null and everything below behaves
   * exactly as it always did.
   */
  const command = useMemo(() => readCommand(query, permissions), [query, permissions]);
  const term = command ? command.term : query;

  useEffect(() => {
    const timer = setTimeout(() => search(term), 300);
    return () => clearTimeout(timer);
  }, [term, search]);

  /**
   * Subjects the current verb can be pointed at.
   *
   * Built from the same search results — a company found by name is the same
   * company whether you meant to open it or to log a call against it. What
   * changes is only what Enter does with it.
   */
  const actionSections = useMemo((): Section[] | null => {
    if (!command || !results) return null;
    const { action } = command;

    const subjects: Subject[] = [];
    if (action.applies.includes('company')) {
      subjects.push(
        ...results.companies.map((c) => ({ kind: 'company' as const, id: c.id, name: c.name })),
      );
    }
    if (action.applies.includes('deal')) {
      subjects.push(
        ...results.deals.map((d) => ({
          kind: 'deal' as const,
          id: d.id,
          name: enquiryName(d, d.company.name),
          context: d.company.name,
        })),
      );
    }
    if (action.applies.includes('project')) {
      subjects.push(
        ...results.projects.map((p) => ({
          kind: 'project' as const,
          id: p.id,
          name: p.name,
          context: p.company.name,
        })),
      );
    }
    if (action.applies.includes('task')) {
      subjects.push(
        ...results.tasks.map((t) => ({
          kind: 'task' as const,
          id: t.id,
          name: t.title,
          context: t.context ?? ENQUIRY.One,
        })),
      );
    }
    if (subjects.length === 0) return [];

    return [
      {
        title: action.verb,
        icon: action.icon,
        items: subjects.map((subject) => ({
          id: `${action.id}:${subject.id}`,
          // The action reads as the label so the row says what pressing Enter
          // will do — "Log activity · Suvai Foods", not "Suvai Foods".
          label: action.verb,
          sub: subject.context ? `${subject.name} · ${subject.context}` : subject.name,
          run: () => runAction(action.id, subject, command.alias),
        })),
      },
    ];
  }, [command, results, runAction]);

  // The sections in the exact order they render — drives both the list UI and
  // keyboard navigation, so up/down always moves through what is on screen.
  const navSections = useMemo((): Section[] => {
    if (!results) return [];
    const s: Section[] = [];

    if (results.companies.length) {
      s.push({
        title: 'Clients',
        icon: Building2,
        items: results.companies.map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.status.toLowerCase().replace('_', ' '),
          href: `/companies/${c.id}`,
        })),
      });
    }
    if (results.deals.length) {
      s.push({
        // What we are talking to them about. Searching for it is still useful —
        // people remember "the website rebuild" before they remember the client
        // — but it opens the CLIENT, because that is where it lives (§8.7).
        title: ENQUIRY.Many,
        icon: TrendingUp,
        /*
         * A proposal has no title of its own, so two for the same client used
         * to render the same line twice — "Pavilion Club · Won" above
         * "Pavilion Club · Won", two real records with nothing to choose
         * between them. What they were for, and when they were raised, is the
         * smallest thing that tells them apart.
         */
        items: results.deals.map((d) => ({
          id: d.id,
          label: enquiryName(d, d.company.name),
          sub: [
            d.company.name,
            d.kind === 'RETAINER' ? 'Retainer' : d.kind === 'PROJECT' ? 'Project' : null,
            d.stage.name,
            d.raisedAt
              ? new Date(d.raisedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          href: `/companies/${d.company.id}`,
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
        // A task hangs off a project OR a conversation. The server sends the
        // project's name when there is one and null when there is not; the noun
        // for the other case is the interface's to choose.
        items: results.tasks.map((t) => ({ id: t.id, label: t.title, sub: t.context ?? ENQUIRY.One, href: t.href })),
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
          href: '/money',
        })),
      });
    }
    return s;
  }, [results]);

  /** Action mode replaces the find results; it never appears alongside them. */
  const sections = actionSections ?? navSections;
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

  /** An item either goes somewhere or does something. Exactly one. */
  const choose = useCallback(
    (item: FlatItem) => {
      if (item.run) item.run();
      else if (item.href) navigate(item.href);
    },
    [navigate],
  );

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
          choose(item);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, flatItems, selectedIndex, choose]);

  const hasResults = flatItems.length > 0;

  // Global running index so highlight + keyboard selection line up across sections.
  let runningIndex = 0;

  return (
    <>
      {/*
        Mounted outside the palette's own AnimatePresence.

        Choosing an action CLOSES the palette and opens a dialog — render these
        inside it and they would unmount in the same tick, so pressing Enter would
        appear to do nothing at all.
      */}
      <LogActivityDialog
        open={logging !== null}
        companyId={logging?.subject.kind === 'company' ? logging.subject.id : undefined}
        dealId={logging?.subject.kind === 'deal' ? logging.subject.id : undefined}
        projectId={logging?.subject.kind === 'project' ? logging.subject.id : undefined}
        subjectName={logging?.subject.name}
        defaultType={logging?.type}
        onClose={() => setLogging(null)}
        onLogged={() => {
          setLogging(null);
          toast.success('Logged');
        }}
      />

      {addingTaskTo && (
        <NewTaskPanel
          isOpen
          projectId={addingTaskTo.id}
          projectName={addingTaskTo.name}
          onClose={() => setAddingTaskTo(null)}
          onSuccess={() => setAddingTaskTo(null)}
        />
      )}

      <QuickEditDialog
        spec={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          toast.success('Saved');
        }}
      />

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
            /*
              A handle for the browser checks.
              
              They used to find the palette's sections by searching the whole
              page for the word — which was unambiguous only while the sidebar
              was one flat list. It now has a Clients GROUP and a Clients LINK,
              so the check broke on a navigation change it was never about.
              A testid survives restyling; a text match does not.
            */
            data-testid="command-palette"
            initial={{ opacity: 0, scale: 0.96, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -20 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 rounded-2xl border border-border bg-white shadow-modal"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-subtle">
              <Search className="h-5 w-5 text-secondary" />
              <input
                autoFocus
                aria-label="Search everything"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients, enquiries, projects, tasks, documents…"
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

              {!loading && command && !hasResults && (
                <div className="py-8 text-center text-sm text-secondary">
                  {command.term ? 'Nothing matched that' : command.action.hint}
                </div>
              )}

              {!loading && !command && query.length < 2 && (
                <div className="space-y-3 py-6 text-center text-sm text-secondary">
                  <p>Type at least 2 characters to search</p>
                  {/*
                    The verbs, shown rather than documented. Nobody discovers a
                    command bar by guessing at it.
                  */}
                  {availableActions(permissions).length > 0 && (
                    <p className="text-xs">
                      or start with{' '}
                      {availableActions(permissions)
                        .map((a) => a.aliases[0])
                        .join(', ')}{' '}
                      — as in <span className="font-medium text-primary">call suvai</span>
                    </p>
                  )}
                </div>
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
                        onChoose={choose}
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
    </>
  );
}

function ResultSection({
  title,
  icon: Icon,
  items,
  startIndex,
  selectedIndex,
  onHover,
  onChoose,
}: {
  title: string;
  icon: LucideIcon;
  items: FlatItem[];
  startIndex: number;
  selectedIndex: number;
  onHover: (index: number) => void;
  onChoose: (item: FlatItem) => void;
}) {
  return (
    <div>
      <div className="eyebrow flex items-center gap-2 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {items.map((item, i) => {
        const globalIndex = startIndex + i;
        const isSelected = globalIndex === selectedIndex;
        return (
          <button
            key={item.id}
            onClick={() => onChoose(item)}
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
