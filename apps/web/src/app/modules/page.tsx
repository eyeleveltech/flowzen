'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore, useModuleStore } from '@/stores';
import { accessibleModules, ModuleKey } from '@/lib/modules';
import { FolderKanban, TrendingUp, ArrowRight, DollarSign } from 'lucide-react';

const moduleIcons: Record<ModuleKey, typeof FolderKanban> = {
  PM: FolderKanban,
  CRM: TrendingUp,
  REVENUE: DollarSign,
};

export default function ModulePickerPage() {
  const router = useRouter();
  const { user, loadFromStorage, setAuth } = useAuthStore();
  const setActiveModule = useModuleStore((s) => s.setActiveModule);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadFromStorage();
    api.get('/auth/me')
      .then((fresh: any) => setAuth(fresh))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const mods = accessibleModules(user);

  // Auto-route: no auth → login; exactly one module → straight in.
  useEffect(() => {
    if (!ready) return;
    if (!user) { router.replace('/login'); return; }
    if (mods.length === 1) {
      setActiveModule(mods[0].key);
      router.replace(mods[0].home);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, mods.length]);

  const enter = (key: ModuleKey, home: string) => {
    setActiveModule(key);
    router.replace(home);
  };

  if (!ready || !user || mods.length <= 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-3xl">
        <div className="mb-2 flex items-center justify-center">
          <img src="/logo_flowzen.png" alt="Flowzen" className="h-9 w-auto object-contain" />
        </div>
        <h1 className="text-center text-2xl font-semibold text-primary tracking-tight">Choose a workspace</h1>
        <p className="mt-1 text-center text-sm text-secondary">Hi {user.name?.split(' ')[0]} — pick a module to get started. You can switch anytime.</p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {mods.map((m, i) => {
            const Icon = moduleIcons[m.key];
            return (
              <motion.button
                key={m.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 * i }}
                onClick={() => enter(m.key, m.home)}
                className="group flex flex-col items-start gap-4 rounded-2xl border border-border bg-white p-6 text-left hover:border-primary hover:shadow-md transition-all"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#F3F4F6] text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-primary">{m.label}</h2>
                  <p className="mt-1 text-sm text-secondary">{m.description}</p>
                </div>
                <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Enter <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
