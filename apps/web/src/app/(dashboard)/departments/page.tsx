'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuthStore, useConfirmStore } from '@/stores';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
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

interface TeamManagerItem {
  user: User;
}

interface Team {
  id: string;
  name: string;
  description?: string | null;
  managers: TeamManagerItem[];
  members: User[];
}

export default function TeamsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const confirm = useConfirmStore((s) => s.confirm);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState('');
  
  const [form, setForm] = useState({ name: '', description: '', managerIds: [] as string[], memberIds: [] as string[] });
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

  // Live-update the page when teams/members change anywhere (other users too).
  useEffect(() => {
    const sse = getSSE();
    if (!sse) return;
    sse.on('team:changed', fetchTeams);
    sse.on('member:changed', fetchUsers);
    return () => { sse.off('team:changed', fetchTeams); sse.off('member:changed', fetchUsers); };
  }, []);

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
    setForm({ name: '', description: '', managerIds: [], memberIds: [] });
    setShowCreate(true);
  }

  function openEdit(team: Team) {
    setIsEditing(true);
    setEditingId(team.id);
    setForm({
      name: team.name,
      description: team.description || '',
      managerIds: team.managers?.map(m => m.user.id) || [],
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
      toast.success('Department deleted successfully');
      fetchTeams();
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete department');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      if (isEditing) {
        await api.put(`/teams/${editingId}`, form);
        toast.success('Department updated successfully');
      } else {
        await api.post('/teams', form);
        toast.success('Department created successfully');
      }
      setShowCreate(false);
      fetchTeams();
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    } catch (err: any) {
      setFormError(err.message || 'An error occurred');
      toast.error(err.message || 'Failed to save department');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden p-6 space-y-4">
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
    <div className="p-4 sm:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-primary">Departments</h1>
          <p className="text-secondary mt-1 text-xs sm:text-sm">Manage departments and groups within your organization.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#1F2937] transition-all hover:shadow-sm self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Create Department
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-200">
            <thead>
            <tr className="bg-[#F9FAFB] border-b border-border">
              <th className="px-6 py-4 text-xs font-medium text-secondary uppercase tracking-wide">Department Name</th>
              <th className="px-6 py-4 text-xs font-medium text-secondary uppercase tracking-wide">Managers</th>
              <th className="px-6 py-4 text-xs font-medium text-secondary uppercase tracking-wide">Members</th>
              <th className="px-6 py-4 text-xs font-medium text-secondary uppercase tracking-wide text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {teams.map(team => (
              <tr key={team.id} className="hover:bg-[#F9FAFB] transition-colors group">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#F3F4F6] text-primary flex items-center justify-center border border-border shrink-0">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-primary">{team.name}</h3>
                      <p className="text-xs text-secondary line-clamp-1 max-w-62.5">{team.description || 'No description'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  {team.managers && team.managers.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1.5">
                        {team.managers.slice(0, 3).map((mgr, i) => (
                          <div 
                            key={mgr.user.id} 
                            className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ring-white text-[10px] font-bold ${getAvatarColor(mgr.user.name)}`} 
                            style={{ zIndex: 3 - i }}
                            title={mgr.user.name}
                          >
                            {getInitials(mgr.user.name)}
                          </div>
                        ))}
                      </div>
                      <span className="text-xs font-medium text-primary">
                        {team.managers.map(m => m.user.name).join(', ')}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted italic">No Managers</span>
                  )}
                </td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {team.members.slice(0, 5).map((m, i) => (
                        <div 
                          key={m.id} 
                          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-white text-[10px] font-bold ${getAvatarColor(m.name)}`} 
                          style={{ zIndex: 5 - i }}
                          title={m.name}
                        >
                          {getInitials(m.name)}
                        </div>
                      ))}
                      {team.members.length > 5 && (
                        <div 
                          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-white bg-[#F3F4F6] text-primary border border-border text-[10px] font-semibold" 
                          style={{ zIndex: 0 }}
                        >
                          +{team.members.length - 5}
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-medium text-secondary">{team.members.length} members</span>
                  </div>
                </td>
                <td className="px-6 py-5 text-right">
                  <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(team)} className="p-2 text-secondary hover:text-primary bg-white border border-border hover:bg-[#F3F4F6] rounded-xl transition-all hover:shadow-sm">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(team.id)} className="p-2 text-secondary hover:text-red-600 bg-white border border-border hover:bg-red-50 hover:border-red-100 rounded-xl transition-all hover:shadow-sm">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-secondary">No departments found.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        {/* Mobile Card View (Optimized for 320px+) */}
        <div className="md:hidden flex flex-col divide-y divide-border">
          {teams.map((team) => (
            <div key={team.id} className="p-3.5 sm:p-4 hover:bg-[#F9FAFB] transition-colors relative">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-linear-to-br from-blue-50 to-indigo-50 text-blue-600 flex items-center justify-center border border-blue-100/50 shrink-0">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-primary text-sm truncate">{team.name}</h3>
                    <p className="text-xs text-secondary truncate max-w-37.5 sm:max-w-none">{team.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => openEdit(team)} className="p-1.5 text-secondary hover:text-primary bg-white border border-border hover:bg-[#F3F4F6] rounded-xl transition-all hover:shadow-sm">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(team.id)} className="p-1.5 text-secondary hover:text-red-600 bg-white border border-border hover:bg-red-50 hover:border-red-100 rounded-xl transition-all hover:shadow-sm">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3 bg-[#F9FAFB] p-2.5 rounded-xl border border-border">
                <div className="min-w-0">
                  <span className="text-[10px] font-medium text-secondary uppercase tracking-wide block mb-1">Managers</span>
                  {team.managers && team.managers.length > 0 ? (
                    <span className="text-xs font-medium text-primary block truncate">
                      {team.managers.map(m => m.user.name).join(', ')}
                    </span>
                  ) : (
                    <span className="text-xs text-muted italic">No Managers</span>
                  )}
                </div>
                
                <div className="min-w-0">
                  <span className="text-[10px] font-medium text-secondary uppercase tracking-wide block mb-1">Members ({team.members.length})</span>
                  <div className="flex -space-x-1.5">
                    {team.members.slice(0, 4).map((m, i) => (
                      <div 
                        key={m.id} 
                        className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-2 ring-[#F9FAFB] text-[8px] font-bold ${getAvatarColor(m.name)}`} 
                        style={{ zIndex: 4 - i }}
                        title={m.name}
                      >
                        {getInitials(m.name)}
                      </div>
                    ))}
                    {team.members.length > 4 && (
                      <div 
                        className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-2 ring-[#F9FAFB] bg-[#F3F4F6] text-primary border border-border text-[7px] font-semibold" 
                        style={{ zIndex: 0 }}
                      >
                        +{team.members.length - 4}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {teams.length === 0 && (
            <div className="p-8 text-center text-sm text-secondary">No departments found.</div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex flex-col border-b border-[#F3F4F6]">
                <div className="flex items-center justify-between px-4 sm:px-6 py-4">
                  <h2 className="text-lg font-semibold text-primary">{isEditing ? 'Edit Department' : 'Create Department'}</h2>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                    <X className="h-4 w-4 text-secondary" />
                  </button>
                </div>
              </div>
              
              <form onSubmit={handleSubmit} className="relative space-y-4 p-4 sm:p-6">
                {formError && <div className="absolute top-0 left-0 right-0 -mt-2 z-10 rounded-xl bg-red-50 p-3 text-sm text-red-600 shadow-sm border border-red-100">{formError}</div>}
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Department Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none" />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Department Members *</label>
                  <MultiSelect
                    compact={false}
                    options={users.map(u => ({
                      label: u.name,
                      value: u.id,
                      image: getInitials(u.name),
                      colorClass: getAvatarColor(u.name)
                    }))}
                    value={form.memberIds}
                    onChange={(val) => {
                      const validManagerIds = form.managerIds.filter(id => val.includes(id));
                      setForm({ ...form, memberIds: val, managerIds: validManagerIds });
                    }}
                    placeholder="Search and select members..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Managers</label>
                  <MultiSelect
                    compact={false}
                    options={users.filter(u => form.memberIds.includes(u.id)).map(u => ({
                      label: u.name,
                      value: u.id,
                      image: getInitials(u.name),
                      colorClass: getAvatarColor(u.name)
                    }))}
                    value={form.managerIds}
                    onChange={(val) => setForm({ ...form, managerIds: val })}
                    placeholder="Search and select managers..."
                  />
                  {form.memberIds.length === 0 && (
                    <p className="text-xs text-secondary mt-1">Please add members first before assigning managers.</p>
                  )}
                </div>
                
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">{submitting ? 'Saving...' : 'Save Department'}</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
