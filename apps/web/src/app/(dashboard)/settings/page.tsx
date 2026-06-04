'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { Building2, Users, Shield, FileText, Plus, X, Edit2 } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';

type Tab = 'organization' | 'users' | 'templates' | 'permissions';

interface OrgUser {
  id: string; name: string; email: string; role: string; team?: { name: string } | null; isActive: boolean;
}

interface Template {
  id: string; name: string; description?: string | null;
}

interface Team {
  id: string; name: string;
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', PROJECT_MANAGER: 'Project Manager', TEAM_MEMBER: 'Team Member',
};

const permissions: Record<string, Record<string, boolean>> = {
  SUPER_ADMIN: { 'Full Access': true, 'Manage Clients': true, 'Manage Projects': true, 'Manage Team': true, 'View Reports': true, 'Settings': true },
  ADMIN: { 'Full Access': false, 'Manage Clients': true, 'Manage Projects': true, 'Manage Team': true, 'View Reports': true, 'Settings': true },
  PROJECT_MANAGER: { 'Full Access': false, 'Manage Clients': false, 'Manage Projects': true, 'Manage Team': false, 'View Reports': true, 'Settings': false },
  TEAM_MEMBER: { 'Full Access': false, 'Manage Clients': false, 'Manage Projects': false, 'Manage Team': false, 'View Reports': false, 'Settings': false },
};

export default function SettingsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('organization');
  const [orgName, setOrgName] = useState('');
  const [orgWebsite, setOrgWebsite] = useState('');
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'TEAM_MEMBER', teamId: '', password: '', isActive: true });
  const [teams, setTeams] = useState<Team[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && (user.role === 'TEAM_MEMBER' || user.role === 'PROJECT_MANAGER')) {
      router.push('/dashboard');
      return;
    }
    api.get<{ name: string; website?: string }>('/settings/organization').then((d) => { setOrgName(d.name); setOrgWebsite(d.website || ''); }).catch(() => {});
    api.get<OrgUser[]>('/settings/users').then(setUsers).catch(() => {});
    api.get<Template[]>('/settings/templates').then(setTemplates).catch(() => {});
    api.get<{ teams: Team[] }>('/teams').then((res) => setTeams(res.teams || [])).catch(() => {});
  }, [user, router]);

  async function saveOrg() {
    setSaving(true);
    try { await api.put('/settings/organization', { name: orgName, website: orgWebsite }); } catch {}
    finally { setSaving(false); }
  }

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/settings/users', { ...inviteForm, password: inviteForm.password || 'Welcome@123' });
      setShowInvite(false);
      setEditingUser(null);
      setInviteForm({ name: '', email: '', role: 'TEAM_MEMBER', teamId: '', password: '', isActive: true });
      const data = await api.get<OrgUser[]>('/settings/users');
      setUsers(data);
    } catch {}
  }

  async function submitEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await api.put(`/settings/users/${editingUser.id}`, { ...inviteForm });
      setEditingUser(null);
      setInviteForm({ name: '', email: '', role: 'TEAM_MEMBER', teamId: '', password: '', isActive: true });
      const data = await api.get<OrgUser[]>('/settings/users');
      setUsers(data);
    } catch {}
  }

  function openEditUser(u: OrgUser) {
    setEditingUser(u);
    setInviteForm({
      name: u.name,
      email: u.email,
      role: u.role,
      teamId: u.team ? teams.find(t => t.name === u.team?.name)?.id || '' : '',
      password: '',
      isActive: u.isActive
    });
  }

  const tabs = [
    { id: 'organization' as Tab, label: 'Organization', icon: Building2 },
    { id: 'users' as Tab, label: 'Users', icon: Users },
    { id: 'templates' as Tab, label: 'Templates', icon: FileText },
    { id: 'permissions' as Tab, label: 'Permissions', icon: Shield },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Settings</h1>
        <p className="text-sm text-[#6B7280] mt-1">Manage your workspace</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar */}
        <div className="w-48 shrink-0 space-y-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${tab === t.id ? 'bg-[#111827] text-white' : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]'}`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1">
          {tab === 'organization' && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 max-w-lg">
              <h2 className="text-sm font-semibold text-[#111827] mb-4">Organization Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Name</label>
                  <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Website</label>
                  <input value={orgWebsite} onChange={(e) => setOrgWebsite(e.target.value)} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                </div>
                <button onClick={saveOrg} disabled={saving} className="rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {tab === 'users' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-[#111827]">Team Members</h2>
                <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 rounded-xl bg-[#111827] px-3 py-2 text-xs font-medium text-white hover:bg-[#1F2937] transition-all">
                  <Plus className="h-3.5 w-3.5" /> Invite
                </button>
              </div>
              <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Team</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-[#6B7280] uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-[#FAFAFA] transition-colors">
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className={`h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center ${getAvatarColor(u.name)}`}>{getInitials(u.name)}</div>
                            <div>
                              <p className="text-sm font-medium text-[#111827]">{u.name}</p>
                              <p className="text-xs text-[#9CA3AF]">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-sm text-[#6B7280]">{roleLabels[u.role]}</td>
                        <td className="px-6 py-3.5 text-sm text-[#6B7280]">{u.team?.name || '—'}</td>
                        <td className="px-6 py-3.5">
                          <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <button onClick={() => openEditUser(u)} className="p-1.5 text-[#6B7280] hover:text-[#111827] bg-[#F9FAFB] hover:bg-[#F3F4F6] rounded-xl transition-colors">
                            <Edit2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Invite Modal */}
              {showInvite && (
                <>
                  <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
                  <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-2xl">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-[#111827]">Invite Team Member</h3>
                      <button onClick={() => setShowInvite(false)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
                    </div>
                    <form onSubmit={inviteUser} className="space-y-3">
                      <input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="Full name" required className="w-full rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                      <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="Email" required className="w-full rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                      <input type="text" value={inviteForm.password} onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })} placeholder="Password (default: Welcome@123)" className="w-full rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                      <Select
                        value={inviteForm.role}
                        onChange={(val) => setInviteForm({ ...inviteForm, role: val })}
                        options={[
                          { label: 'Team Member', value: 'TEAM_MEMBER' },
                          { label: 'Project Manager', value: 'PROJECT_MANAGER' },
                          { label: 'Admin', value: 'ADMIN' }
                        ]}
                      />
                      <Select
                        value={inviteForm.teamId}
                        onChange={(val) => setInviteForm({ ...inviteForm, teamId: val })}
                        options={[{ label: 'Assign to team (optional)', value: '' }, ...teams.map((t) => ({ label: t.name, value: t.id }))]}
                      />
                      <button type="submit" className="w-full rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">Send Invite</button>
                    </form>
                  </div>
                </>
              )}

              {/* Edit Modal */}
              {editingUser && (
                <>
                  <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setEditingUser(null)} />
                  <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-2xl">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-[#111827]">Edit User</h3>
                      <button onClick={() => setEditingUser(null)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
                    </div>
                    <form onSubmit={submitEditUser} className="space-y-3">
                      <input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="Full name" required className="w-full rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                      <input type="email" value={inviteForm.email} disabled className="w-full rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2.5 text-sm text-[#9CA3AF] outline-none transition-all cursor-not-allowed" title="Email cannot be changed" />
                      <input type="text" value={inviteForm.password} onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })} placeholder="New Password (leave blank to keep current)" className="w-full rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
                      <Select
                        value={inviteForm.role}
                        onChange={(val) => setInviteForm({ ...inviteForm, role: val })}
                        options={[
                          { label: 'Team Member', value: 'TEAM_MEMBER' },
                          { label: 'Project Manager', value: 'PROJECT_MANAGER' },
                          { label: 'Admin', value: 'ADMIN' }
                        ]}
                      />
                      <Select
                        value={inviteForm.teamId}
                        onChange={(val) => setInviteForm({ ...inviteForm, teamId: val })}
                        options={[{ label: 'Assign to team (optional)', value: '' }, ...teams.map((t) => ({ label: t.name, value: t.id }))]}
                      />
                      <div className="flex items-center justify-between px-1 mt-2">
                        <span className="text-sm font-medium text-[#374151]">Account Status</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={inviteForm.isActive} onChange={(e) => setInviteForm({ ...inviteForm, isActive: e.target.checked })} className="sr-only peer" />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#111827]"></div>
                        </label>
                      </div>
                      <button type="submit" className="w-full rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all mt-4">Save Changes</button>
                    </form>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'templates' && (
            <div>
              <h2 className="text-sm font-semibold text-[#111827] mb-4">Project Templates</h2>
              <div className="space-y-3">
                {templates.map((t) => (
                  <div key={t.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 hover:shadow-sm transition-all">
                    <h3 className="text-sm font-semibold text-[#111827]">{t.name}</h3>
                    {t.description && <p className="text-xs text-[#6B7280] mt-1">{t.description}</p>}
                  </div>
                ))}
                {templates.length === 0 && <p className="text-sm text-[#9CA3AF]">No templates yet</p>}
              </div>
            </div>
          )}

          {tab === 'permissions' && (
            <div>
              <h2 className="text-sm font-semibold text-[#111827] mb-4">Role Permissions</h2>
              <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      <th className="px-6 py-3 text-left text-xs font-medium text-[#6B7280] uppercase">Permission</th>
                      {Object.keys(roleLabels).map((r) => (
                        <th key={r} className="px-4 py-3 text-center text-xs font-medium text-[#6B7280] uppercase">{roleLabels[r]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {Object.keys(permissions.SUPER_ADMIN).map((perm) => (
                      <tr key={perm} className="hover:bg-[#FAFAFA]">
                        <td className="px-6 py-3 text-sm text-[#374151]">{perm}</td>
                        {Object.keys(roleLabels).map((role) => (
                          <td key={role} className="px-4 py-3 text-center">
                            {permissions[role][perm] ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 text-xs">✓</span>
                            ) : (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-50 text-gray-300 text-xs">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
