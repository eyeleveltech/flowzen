'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, Plus, Users, Pencil, Trash2, UserPlus, UserMinus, Crown, X } from 'lucide-react';
import { api, ApiError, atLeast, type OrgConfig, type Member } from '@/lib/api-v2';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';

type DepartmentUser = {
  id: string;
  name: string;
  avatar: string | null;
  email?: string;
};

type Department = {
  id: string;
  name: string;
  headId?: string | null;
  head?: DepartmentUser | null;
  users?: DepartmentUser[];
  _count?: { users: number; tasks: number };
};

function DepartmentModal({
  open,
  initial,
  team,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Department | null; // null = create
  team: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [headId, setHeadId] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [addingMemberId, setAddingMemberId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setHeadId(initial?.headId ?? initial?.head?.id ?? '');
      setSelectedMemberIds(initial?.users?.map((u) => u.id) ?? []);
      setAddingMemberId('');
      setError(null);
    }
  }, [open, initial]);

  const handleAddMember = () => {
    if (addingMemberId && !selectedMemberIds.includes(addingMemberId)) {
      setSelectedMemberIds([...selectedMemberIds, addingMemberId]);
      setAddingMemberId('');
    }
  };

  const handleRemoveMember = (userId: string) => {
    setSelectedMemberIds(selectedMemberIds.filter((id) => id !== userId));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        headId: headId || null,
        memberIds: selectedMemberIds,
      };
      if (initial) {
        await api.departments.update(initial.id, payload);
      } else {
        await api.departments.create(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save department');
    } finally {
      setSaving(false);
    }
  };

  const userOptions = [
    { value: '', label: '— Select Manager / Head —' },
    ...team.map((m) => ({ value: m.id, label: `${m.name} (${m.role})` })),
  ];

  const availableUsersToAdd = team.filter((m) => !selectedMemberIds.includes(m.id));

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Department' : 'New Department'}>
      <form onSubmit={submit}>
        <ModalBody className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
          {error && <p className="text-sm font-medium text-red-600 bg-red-50 p-2.5 rounded-md border border-red-200">{error}</p>}

          {/* Department Name */}
          <Field
            label="Department Name"
            value={name}
            onChange={setName}
            required
            placeholder="e.g. Engineering, Design, Marketing"
          />

          {/* Department Head / Manager */}
          <div>
            <FieldSelect
              label="Department Head / Manager"
              value={headId}
              onChange={setHeadId}
              options={userOptions}
            />
            <p className="mt-1 text-xs text-secondary">
              The person leading this department.
            </p>
          </div>

          {/* Members / People Section */}
          <div className="space-y-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-secondary">
                Department Members ({selectedMemberIds.length})
              </label>
            </div>

            {/* List of current assigned members */}
            {selectedMemberIds.length === 0 ? (
              <p className="text-sm text-secondary italic bg-subtle/50 p-3 rounded-md border border-dashed border-border text-center">
                No team members added yet. Choose from below to add people.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-surface rounded-md border border-border">
                {selectedMemberIds.map((userId) => {
                  const user = team.find((t) => t.id === userId);
                  const isHead = userId === headId;
                  return (
                    <div
                      key={userId}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                        isHead
                          ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                          : 'bg-subtle text-primary border-border shadow-xs'
                      }`}
                    >
                      {user?.avatar ? (
                        <img src={user.avatar} alt="" className="h-4 w-4 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className={`h-4 w-4 rounded-full text-[9px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(user?.name)}`}>
                          {getInitials(user?.name ?? '')}
                        </span>
                      )}
                      {isHead && <Crown className="h-3 w-3 text-amber-500 shrink-0" />}
                      <span>{user?.name ?? 'Unknown user'}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(userId)}
                        className="ml-1 text-secondary hover:text-red-500 rounded-full p-0.5"
                        title="Remove person"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Person Selector */}
            {availableUsersToAdd.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={addingMemberId}
                  onChange={(e) => setAddingMemberId(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-primary shadow-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select a person to add…</option>
                  {availableUsersToAdd.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAddMember}
                  disabled={!addingMemberId}
                  className="bg-subtle text-primary hover:bg-muted font-medium border border-border"
                >
                  <UserPlus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>
            {initial ? 'Save Changes' : 'Create Department'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, cfg, teamList] = await Promise.all([
        api.departments.list() as unknown as Promise<Department[]>,
        api.config.get(),
        api.users.list().catch(() => [] as Member[]),
      ]);
      setDepartments(Array.isArray(list) ? list : []);
      setConfig(cfg);
      setTeam(teamList.filter((u) => u.status === 'ACTIVE'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load departments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this department? Tasks assigned to it will become unassigned.')) return;
    setDeleting(id);
    try {
      await api.departments.delete(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete department');
    } finally {
      setDeleting(null);
    }
  };

  const canManage = atLeast(config?.me.role as any, 'MANAGER');

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Departments"
        subtitle={`${departments.length} department${departments.length !== 1 ? 's' : ''}`}
        action={
          canManage && (
            <Button
              className="gap-2"
              onClick={() => { setEditing(null); setModalOpen(true); }}
            >
              <Plus className="h-4 w-4" />
              Add Department
            </Button>
          )
        }
      />

      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      {departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments yet"
          hint="Create your first department to organise your team's tasks."
          action={
            canManage ? (
              <Button onClick={() => { setEditing(null); setModalOpen(true); }}>
                Add Department
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR className="bg-surface hover:bg-surface">
              <TH>DEPARTMENT</TH>
              <TH>HEAD / MANAGER</TH>
              <TH>MEMBERS</TH>
              <TH>ACTIVE TASKS</TH>
              {canManage && <TH className="text-right">ACTIONS</TH>}
            </TR>
          </THead>
          <TBody>
            {departments.map((dept) => (
              <TR key={dept.id} className="hover:bg-subtle group transition-colors">
                <TD className="font-semibold text-primary py-3.5 text-xs">{dept.name}</TD>
                <TD>
                  {dept.head ? (
                    <div className="flex items-center gap-2">
                      {dept.head.avatar ? (
                        <img src={dept.head.avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0 border border-border" />
                      ) : (
                        <span className={`h-6 w-6 rounded-full font-bold text-[10px] flex items-center justify-center shrink-0 ${getAvatarColor(dept.head.name)}`}>
                          {getInitials(dept.head.name)}
                        </span>
                      )}
                      <span className="text-xs text-primary font-medium">{dept.head.name}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">— Unassigned —</span>
                  )}
                </TD>
                <TD>
                  <button
                    onClick={() => { setEditing(dept); setModalOpen(true); }}
                    className="flex items-center gap-1.5 text-secondary hover:text-primary transition-colors text-xs font-medium hover:underline"
                  >
                    <Users className="h-3.5 w-3.5" />
                    <span>{dept._count?.users ?? dept.users?.length ?? 0} members</span>
                  </button>
                </TD>
                <TD className="text-xs text-secondary font-medium">{dept._count?.tasks ?? 0} tasks</TD>
                {canManage && (
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit Department"
                        onClick={() => { setEditing(dept); setModalOpen(true); }}
                        className="h-8 w-8 p-0 text-secondary hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-secondary hover:text-red-600"
                        title="Delete Department"
                        onClick={() => handleDelete(dept.id)}
                        disabled={deleting === dept.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <DepartmentModal
        open={modalOpen}
        initial={editing}
        team={team}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
