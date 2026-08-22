'use client';

import { useEffect, useState } from 'react';
import { Globe, Smartphone, ShoppingBag, FileCode, Share2, Search, Zap, Package } from 'lucide-react';
import { api, type Member, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/empty-state';
import { MultiSelect, type Option } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';

interface EngagementContext {
  id: string;
  type: 'RETAINER' | 'PROJECT';
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
}

const PLATFORM_OPTIONS: Option[] = [
  { value: 'WEB', label: 'Web Application', icon: <Globe className="h-4 w-4 text-sky-500" /> },
  { value: 'MOBILE_APP', label: 'Mobile App (iOS / Android)', icon: <Smartphone className="h-4 w-4 text-emerald-500" /> },
  { value: 'SHOPIFY', label: 'Shopify / E-Commerce', icon: <ShoppingBag className="h-4 w-4 text-indigo-500" /> },
  { value: 'WORDPRESS', label: 'WordPress / CMS', icon: <FileCode className="h-4 w-4 text-blue-500" /> },
  { value: 'SOCIAL_MEDIA', label: 'Social Media Marketing', icon: <Share2 className="h-4 w-4 text-pink-500" /> },
  { value: 'SEO_MARKETING', label: 'SEO & Digital Marketing', icon: <Search className="h-4 w-4 text-amber-500" /> },
  { value: 'CUSTOM_PLATFORM', label: 'Custom Platform', icon: <Zap className="h-4 w-4 text-violet-500" /> },
  { value: 'OTHER', label: 'Other', icon: <Package className="h-4 w-4 text-gray-500" /> },
];

export function NewProjectModal({
  companyId,
  engagements,
  onConfirm,
  onCancel,
}: {
  companyId: string;
  engagements: EngagementContext[];
  onConfirm: (project: { id: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['WEB']);
  const [type, setType] = useState('ONE_TIME');
  const [status, setStatus] = useState('PLANNING');
  const [priority, setPriority] = useState('MEDIUM');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  
  const [ownerId, setOwnerId] = useState('');
  const [team, setTeam] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.users.list().then((res) => {
      setTeam(res.filter((m) => m.status === 'ACTIVE'));
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const project = await api.projects.create({
        companyId,
        name,
        description: description || null,
        scope: scope || null,
        platform: platforms.length > 0 ? platforms.join(',') : null,
        type,
        status,
        priority,
        startDate: startDate || null,
        dueDate: dueDate || null,
        ownerId: ownerId || null,
        memberIds: selectedMembers,
      });
      onConfirm(project as { id: string });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create project');
      setSaving(false);
    }
  };

  const activeEngagements = engagements.filter((e) => e.status === 'ACTIVE');

  return (
    <Modal open onClose={onCancel} title="New Project" size="lg">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {activeEngagements.length > 0 && (
            <div className="rounded-lg bg-surface p-3 text-sm border border-border">
              <p className="font-semibold text-primary">Context: Active Engagements</p>
              <ul className="mt-1 space-y-1 text-secondary text-xs">
                {activeEngagements.map((e) => (
                  <li key={e.id}>
                    • {e.type === 'RETAINER' ? 'Retainer' : 'Fixed Project'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Project Name *" value={name} onChange={setName} placeholder="e.g. Suvai Foods Mobile App" required />

          {/* MultiSelect Platforms with Lucide SVG Icons */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-secondary">Platforms / Technologies</label>
            <MultiSelect
              compact={false}
              placeholder="Select platforms (Web, Mobile, Social Media...)"
              options={PLATFORM_OPTIONS}
              value={platforms}
              onChange={setPlatforms}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect
              label="Project Type"
              value={type}
              onChange={setType}
              options={[
                { value: 'ONE_TIME', label: 'One-Time Project' },
                { value: 'RETAINER', label: 'Retainer' },
              ]}
            />
            <FieldSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'PLANNING', label: 'Planning' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'ON_HOLD', label: 'On Hold' },
                { value: 'COMPLETED', label: 'Completed' },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect
              label="Priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
                { value: 'URGENT', label: 'Urgent' },
              ]}
            />
            <FieldSelect
              label="Project Owner"
              value={ownerId}
              onChange={setOwnerId}
              options={[
                { value: '', label: 'Unassigned' },
                ...team.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start Date" type="date" value={startDate} onChange={setStartDate} />
            <Field label="Due Date" type="date" value={dueDate} onChange={setDueDate} />
          </div>

          {/* Team Members MultiSelect Dropdown */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-secondary">Team Members</label>
            <MultiSelect
              compact={false}
              placeholder="Click to add team members..."
              options={team.map((m) => ({ value: m.id, label: m.name }))}
              value={selectedMembers}
              onChange={setSelectedMembers}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the project..."
              rows={2}
              className="w-full rounded-xl border border-border bg-white p-3 text-sm text-body placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>

          {/* Scope of Work Rich Text Editor */}
          <div>
            <label className="block text-xs font-semibold text-secondary mb-1">Scope of Work (Rich Text)</label>
            <RichTextEditor
              value={scope}
              onChange={setScope}
              placeholder="Detailed deliverables, milestones, and scope guidelines..."
            />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name}>
            Create Project
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
