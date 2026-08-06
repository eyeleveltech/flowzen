import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, X, Edit2, Shield, Trash2, Mail, Building2, UserCircle, UserX } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Drawer } from '@/components/ui/drawer';
import { getInitials, getAvatarColor, toProperCase, getRoleLabel } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useConfirmStore, useAuthStore } from '@/stores';
import { Icon } from '@/components/ui/icon';

export function UsersTab({ users, fetchUsers, teams, currentUser }: { users: any[], fetchUsers: () => void, teams: any[], currentUser?: any }) {
  const [showInvite, setShowInvite] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [transferTarget, setTransferTarget] = useState<any | null>(null);
  const [confirmOrgInput, setConfirmOrgInput] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reassignModal, setReassignModal] = useState<{ userId: string; userName: string; openTaskCount: number } | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reassigning, setReassigning] = useState(false);

  const authUser = useAuthStore(state => state.user);
  const effectiveCurrentUser = currentUser || authUser;
  const orgName = effectiveCurrentUser?.organization?.name || 'Organization';

  const confirm = useConfirmStore(state => state.confirm);
  const queryClient = useQueryClient();

  const getRecordCountsSummary = (u: any) => {
    if (!u._count) return null;
    const parts: string[] = [];
    if (u._count.assignedTasks > 0) parts.push(`${u._count.assignedTasks} task${u._count.assignedTasks > 1 ? 's' : ''}`);
    if (u._count.comments > 0) parts.push(`${u._count.comments} comment${u._count.comments > 1 ? 's' : ''}`);
    if (u._count.projectMembers > 0) parts.push(`${u._count.projectMembers} project${u._count.projectMembers > 1 ? 's' : ''}`);
    if (u._count.assignedLeads > 0) parts.push(`${u._count.assignedLeads} lead${u._count.assignedLeads > 1 ? 's' : ''}`);
    if (u._count.stageChanges > 0) parts.push(`${u._count.stageChanges} stage change${u._count.stageChanges > 1 ? 's' : ''}`);
    if (u._count.activities > 0) parts.push(`${u._count.activities} activit${u._count.activities > 1 ? 'ies' : 'y'}`);
    if (u._count.notes > 0) parts.push(`${u._count.notes} note${u._count.notes > 1 ? 's' : ''}`);
    if (u._count.ownedProjects > 0) parts.push(`${u._count.ownedProjects} project${u._count.ownedProjects > 1 ? 's' : ''}`);
    if (u._count.assignedTasksBy > 0) parts.push(`${u._count.assignedTasksBy} assigned task${u._count.assignedTasksBy > 1 ? 's' : ''}`);
    if (u._count.reviewedTasks > 0) parts.push(`${u._count.reviewedTasks} review${u._count.reviewedTasks > 1 ? 's' : ''}`);
    if (u._count.managedClients > 0) parts.push(`${u._count.managedClients} client${u._count.managedClients > 1 ? 's' : ''}`);
    if (u._count?.createdWorkflows > 0) parts.push(`${u._count.createdWorkflows} workflow${u._count.createdWorkflows > 1 ? 's' : ''}`);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const getDeleteDisabledReason = (u: any, currentUser: any) => {
    if (u.role === 'SUPER_ADMIN') return 'Super Admin cannot be deleted';
    if (currentUser && u.id === currentUser.id) return 'You cannot delete your own account';
    const summary = getRecordCountsSummary(u);
    if (summary) return `Deactivate this user instead (${summary})`;
    return null;
  };

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
      const res = await api.post<{ emailSent?: boolean }>('/settings/users', { ...inviteForm, name: toProperCase(inviteForm.name) });
      // The account is always created; only claim we emailed them when the mail actually went out.
      if (res?.emailSent === false) {
        toast.error('Member added, but the invite email could not be sent. Use "Resend invite" once mail is configured.', { duration: 6000 });
      } else {
        toast.success('Invitation sent');
      }
      setShowInvite(false);
      setInviteForm({ name: '', email: '', role: 'TEAM_MEMBER', designation: '', teamId: '' });
      refreshMembers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invite');
    } finally {
      setSaving(false);
    }
  };

  const handleResendInvite = async (userId: string) => {
    try {
      await api.post(`/settings/users/${userId}/resend-invite`, {});
      toast.success('Invite email resent');
    } catch (err: any) {
      toast.error(err.message || 'Failed to resend invite');
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
        status: editingUser.status,
        // '' means "clear it" -> null (uncosted). Anything else goes as a number, because the
        // API takes a numeric rate and a string would be rejected by the schema.
        hourlyCostRate: editingUser.hourlyCostRate === '' || editingUser.hourlyCostRate == null
          ? null
          : Number(editingUser.hourlyCostRate),
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

  const handleDeactivate = async (u: any, reassignToId?: string) => {
    const targetId = typeof u === 'string' ? u : u.id;
    const targetName = typeof u === 'string' ? (users.find(usr => usr.id === u)?.name || 'this user') : u.name;

    if (!reassignToId) {
      const isConfirmed = await confirm({
        title: 'Deactivate User',
        message: `Are you sure you want to deactivate ${targetName}?`,
        confirmText: 'Deactivate',
        variant: 'warning'
      });
      if (!isConfirmed) return;
    }

    try {
      setReassigning(true);
      const payload: any = { status: 'INACTIVE' };
      if (reassignToId) payload.reassignTo = reassignToId;
      await api.put(`/settings/users/${targetId}`, payload);
      toast.success('User deactivated successfully');
      setReassignModal(null);
      setReassignTargetId('');
      fetchUsers();
    } catch (err: any) {
      if (err?.status === 409 && err?.openTaskCount) {
        setReassignModal({
          userId: targetId,
          userName: targetName,
          openTaskCount: err.openTaskCount,
        });
      } else {
        toast.error(err?.message || 'Failed to deactivate user');
      }
    } finally {
      setReassigning(false);
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
          <Icon as={Plus} size="md" /> Invite Member
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
                      <div className="h-8 w-8 rounded-full bg-subtle text-primary flex items-center justify-center text-xs font-medium border border-border">
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
                    {u.status === 'ACTIVE' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-subtle text-primary border border-border uppercase tracking-wide">Active</span>}
                    {u.status === 'PENDING' && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-subtle text-body-soft border border-border uppercase tracking-wide">Pending</span>}
                    {u.status === 'INACTIVE' && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface text-secondary border border-border uppercase tracking-wide">Inactive</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {effectiveCurrentUser?.role === 'SUPER_ADMIN' && u.id !== effectiveCurrentUser.id && (
                        <button
                          onClick={() => { setTransferTarget(u); setConfirmOrgInput(''); }}
                          title="Transfer Super Admin"
                          className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-md transition-colors"
                        >
                          <Icon as={Shield} size="md" />
                        </button>
                      )}
                      {u.status === 'PENDING' && (
                        <button
                          onClick={() => handleResendInvite(u.id)}
                          title="Resend invite email"
                          className="p-1.5 text-body hover:text-body hover:bg-subtle rounded-md transition-colors"
                        >
                          <Icon as={Mail} size="md" />
                        </button>
                      )}
                      <button
                        onClick={() => setEditingUser(u)}
                        title="Edit user"
                        className="p-1.5 text-secondary hover:text-primary hover:bg-subtle rounded-md transition-colors"
                      >
                        <Icon as={Edit2} size="md" />
                      </button>
                      {u.status !== 'INACTIVE' && (
                        <button
                          onClick={() => handleDeactivate(u)}
                          title="Deactivate user"
                          className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-lg transition-colors flex items-center gap-1.5 shrink-0"
                        >
                          <Icon as={UserX} size="sm" />

                        </button>
                      )}
                      {(() => {
                        const disabledReason = getDeleteDisabledReason(u, effectiveCurrentUser);
                        if (disabledReason) {
                          return (
                            <button
                              disabled
                              title={disabledReason}
                              className="p-1.5 text-gray-300 bg-gray-50 border border-gray-100 rounded-md cursor-not-allowed opacity-50"
                            >
                              <Icon as={Trash2} size="md" />
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => handleDelete(u.id)}
                            title="Permanently Delete"
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                          >
                            <Icon as={Trash2} size="md" />
                          </button>
                        );
                      })()}
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
            <div key={u.id} className="p-3.5 sm:p-4 hover:bg-surface transition-colors relative">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-subtle text-primary flex items-center justify-center text-xs font-semibold border border-border shrink-0">
                    {getInitials(u.name)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-primary text-sm truncate">{u.name}</h3>
                    <p className="text-xs text-secondary truncate max-w-35 sm:max-w-none">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {effectiveCurrentUser?.role === 'SUPER_ADMIN' && u.id !== effectiveCurrentUser.id && (
                    <button
                      onClick={() => { setTransferTarget(u); setConfirmOrgInput(''); }}
                      title="Transfer Super Admin"
                      className="p-1.5 text-amber-600 hover:text-amber-800 bg-white border border-border hover:bg-amber-50 rounded-xl transition-colors duration-150 motion-reduce:transition-none"
                    >
                      <Icon as={Shield} size="md" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditingUser(u)}
                    title="Edit user"
                    className="p-1.5 text-secondary hover:text-primary bg-white border border-border hover:bg-subtle rounded-xl transition-colors duration-150 motion-reduce:transition-none"
                  >
                    <Icon as={Edit2} size="md" />
                  </button>
                  {u.status !== 'INACTIVE' && (
                    <button
                      onClick={() => handleDeactivate(u)}
                      title="Deactivate user"
                      className="px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-xl transition-colors duration-150 motion-reduce:transition-none flex items-center gap-1 shrink-0"
                    >
                      <Icon as={UserX} size="sm" />
                    </button>
                  )}
                  {(() => {
                    const disabledReason = getDeleteDisabledReason(u, effectiveCurrentUser);
                    if (disabledReason) {
                      return (
                        <button
                          disabled
                          title={disabledReason}
                          className="p-1.5 text-gray-300 bg-gray-50 border border-gray-200 rounded-xl cursor-not-allowed opacity-50"
                        >
                          <Icon as={Trash2} size="md" />
                        </button>
                      );
                    }
                    return (
                      <button
                        onClick={() => handleDelete(u.id)}
                        title="Permanently Delete"
                        className="p-1.5 text-red-500 hover:text-red-700 bg-white border border-border hover:bg-red-50 rounded-xl transition-colors duration-150 motion-reduce:transition-none"
                      >
                        <Icon as={Trash2} size="md" />
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 bg-surface p-2.5 rounded-xl border border-border text-xs">
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
                  {u.status === 'INACTIVE' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-white text-secondary border border-border uppercase">Inactive</span>}
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-8 text-center text-sm text-secondary">No members found.</div>
          )}
        </div>
      </div>

      <Drawer variant="slideover" isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite Member">
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="invite-name" className="text-sm font-medium text-body">Full Name</label>
            <input id="invite-name" required value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="invite-email" className="text-sm font-medium text-body">Email Address</label>
            <input id="invite-email" required type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none" />
          </div>
          <div className="space-y-1.5 z-30 relative">
            <label htmlFor="invite-role" className="text-sm font-medium text-body">Role</label>
            <Select id="invite-role" ariaLabel="Role" value={inviteForm.role} onChange={(val) => setInviteForm({ ...inviteForm, role: val })} options={roleOptions} />
          </div>
          <div className="space-y-1.5 z-20 relative">
            <label htmlFor="invite-team" className="text-sm font-medium text-body">Team (Optional)</label>
            <Select
              id="invite-team"
              ariaLabel="Team"
              value={inviteForm.teamId || ''}
              onChange={(val) => setInviteForm({ ...inviteForm, teamId: val || '' })}
              options={[{ label: 'No Team', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.id })) || [])]}
            />
          </div>
          <div className="space-y-1.5 relative">
            <label htmlFor="invite-designation" className="text-sm font-medium text-body">Designation (Optional)</label>
            <input id="invite-designation" list="designation-options" placeholder="Select or type a designation…" value={inviteForm.designation || ''} onChange={(e) => setInviteForm({ ...inviteForm, designation: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none" />
          </div>
          <div className="pt-8 flex gap-3">
            <button type="button" onClick={() => setShowInvite(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-body font-medium hover:bg-surface transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
              {saving ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer variant="slideover" isOpen={!!editingUser} onClose={() => setEditingUser(null)} title="Edit User">
        {editingUser && (
          <form onSubmit={handleUpdateUser} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="edit-name" className="text-sm font-medium text-body">Full Name</label>
              <input id="edit-name" required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none" />
            </div>
            <div className="space-y-1.5 z-40 relative">
              <label htmlFor="edit-role" className="text-sm font-medium text-body">Role</label>
              <Select id="edit-role" ariaLabel="Role" value={editingUser.role} onChange={(val) => setEditingUser({ ...editingUser, role: val })} options={roleOptions} disabled={editingUser.role === 'SUPER_ADMIN'} />
            </div>
            <div className="space-y-1.5 z-30 relative">
              <label htmlFor="edit-team" className="text-sm font-medium text-body">Team (Optional)</label>
              <Select
                id="edit-team"
                ariaLabel="Team"
                value={editingUser.teamId || ''}
                onChange={(val) => setEditingUser({ ...editingUser, teamId: val ? val : null })}
                options={[{ label: 'No Team', value: '' }, ...(teams?.map(t => ({ label: t.name, value: t.id })) || [])]}
              />
            </div>
            <div className="space-y-1.5 relative">
              <label htmlFor="edit-designation" className="text-sm font-medium text-body">Designation (Optional)</label>
              <input id="edit-designation" list="designation-options" placeholder="Select or type a designation…" value={editingUser.designation || ''} onChange={(e) => setEditingUser({ ...editingUser, designation: e.target.value })} className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 outline-none transition-colors duration-150 motion-reduce:transition-none" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-cost-rate" className="text-sm font-medium text-body">Hourly Cost Rate (₹)</label>
              <input
                id="edit-cost-rate" type="number" min="0" step="1" placeholder="e.g. 500"
                value={editingUser.hourlyCostRate ?? ''}
                onChange={(e) => setEditingUser({ ...editingUser, hourlyCostRate: e.target.value })}
                className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              />
              {/* Says what it is AND what it is not — an internal costing figure is easily
                  mistaken for a client billing rate, and the two are never the same number. */}
              <p className="text-xs text-secondary">
                What an hour of this person&apos;s time costs the agency — used to price delivery
                effort into the per-project P&amp;L. Not a client billing rate. Leave blank if
                they aren&apos;t costed; past time entries keep the rate they were logged at.
              </p>
            </div>
            <div className="space-y-1.5 z-10 relative">
              <label htmlFor="edit-status" className="text-sm font-medium text-body">Status</label>
              <Select id="edit-status" ariaLabel="Status" value={editingUser.status} onChange={(val) => setEditingUser({ ...editingUser, status: val })} options={[{ label: 'Active', value: 'ACTIVE' }, { label: 'Pending', value: 'PENDING' }, { label: 'Inactive', value: 'INACTIVE' }]} />
            </div>
            <div className="pt-8 flex gap-3">
              <button type="button" onClick={() => setEditingUser(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-body font-medium hover:bg-surface transition-colors">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 bg-primary text-white px-4 py-2.5 rounded-xl font-medium hover:bg-black transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      {/* Transfer Super Admin Modal */}
      <AnimatePresence>
        {transferTarget && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-100 flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-modal shadow-black/10 w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-surface shrink-0">
                <div className="flex items-center gap-2 text-amber-600 font-semibold">
                  <Icon as={Shield} size="lg" />
                  <h3 className="text-base text-primary font-semibold">Transfer Super Admin</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="text-secondary hover:text-primary p-1 rounded-md hover:bg-border transition-colors"
                >
                  <Icon as={X} size="lg" />
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
                    className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm font-medium text-primary focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-colors duration-150 motion-reduce:transition-none"
                  />
                </div>
              </div>

              <div className="p-4 sm:p-6 pt-0 flex gap-3">
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-body font-medium hover:bg-surface transition-colors"
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

      {/* Reassign Open Tasks Modal on Deactivation */}
      <AnimatePresence>
        {reassignModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-modal border border-border space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-primary">Reassign Open Tasks</h3>
                <button onClick={() => setReassignModal(null)} className="text-secondary hover:text-primary"><Icon as={X} size="lg" /></button>
              </div>

              <p className="text-sm text-secondary">
                <strong className="text-primary">{reassignModal.userName}</strong> has <strong>{reassignModal.openTaskCount} open task(s)</strong> assigned. Select an active team member to reassign these tasks to before deactivating.
              </p>

              <div>
                <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">Reassign Tasks To</label>
                <Select
                  value={reassignTargetId}
                  onChange={(val) => setReassignTargetId(val)}
                  options={[
                    { value: '', label: 'Select Team Member...' },
                    ...users
                      .filter((usr) => usr.id !== reassignModal.userId && usr.status === 'ACTIVE')
                      .map((usr) => ({ value: usr.id, label: `${usr.name} (${usr.role.replace(/_/g, ' ')})` }))
                  ]}
                  placeholder="Select replacement..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReassignModal(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-secondary font-medium hover:bg-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeactivate(reassignModal.userId, reassignTargetId)}
                  disabled={!reassignTargetId || reassigning}
                  className="flex-1 bg-amber-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {reassigning ? 'Reassigning...' : 'Reassign & Deactivate'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
