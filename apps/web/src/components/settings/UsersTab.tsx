import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, X, Edit2, Shield, Trash2, Mail, Building2, UserCircle, UserX } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { getInitials, getAvatarColor, toProperCase, getRoleLabel } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useConfirmStore, useAuthStore } from '@/stores';

export function UsersTab({ users, fetchUsers, teams, currentUser }: { users: any[], fetchUsers: () => void, teams: any[], currentUser?: any }) {
  const [showInvite, setShowInvite] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [transferTarget, setTransferTarget] = useState<any | null>(null);
  const [confirmOrgInput, setConfirmOrgInput] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [saving, setSaving] = useState(false);

  const authUser = useAuthStore(state => state.user);
  const effectiveCurrentUser = currentUser || authUser;
  const orgName = effectiveCurrentUser?.organization?.name || 'Organization';

  const confirm = useConfirmStore(state => state.confirm);
  const queryClient = useQueryClient();

  // Refresh the Settings table + the shared ['members'] cache that feeds assignee
  // dropdowns across Tasks/Projects/Pipeline/Clients.
  const refreshMembers = () => {
    fetchUsers();
    queryClient.invalidateQueries({ queryKey: ['members'] });
  };

  const executeTransferSuperAdmin = async () => {
    if (!transferTarget) return;
    setTransferring(true);
    try {
      await api.post(`/settings/users/${transferTarget.id}/transfer-super-admin`);
      toast.success('Super Admin transferred successfully');
      setTransferTarget(null);
      refreshMembers();
      window.location.href = '/login?reason=role_changed';
    } catch (err: any) {
      toast.error(err.message || 'Failed to transfer Super Admin');
    } finally {
      setTransferring(false);
    }
  };

  const [inviteForm, setInviteForm] = useState({
    name: '', email: '', role: 'TEAM_MEMBER', designation: '', teamId: ''
  });

  const roleOptions = [
    { label: 'Admin', value: 'ADMIN' },
    { label: 'Project Manager', value: 'PROJECT_MANAGER' },
    { label: 'Team Member', value: 'TEAM_MEMBER' },
  ];

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/settings/users', { ...inviteForm, name: toProperCase(inviteForm.name) });
      toast.success('Invitation sent');
      setShowInvite(false);
      setInviteForm({ name: '', email: '', role: 'TEAM_MEMBER', designation: '', teamId: '' });
      refreshMembers();
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
        name: toProperCase(editingUser.name),
        role: editingUser.role,
        designation: editingUser.designation,
        teamId: editingUser.teamId,
        status: editingUser.status
      });
      toast.success('User updated');
      setEditingUser(null);
      refreshMembers();
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
      refreshMembers();
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
      refreshMembers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete user');
    }
  };

  const designationOptions = Array.from(new Set((users || []).map((u: any) => u.designation).filter(Boolean))) as string[];

  return (
    <div className="space-y-6">
      <datalist id="designation-options">
        {designationOptions.map((d) => <option key={d} value={d} />)}
      </datalist>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary">Team Directory</h2>
          <p className="text-sm text-secondary">Manage access and roles for your team.</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-black transition-colors flex items-center justify-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" /> Invite Member
        </button>
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-left text-sm min-w-190">
            <thead className="bg-surface border-b border-border">
              <tr>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Name</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Role</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Team</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Designation</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs">Status</th>
                <th className="px-5 py-3 font-semibold text-secondary uppercase tracking-wide text-xs text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-[#F3F4F6] text-primary flex items-center justify-center text-xs font-medium border border-border">
                        {getInitials(u.name)}
                      </div>
                      <div>
                        <p className="font-semibold text-primary">{u.name}</p>
                        <p className="text-xs text-secondary">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-primary font-medium">
                    {getRoleLabel(u.role)}
                  </td>
                  <td className="px-5 py-3 text-secondary">
                    {u.team?.name || '—'}
                  </td>
                  <td className="px-5 py-3 text-secondary">
                    {u.designation || '—'}
                  </td>
                  <td className="px-5 py-3">
                    {u.status === 'ACTIVE' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#F3F4F6] text-primary border border-border uppercase tracking-wide">Active</span>}
                    {u.status === 'PENDING' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#F3F4F6] text-secondary border border-border uppercase tracking-wide">Pending</span>}
                    {u.status === 'INACTIVE' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#F9FAFB] text-[#9CA3AF] border border-border uppercase tracking-wide">Inactive</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {effectiveCurrentUser?.role === 'SUPER_ADMIN' && u.id !== effectiveCurrentUser.id && (
                        <button
                          onClick={() => { setTransferTarget(u); setConfirmOrgInput(''); }}
                          title="Transfer Super Admin"
                          className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-md transition-colors"
                        >
                          <Shield className="h-4 w-4" />
                        </button>
                      )}
                      <button onClick={() => setEditingUser(u)} className="p-1.5 text-secondary hover:text-primary hover:bg-[#F3F4F6] rounded-md transition-colors">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      {u.status !== 'INACTIVE' && (
                        <button onClick={() => handleDeactivate(u.id)} title="Deactivate" className="p-1.5 text-secondary hover:text-primary hover:bg-[#F3F4F6] rounded-md transition-colors">
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

        {/* Mobile Card View (Optimized for 320px+) */}
        <div className="md:hidden flex flex-col divide-y divide-border">
          {users.map((u) => (
            <div key={u.id} className="p-3.5 sm:p-4 hover:bg-[#F9FAFB] transition-colors relative">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-[#F3F4F6] text-primary flex items-center justify-center text-xs font-semibold border border-border shrink-0">
                    {getInitials(u.name)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-primary text-sm truncate">{u.name}</h3>
                    <p className="text-xs text-secondary truncate max-w-35 sm:max-w-none">{u.email}</p>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {effectiveCurrentUser?.role === 'SUPER_ADMIN' && u.id !== effectiveCurrentUser.id && (
                    <button
                      onClick={() => { setTransferTarget(u); setConfirmOrgInput(''); }}
                      title="Transfer Super Admin"
                      className="p-1.5 text-amber-600 hover:text-amber-800 bg-white border border-border hover:bg-amber-50 rounded-xl transition-all"
                    >
                      <Shield className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => setEditingUser(u)} className="p-1.5 text-secondary hover:text-primary bg-white border border-border hover:bg-[#F3F4F6] rounded-xl transition-all">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  {u.status !== 'INACTIVE' && (
                    <button onClick={() => handleDeactivate(u.id)} title="Deactivate" className="p-1.5 text-secondary hover:text-primary bg-white border border-border hover:bg-[#F3F4F6] rounded-xl transition-all">
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(u.id)} title="Permanently Delete" className="p-1.5 text-red-500 hover:text-red-700 bg-white border border-border hover:bg-red-50 rounded-xl transition-all">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 bg-[#F9FAFB] p-2.5 rounded-xl border border-border text-xs">
                <div className="min-w-0">
                  <span className="text-[10px] font-medium text-secondary uppercase tracking-wide block mb-0.5">Role</span>
                  <span className="font-medium text-primary block truncate">{getRoleLabel(u.role)}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-medium text-secondary uppercase tracking-wide block mb-0.5">Team</span>
                  <span className="text-secondary block truncate">{u.team?.name || '—'}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-medium text-secondary uppercase tracking-wide block mb-0.5">Designation</span>
                  <span className="text-secondary block truncate">{u.designation || '—'}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-medium text-secondary uppercase tracking-wide block mb-0.5">Status</span>
                  {u.status === 'ACTIVE' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-white text-primary border border-border uppercase">Active</span>}
                  {u.status === 'PENDING' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-white text-secondary border border-border uppercase">Pending</span>}
                  {u.status === 'INACTIVE' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-white text-[#9CA3AF] border border-border uppercase">Inactive</span>}
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-8 text-center text-sm text-secondary">No members found.</div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showInvite && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-md bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-surface sticky top-0 z-10 shrink-0">
                <h3 className="text-base font-semibold text-primary">Invite Member</h3>
                <button type="button" onClick={() => setShowInvite(false)} className="text-secondary hover:text-primary p-1 rounded-md hover:bg-border transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleInvite} className="p-4 sm:p-6 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label htmlFor="invite-name" className="text-sm font-medium text-[#374151]">Full Name</label>
                  <input id="invite-name" required value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="invite-email" className="text-sm font-medium text-[#374151]">Email Address</label>
                  <input id="invite-email" required type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-30 relative">
                  <label htmlFor="invite-role" className="text-sm font-medium text-[#374151]">Role</label>
                  <Select id="invite-role" ariaLabel="Role" value={inviteForm.role} onChange={(val) => setInviteForm({ ...inviteForm, role: val })} options={roleOptions} />
                </div>
                <div className="space-y-1.5 z-20 relative">
                  <label htmlFor="invite-team" className="text-sm font-medium text-[#374151]">Team (Optional)</label>
                  <Select 
                    id="invite-team"
                    ariaLabel="Team"
                    value={inviteForm.teamId || ''} 
                    onChange={(val) => setInviteForm({ ...inviteForm, teamId: val || '' })} 
                    options={[{ label: 'No Team', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.id })) || [])]} 
                  />
                </div>
                <div className="space-y-1.5 relative">
                  <label htmlFor="invite-designation" className="text-sm font-medium text-[#374151]">Designation (Optional)</label>
                  <input id="invite-designation" list="designation-options" placeholder="Select or type a designation…" value={inviteForm.designation || ''} onChange={(e) => setInviteForm({ ...inviteForm, designation: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                </div>
                <div className="pt-8 flex gap-3">
                  <button type="button" onClick={() => setShowInvite(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-[#374151] font-medium hover:bg-surface transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={() => setEditingUser(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-md bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-surface sticky top-0 z-10 shrink-0">
                <h3 className="text-base font-semibold text-primary">Edit User</h3>
                <button type="button" onClick={() => setEditingUser(null)} className="text-secondary hover:text-primary p-1 rounded-md hover:bg-border transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleUpdateUser} className="p-4 sm:p-6 space-y-4 flex-1">
                <div className="space-y-1.5">
                  <label htmlFor="edit-name" className="text-sm font-medium text-[#374151]">Full Name</label>
                  <input id="edit-name" required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-40 relative">
                  <label htmlFor="edit-role" className="text-sm font-medium text-[#374151]">Role</label>
                  <Select id="edit-role" ariaLabel="Role" value={editingUser.role} onChange={(val) => setEditingUser({ ...editingUser, role: val })} options={roleOptions} disabled={editingUser.role === 'SUPER_ADMIN'} />
                </div>
                <div className="space-y-1.5 z-30 relative">
                  <label htmlFor="edit-team" className="text-sm font-medium text-[#374151]">Team (Optional)</label>
                  <Select 
                    id="edit-team"
                    ariaLabel="Team"
                    value={editingUser.teamId || ''} 
                    onChange={(val) => setEditingUser({ ...editingUser, teamId: val ? val : null })} 
                    options={[{ label: 'No Team', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.id })) || [])]} 
                  />
                </div>
                <div className="space-y-1.5 relative">
                  <label htmlFor="edit-designation" className="text-sm font-medium text-[#374151]">Designation (Optional)</label>
                  <input id="edit-designation" list="designation-options" placeholder="Select or type a designation…" value={editingUser.designation || ''} onChange={(e) => setEditingUser({ ...editingUser, designation: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                </div>
                <div className="space-y-1.5 z-10 relative">
                  <label htmlFor="edit-status" className="text-sm font-medium text-[#374151]">Status</label>
                  <Select id="edit-status" ariaLabel="Status" value={editingUser.status} onChange={(val) => setEditingUser({ ...editingUser, status: val })} options={[{label: 'Active', value: 'ACTIVE'}, {label: 'Pending', value: 'PENDING'}, {label: 'Inactive', value: 'INACTIVE'}]} />
                </div>
                <div className="pt-8 flex gap-3">
                  <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-[#374151] font-medium hover:bg-surface transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Transfer Super Admin Modal */}
      <AnimatePresence>
        {transferTarget && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-100 flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl shadow-black/10 w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-surface shrink-0">
                <div className="flex items-center gap-2 text-amber-600 font-semibold">
                  <Shield className="h-5 w-5" />
                  <h3 className="text-base text-primary font-semibold">Transfer Super Admin</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="text-secondary hover:text-primary p-1 rounded-md hover:bg-border transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm space-y-1">
                  <p className="font-semibold">Warning: Demotion Notice</p>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    You are about to transfer Super Admin role to <strong>{transferTarget.name}</strong> ({transferTarget.email}).
                    You will be demoted to <strong>ADMIN</strong> and lose Super Admin privileges.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirm-org-input" className="block text-xs font-medium text-secondary uppercase tracking-wide">
                    Type <strong className="text-primary">{orgName}</strong> to confirm
                  </label>
                  <input
                    id="confirm-org-input"
                    type="text"
                    value={confirmOrgInput}
                    onChange={(e) => setConfirmOrgInput(e.target.value)}
                    placeholder={orgName}
                    className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="p-4 sm:p-6 pt-0 flex gap-3">
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-[#374151] font-medium hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeTransferSuperAdmin}
                  disabled={confirmOrgInput.trim().toLowerCase() !== orgName.trim().toLowerCase() || transferring}
                  className="flex-1 bg-amber-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {transferring ? 'Transferring...' : 'Transfer Role'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
