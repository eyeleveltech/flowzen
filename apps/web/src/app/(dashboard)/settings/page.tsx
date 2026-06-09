'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { Building2, Users, FileText, Shield, Zap } from 'lucide-react';
import { OrganizationTab } from '@/components/settings/OrganizationTab';
import { UsersTab } from '@/components/settings/UsersTab';
import { WorkflowsTab } from '@/components/settings/WorkflowsTab';
import { TemplatesTab } from '@/components/settings/TemplatesTab';
import { PermissionsTab } from '@/components/settings/PermissionsTab';
import { Skeleton } from '@/components/ui/skeleton';

type Tab = 'organization' | 'users' | 'templates' | 'permissions' | 'workflows';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('organization');
  const [loading, setLoading] = useState(true);

  // Data
  const [orgData, setOrgData] = useState<any>({});
  const [users, setUsers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);

  const fetchUsers = () => api.get<any[]>('/settings/users').then(setUsers).catch(() => {});
  const fetchWorkflows = () => api.get<any[]>('/settings/workflows').then(setWorkflows).catch(() => {});
  const fetchTemplates = () => api.get<any[]>('/settings/templates').then(setTemplates).catch(() => {});

  useEffect(() => {
    if (user && (user.role === 'TEAM_MEMBER' || user.role === 'PROJECT_MANAGER')) {
      router.push('/dashboard');
      return;
    }
    Promise.all([
      api.get<any>('/settings/organization').then(setOrgData).catch(() => {}),
      fetchUsers(),
      fetchWorkflows(),
      fetchTemplates(),
      api.get<{ teams: any[] }>('/teams').then((res) => setTeams(res.teams || [])).catch(() => {})
    ]).finally(() => setLoading(false));
  }, [user, router]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex gap-4">
          <Skeleton className="h-10 w-32 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-2xl" />
      </div>
    );
  }

  const tabs = [
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'workflows', label: 'Workflows', icon: Zap },
    { id: 'templates', label: 'Templates', icon: FileText },
    { id: 'permissions', label: 'Permissions', icon: Shield },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#111827] tracking-tight">Settings</h1>
        <p className="text-sm text-[#6B7280] mt-1">Manage your organization, team, and preferences.</p>
      </div>

      <div className="flex gap-2 p-1 bg-[#F3F4F6] rounded-xl overflow-x-auto w-max max-w-full">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? 'bg-white text-[#111827] shadow-sm'
                : 'text-[#6B7280] hover:text-[#111827] hover:bg-white/50'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white p-6 rounded-2xl border border-[#E5E7EB]"
      >
        {tab === 'organization' && <OrganizationTab initialData={orgData} />}
        {tab === 'users' && <UsersTab users={users} fetchUsers={fetchUsers} teams={teams} />}
        {tab === 'workflows' && <WorkflowsTab workflows={workflows} fetchWorkflows={fetchWorkflows} users={users} />}
        {tab === 'templates' && <TemplatesTab templates={templates} fetchTemplates={fetchTemplates} />}
        {tab === 'permissions' && <PermissionsTab />}
      </motion.div>
    </div>
  );
}
