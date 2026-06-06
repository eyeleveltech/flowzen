'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore, useConfirmStore } from '@/stores';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { Plus, X, Users, Edit2, Trash2 } from 'lucide-react';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

interface Team {
  id: string;
  name: string;
  description?: string | null;
  leader?: User | null;
  members: User[];
}

export default function TeamsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const confirm = useConfirmStore((s) => s.confirm);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState('');
  
  const [form, setForm] = useState({ name: '', description: '', leaderId: '', memberIds: [] as string[] });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && (user.role === 'TEAM_MEMBER' || user.role === 'PROJECT_MANAGER')) {
      router.push('/dashboard');
      return;
    }
    fetchTeams();
    fetchUsers();
  }, [user, router]);

  async function fetchTeams() {
    try {
      const data = await api.get<{ teams: Team[] }>('/teams');
      setTeams(data.teams);
    } catch {} finally { setLoading(false); }
  }

  async function fetchUsers() {
    try {
      const data = await api.get<User[]>('/team');
      setUsers(data);
    } catch {}
  }

  function openCreate() {
    setIsEditing(false);
    setForm({ name: '', description: '', leaderId: '', memberIds: [] });
    setShowCreate(true);
  }

  function openEdit(team: Team) {
    setIsEditing(true);
    setEditingId(team.id);
    setForm({
      name: team.name,
      description: team.description || '',
      leaderId: team.leader?.id || '',
      memberIds: team.members.map(m => m.id),
    });
    setShowCreate(true);
  }

  async function handleDelete(id: string) {
    const confirmed = await confirm({
      title: 'Delete Department',
      message: 'Are you sure you want to delete this department? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/teams/${id}`);
      fetchTeams();
    } catch (err: any) {
      alert(err.message || 'Failed to delete department');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      if (isEditing) {
        await api.put(`/teams/${editingId}`, form);
      } else {
        await api.post('/teams', form);
      }
      setShowCreate(false);
      fetchTeams();
    } catch (err: any) {
      setFormError(err.message || 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <Skeleton className="h-8 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-40 rounded-xl" />
        </div>
        <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden p-6 space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-[#F3F4F6] last:border-0">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div>
                  <Skeleton className="h-5 w-32 mb-1" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
              <Skeleton className="h-6 w-24 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Departments</h1>
          <p className="text-[#6B7280] mt-1 text-sm">Manage departments and groups within your organization.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-[#111827] px-4 py-2 text-sm font-medium text-white hover:bg-[#1F2937] transition-all shadow-sm hover:shadow-md"
        >
          <Plus className="h-4 w-4" />
          Create Department
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <th className="px-6 py-4 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Department Name</th>
              <th className="px-6 py-4 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Head / Leader</th>
              <th className="px-6 py-4 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Members</th>
              <th className="px-6 py-4 text-xs font-semibold text-[#6B7280] uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {teams.map(team => (
              <tr key={team.id} className="hover:bg-[#F9FAFB] transition-colors group">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 flex items-center justify-center shadow-inner border border-blue-100/50 shrink-0">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#111827]">{team.name}</h3>
                      <p className="text-xs text-[#6B7280] line-clamp-1 max-w-[250px]">{team.description || 'No description'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  {team.leader ? (
                    <div className="flex items-center gap-2">
                      <div className={`h-7 w-7 rounded-full text-white flex items-center justify-center text-[10px] font-bold ${getAvatarColor(team.leader.name)}`}>
                        {getInitials(team.leader.name)}
                      </div>
                      <span className="text-sm font-medium text-[#111827]">{team.leader.name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-[#9CA3AF] italic">No Leader</span>
                  )}
                </td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {team.members.slice(0, 5).map((m, i) => (
                        <div 
                          key={m.id} 
                          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-white text-white text-[10px] font-bold shadow-sm ${getAvatarColor(m.name)}`} 
                          style={{ zIndex: 5 - i }}
                          title={m.name}
                        >
                          {getInitials(m.name)}
                        </div>
                      ))}
                      {team.members.length > 5 && (
                        <div 
                          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-white bg-white text-[#374151] border border-[#E5E7EB] text-[10px] font-bold shadow-sm" 
                          style={{ zIndex: 0 }}
                        >
                          +{team.members.length - 5}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-medium text-[#6B7280]">{team.members.length} members</span>
                  </div>
                </td>
                <td className="px-6 py-5 text-right">
                  <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(team)} className="p-2 text-[#6B7280] hover:text-[#111827] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] rounded-xl transition-all shadow-sm">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(team.id)} className="p-2 text-[#6B7280] hover:text-red-600 bg-white border border-[#E5E7EB] hover:bg-red-50 hover:border-red-100 rounded-xl transition-all shadow-sm">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-[#6B7280]">No departments found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {showCreate && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
              <div className="fixed inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl my-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-[#111827]">{isEditing ? 'Edit Department' : 'Create Department'}</h2>
                <button onClick={() => setShowCreate(false)} className="p-2 text-[#6B7280] hover:bg-[#F3F4F6] rounded-xl transition-colors"><X className="h-5 w-5" /></button>
              </div>
              
              <form onSubmit={handleSubmit} className="relative space-y-4">
                {formError && <div className="absolute top-0 left-0 right-0 -mt-2 z-10 rounded-xl bg-red-50 p-3 text-sm text-red-600 shadow-sm border border-red-100">{formError}</div>}
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Department Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all resize-none" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Department Head</label>
                  <Select
                    value={form.leaderId}
                    onChange={(val) => setForm({ ...form, leaderId: val })}
                    options={[{ label: 'Select a head (optional)', value: '' }, ...users.map(u => ({ label: u.name, value: u.id }))]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Department Members</label>
                  <MultiSelect
                    options={users.filter(u => u.id !== form.leaderId).map(u => ({ 
                      label: u.name, 
                      value: u.id, 
                      image: getInitials(u.name),
                      colorClass: getAvatarColor(u.name)
                    }))}
                    value={form.memberIds}
                    onChange={(val) => setForm({ ...form, memberIds: val })}
                    placeholder="Search and select members..."
                  />
                </div>
                
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Saving...' : 'Save Department'}</button>
                </div>
              </form>
              </motion.div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
