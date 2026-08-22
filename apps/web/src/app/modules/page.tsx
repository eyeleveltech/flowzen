'use client';

/**
 * Choosing which part of Flowzen to work in.
 *
 * The modules are not separate products — they are the same client, the same
 * deal, the same money, seen from where you are standing. Somebody selling wants
 * a short list of selling screens; somebody delivering wants delivery. What you
 * pick decides what the sidebar lists, and nothing else (master plan §7.5).
 *
 * A module you cannot reach is not shown as locked. It is either off for the
 * organisation or above your level, and in both cases it is not yours to open.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, DollarSign, FolderKanban, Loader2, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api-v2';
import { useAuthStore, useModuleStore } from '@/stores';
import { accessibleModules, type ModuleKey, type ModuleDef } from '@/lib/modules';

const ICON: Record<ModuleKey, typeof Building2> = {
  CRM: TrendingUp,
  PM: FolderKanban,
  REVENUE: DollarSign,
};

export default function ModulesPage() {
  const router = useRouter();
  const { user, setAuth } = useAuthStore();
  const setActiveModule = useModuleStore((s) => s.setActiveModule);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // /auth/me answers { user: … }. Storing the envelope leaves role and
    // enabledModules undefined, which makes every module look unreachable and
    // this screen spin forever — the exact failure this page had before.
    api.auth
      .me()
      .then((fresh: { user?: unknown }) => setAuth((fresh?.user ?? fresh) as never))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setAuth]);

  const open = (m: ModuleDef) => {
    setActiveModule(m.key);
    router.push(m.home);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-secondary" />
      </div>
    );
  }

  const reachable = accessibleModules(user);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="w-full max-w-2xl">
        <img src="/logo_flowzen.png" alt="Flowzen" className="mb-8 h-12 w-auto object-contain" />

        <h1 className="text-2xl font-bold text-primary">
          {user?.name ? `Hello ${user.name.split(' ')[0]}` : 'Where are you working?'}
        </h1>
        <p className="mb-8 mt-1 text-sm text-secondary">
          Pick where to start. You can switch at any time from the sidebar — it is the same data
          either way.
        </p>

        {reachable.length === 0 ? (
          // A dead end with an explanation beats a spinner that never resolves.
          <div className="rounded-card border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm text-amber-900">
              Nothing is open to you yet. Either every module is switched off for this
              organisation, or your level does not admit any of them — an admin can change both.
            </p>
            <Link
              href="/profile"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              See your account
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {reachable.map((m) => {
              const Icon = ICON[m.key];
              return (
                <button
                  key={m.key}
                  onClick={() => open(m)}
                  className="rounded-card border border-border bg-white p-5 text-left transition-shadow hover:shadow-overlay"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-subtle">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-primary">{m.label}</p>
                  <p className="mt-0.5 text-xs text-secondary">{m.description}</p>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-secondary">
          Signed in as {user?.email ?? '—'}.{' '}
          <Link href="/dashboard" className="font-medium text-primary hover:underline">
            Skip to Today
          </Link>
        </p>
      </div>
    </div>
  );
}
