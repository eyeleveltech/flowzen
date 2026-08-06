'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { Building2, Users, FileText, Shield, Zap, Boxes, Receipt, Bell, Key, ChevronRight } from 'lucide-react';
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
import { ErrorPanel } from '@/components/ui/error-panel';

type Tab = 'organization' | 'modules' | 'billing' | 'users' | 'templates' | 'permissions' | 'workflows' | 'notifications' | 'audit' | 'api';

import { usePageTitle } from '@/hooks/usePageTitle';
import { Icon } from '@/components/ui/icon';

export default function SettingsPage() {
  usePageTitle('Settings');
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
  const [fetchErrors, setFetchErrors] = useState<Record<string, string | null>>({});

  const fetchUsers = () => api.get<any[]>('/settings/users').then((d) => { setUsers(d); setFetchErrors(p => ({ ...p, users: null })); }).catch((e: any) => setFetchErrors(p => ({ ...p, users: e.message || 'Failed to load users' })));
  const fetchWorkflows = () => api.get<any[]>('/settings/workflows').then((d) => { setWorkflows(d); setFetchErrors(p => ({ ...p, workflows: null })); }).catch((e: any) => setFetchErrors(p => ({ ...p, workflows: e.message || 'Failed to load workflows' })));
  const fetchTemplates = () => api.get<any[]>('/settings/templates').then((d) => { setTemplates(d); setFetchErrors(p => ({ ...p, templates: null })); }).catch((e: any) => setFetchErrors(p => ({ ...p, templates: e.message || 'Failed to load templates' })));
  const fetchOrg = () => api.get<any>('/settings/organization').then((d) => { setOrgData(d); setFetchErrors(p => ({ ...p, organization: null })); }).catch((e: any) => setFetchErrors(p => ({ ...p, organization: e.message || 'Failed to load organization' })));
  const fetchTeams = () => api.get<{ teams: any[] }>('/teams').then((res) => setTeams(res.teams || [])).catch(() => { });
  const fetchModules = () => api.get<any[]>('/settings/modules').then((d) => { setModules(d); setFetchErrors(p => ({ ...p, modules: null })); }).catch((e: any) => setFetchErrors(p => ({ ...p, modules: e.message || 'Failed to load modules' })));

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
      <div className="space-y-6">
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-primary tracking-tight">Settings</h1>
        <p className="text-sm text-secondary mt-1">Manage your organization, team, and preferences.</p>
      </div>

      <div className="relative w-max max-w-full">
        <div
          ref={tabStripRef}
          onScroll={updateTabScroll}
          className="flex gap-2 p-1 bg-subtle rounded-xl overflow-x-auto no-scrollbar pr-10"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as Tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 motion-reduce:transition-none ${tab === t.id
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-secondary hover:text-primary hover:bg-white/50'
                }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Scroll affordance fade & interactive button */}
        {canScrollRight && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-xl bg-linear-to-l from-surface-sunken via-surface-sunken/80 to-transparent"
            />
            <button
              type="button"
              aria-label="Scroll tab list right"
              onClick={() => tabStripRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-xs border border-border/50 text-secondary hover:text-primary hover:bg-surface active:scale-95 transition-all"
            >
              <Icon as={ChevronRight} size="sm" />
            </button>
          </>
        )}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white p-4 sm:p-6 rounded-2xl border border-border overflow-hidden min-w-0"
      >
        {tab === 'organization' && (fetchErrors.organization
          ? <ErrorPanel message={fetchErrors.organization} onRetry={fetchOrg} />
          : <OrganizationTab initialData={orgData} onSaved={fetchOrg} />)}
        {tab === 'modules' && (fetchErrors.modules
          ? <ErrorPanel message={fetchErrors.modules} onRetry={fetchModules} />
          : <ModulesTab modules={modules} fetchModules={fetchModules} userCount={users.length} />)}
        {tab === 'billing' && <BillingTab />}
        {tab === 'users' && (fetchErrors.users
          ? <ErrorPanel message={fetchErrors.users} onRetry={fetchUsers} />
          : <UsersTab users={users} fetchUsers={fetchUsers} teams={teams} currentUser={user} />)}
        {tab === 'workflows' && (fetchErrors.workflows
          ? <ErrorPanel message={fetchErrors.workflows} onRetry={fetchWorkflows} />
          : <WorkflowsTab workflows={workflows} fetchWorkflows={fetchWorkflows} users={users} />)}
        {tab === 'templates' && (fetchErrors.templates
          ? <ErrorPanel message={fetchErrors.templates} onRetry={fetchTemplates} />
          : <TemplatesTab templates={templates} fetchTemplates={fetchTemplates} />)}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'audit' && <AuditLogsTab />}
        {tab === 'api' && <ApiKeysTab />}
      </motion.div>
    </div>
  );
}
