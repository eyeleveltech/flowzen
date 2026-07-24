'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { Building2, Users, FileText, Shield, Zap, Boxes, Receipt, Bell, Key } from 'lucide-react';
import { OrganizationTab } from '@/components/settings/OrganizationTab';
import { NotificationsTab } from '@/components/settings/NotificationsTab';
import { UsersTab } from '@/components/settings/UsersTab';
import { WorkflowsTab } from '@/components/settings/WorkflowsTab';
import { TemplatesTab } from '@/components/settings/TemplatesTab';
import { PermissionsTab } from '@/components/settings/PermissionsTab';
import { ModulesTab } from '@/components/settings/ModulesTab';
import { BillingTab } from '@/components/settings/BillingTab';
import { AuditLogsTab } from '@/components/settings/AuditLogsTab';
import { ApiKeysTab } from '@/components/settings/ApiKeysTab';
import { Skeleton } from '@/components/ui/skeleton';

type Tab = 'organization' | 'modules' | 'billing' | 'users' | 'templates' | 'permissions' | 'workflows' | 'notifications' | 'audit' | 'api';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('organization');
  const [loading, setLoading] = useState(true);

  // The tab strip scrolls horizontally on narrow screens. Without a visible cue,
  // the 6 off-screen tabs are undiscoverable on touch (scrollbars are hidden there).
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateTabScroll = useCallback(() => {
    const el = tabStripRef.current;
    if (!el) return;
    // 1px tolerance for sub-pixel widths
    setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);

  useEffect(() => {
    updateTabScroll();
    window.addEventListener('resize', updateTabScroll);
    return () => window.removeEventListener('resize', updateTabScroll);
  }, [updateTabScroll]);

  // Data
  const [orgData, setOrgData] = useState<any>({});
  const [users, setUsers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);

  const fetchUsers = () => api.get<any[]>('/settings/users').then(setUsers).catch(() => {});
  const fetchWorkflows = () => api.get<any[]>('/settings/workflows').then(setWorkflows).catch(() => {});
  const fetchTemplates = () => api.get<any[]>('/settings/templates').then(setTemplates).catch(() => {});
  const fetchOrg = () => api.get<any>('/settings/organization').then(setOrgData).catch(() => {});
  const fetchTeams = () => api.get<{ teams: any[] }>('/teams').then((res) => setTeams(res.teams || [])).catch(() => {});
  const fetchModules = () => api.get<any[]>('/settings/modules').then(setModules).catch(() => {});

  useEffect(() => {
    if (user && (user.role === 'TEAM_MEMBER' || user.role === 'PROJECT_MANAGER')) {
      router.push('/dashboard');
      return;
    }
    Promise.all([
      fetchOrg(),
      fetchUsers(),
      fetchWorkflows(),
      fetchTemplates(),
      fetchTeams(),
      fetchModules()
    ]).finally(() => setLoading(false));
  }, [user, router]);

  // Live-update the users table + department list when members/teams change (other users too).
  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;
    sse.on('member:changed', fetchUsers);
    sse.on('team:changed', fetchTeams);
    return () => { sse.off('member:changed', fetchUsers); sse.off('team:changed', fetchTeams); };
  }, []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex gap-4">
          <Skeleton className="h-10 w-32 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <Skeleton className="h-100 w-full rounded-2xl" />
      </div>
    );
  }

  const tabs = [
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'modules', label: 'Modules', icon: Boxes },
    { id: 'billing', label: 'Billing', icon: Receipt },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'workflows', label: 'Workflows', icon: Zap },
    { id: 'templates', label: 'Templates', icon: FileText },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'permissions', label: 'Permissions', icon: Shield },
  ];

  if (user?.role === 'SUPER_ADMIN') {
    tabs.push({ id: 'api', label: 'API Keys', icon: Key });
    tabs.push({ id: 'audit', label: 'Audit Logs', icon: FileText });
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-primary tracking-tight">Settings</h1>
        <p className="text-sm text-secondary mt-1">Manage your organization, team, and preferences.</p>
      </div>

      <div className="relative w-max max-w-full">
        <div
          ref={tabStripRef}
          onScroll={updateTabScroll}
          className="flex gap-2 p-1 bg-[#F3F4F6] rounded-xl overflow-x-auto"
        >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? 'bg-white text-primary shadow-sm'
                : 'text-secondary hover:text-primary hover:bg-white/50'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
        </div>

        {/* Scroll affordance: only rendered when there are tabs still off-screen. */}
        {canScrollRight && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-xl bg-linear-to-l from-[#F3F4F6] to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow-sm"
            >
              <ChevronRight className="h-3.5 w-3.5 text-secondary" />
            </div>
          </>
        )}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white p-6 rounded-2xl border border-border"
      >
        {tab === 'organization' && <OrganizationTab initialData={orgData} onSaved={fetchOrg} />}
        {tab === 'modules' && <ModulesTab modules={modules} fetchModules={fetchModules} />}
        {tab === 'billing' && <BillingTab />}
        {tab === 'users' && <UsersTab users={users} fetchUsers={fetchUsers} teams={teams} />}
        {tab === 'workflows' && <WorkflowsTab workflows={workflows} fetchWorkflows={fetchWorkflows} users={users} />}
        {tab === 'templates' && <TemplatesTab templates={templates} fetchTemplates={fetchTemplates} />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'audit' && <AuditLogsTab />}
        {tab === 'api' && <ApiKeysTab />}
      </motion.div>
    </div>
  );
}
