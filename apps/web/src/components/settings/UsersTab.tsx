import { useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, X, Edit2, Shield, Trash2, Mail, Building2, UserCircle, UserX } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useConfirmStore } from '@/stores';

export function UsersTab({ users, fetchUsers, teams }: { users: any[], fetchUsers: () => void, teams: any[] }) {
  const [showInvite, setShowInvite] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirmStore(state => state.confirm);

  const [inviteForm, setInviteForm] = useState({
    name: '', email: '', role: 'TEAM_MEMBER', department: '', designation: ''
  });

  const roleOptions = [
    { label: 'Super Admin', value: 'SUPER_ADMIN' },
    { label: 'Admin', value: 'ADMIN' },
    { label: 'Project Manager', value: 'PROJECT_MANAGER' },
    { label: 'Team Member', value: 'TEAM_MEMBER' },
  ];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/settings/users', inviteForm);
      toast.success('Invitation sent');
      setShowInvite(false);
      setInviteForm({ name: '', email: '', role: 'TEAM_MEMBER', department: '', designation: '' });
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invite');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    try {
      await api.put(`/settings/users/${editingUser.id}`, {
        name: editingUser.name,
        role: editingUser.role,
        department: editingUser.department,
        designation: editingUser.designation,
        status: editingUser.status
      });
      toast.success('User updated');
      setEditingUser(null);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (userId: string) => {
    const isConfirmed = await confirm({
      title: 'Deactivate User',
      message: 'Are you sure you want to deactivate this user?',
      confirmText: 'Deactivate',
      variant: 'warning'
    });
    if (!isConfirmed) return;
    try {
      await api.put(`/settings/users/${userId}`, { status: 'INACTIVE' });
      toast.success('User deactivated');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to deactivate user');
    }
  };

  const handleDelete = async (userId: string) => {
    const isConfirmed = await confirm({
      title: 'Permanently Delete User',
      message: 'Are you sure you want to PERMANENTLY delete this user? This cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/settings/users/${userId}`);
      toast.success('User permanently deleted');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete user');
    }
  };

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', PROJECT_MANAGER: 'Project Manager', TEAM_MEMBER: 'Team Member',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#111827]">Team Directory</h2>
          <p className="text-sm text-[#6B7280]">Manage access and roles for your team.</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="bg-[#111827] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-black transition-colors flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> Invite Member
        </button>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] border-b border-[#E5E7EB]">
            <tr>
              <th className="px-5 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs">Name</th>
              <th className="px-5 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs">Role</th>
              <th className="px-5 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs">Department</th>
              <th className="px-5 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs">Designation</th>
              <th className="px-5 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs">Status</th>
              <th className="px-5 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-[#FAFAFA] transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-[#F3F4F6] text-[#111827] flex items-center justify-center text-xs font-medium border border-[#E5E7EB]">
                      {getInitials(u.name)}
                    </div>
                    <div>
                      <p className="font-semibold text-[#111827]">{u.name}</p>
                      <p className="text-xs text-[#6B7280]">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-[#111827] font-medium">
                  {roleLabels[u.role] || u.role}
                </td>
                <td className="px-5 py-3 text-[#6B7280]">
                  {u.department || '—'}
                </td>
                <td className="px-5 py-3 text-[#6B7280]">
                  {u.designation || '—'}
                </td>
                <td className="px-5 py-3">
                  {u.status === 'ACTIVE' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB] uppercase tracking-wide">Active</span>}
                  {u.status === 'PENDING' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB] uppercase tracking-wide">Pending</span>}
                  {u.status === 'INACTIVE' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#F9FAFB] text-[#9CA3AF] border border-[#E5E7EB] uppercase tracking-wide">Inactive</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditingUser(u)} className="p-1.5 text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] rounded-md transition-colors">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    {u.status !== 'INACTIVE' && (
                      <button onClick={() => handleDeactivate(u.id)} title="Deactivate" className="p-1.5 text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] rounded-md transition-colors">
                        <UserX className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(u.id)} title="Permanently Delete" className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

            <AnimatePresence>
        {showInvite && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-md bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFAFA] sticky top-0 z-10 shrink-0">
                <h3 className="text-base font-semibold text-[#111827]">Invite Member</h3>
                <button type="button" onClick={() => setShowInvite(false)} className="text-[#6B7280] hover:text-[#111827] p-1 rounded-md hover:bg-[#E5E7EB] transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleInvite} className="p-6 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Full Name</label>
                  <input required value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Email Address</label>
                  <input required type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-20 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Role</label>
                  <Select value={inviteForm.role} onChange={(val) => setInviteForm({ ...inviteForm, role: val })} options={roleOptions} />
                </div>
                <div className="space-y-1.5 z-10 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Department (Optional)</label>
                  <Select 
                    value={inviteForm.department || ''} 
                    onChange={(val) => setInviteForm({ ...inviteForm, department: val })} 
                    options={[{ label: 'None', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.name })) || [])]} 
                  />
                </div>
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Designation (Optional)</label>
                  <input value={inviteForm.designation || ''} onChange={(e) => setInviteForm({ ...inviteForm, designation: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="pt-8 flex gap-3">
                  <button type="button" onClick={() => setShowInvite(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E7EB] text-[#374151] font-medium hover:bg-[#FAFAFA] transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-[#111827] text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                    {saving ? 'Sending...' : 'Send Invite'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingUser && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm" onClick={() => setEditingUser(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-[101] w-full max-w-md bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] bg-[#FAFAFA] sticky top-0 z-10 shrink-0">
                <h3 className="text-base font-semibold text-[#111827]">Edit User</h3>
                <button type="button" onClick={() => setEditingUser(null)} className="text-[#6B7280] hover:text-[#111827] p-1 rounded-md hover:bg-[#E5E7EB] transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleUpdateUser} className="p-6 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Full Name</label>
                  <input required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-30 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Role</label>
                  <Select value={editingUser.role} onChange={(val) => setEditingUser({ ...editingUser, role: val })} options={roleOptions} disabled={editingUser.role === 'SUPER_ADMIN'} />
                </div>
                <div className="space-y-1.5 z-20 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Department (Optional)</label>
                  <Select 
                    value={editingUser.department || ''} 
                    onChange={(val) => setEditingUser({ ...editingUser, department: val })} 
                    options={[{ label: 'None', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.name })) || [])]} 
                  />
                </div>
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Designation (Optional)</label>
                  <input value={editingUser.designation || ''} onChange={(e) => setEditingUser({ ...editingUser, designation: e.target.value })} className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-sm font-medium text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none transition-all" />
                </div>
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Status</label>
                  <Select value={editingUser.status} onChange={(val) => setEditingUser({ ...editingUser, status: val })} options={[{label: 'Active', value: 'ACTIVE'}, {label: 'Pending', value: 'PENDING'}, {label: 'Inactive', value: 'INACTIVE'}]} />
                </div>
                <div className="pt-8 flex gap-3">
                  <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E7EB] text-[#374151] font-medium hover:bg-[#FAFAFA] transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-[#111827] text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
