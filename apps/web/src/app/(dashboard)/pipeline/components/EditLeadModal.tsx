'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { useMembers } from '@/hooks/useQueries';

export function EditLeadModal({ lead, onClose, onSuccess }: { lead: any; onClose: () => void; onSuccess: () => void; }) {
  const { data: members = [] } = useMembers();

  const [form, setForm] = useState({
    contactName: lead.contactName || '',
    companyName: lead.companyName || '',
    contactEmail: lead.contactEmail || '',
    contactPhone: lead.contactPhone || '',
    jobTitle: lead.jobTitle || '',
    instagramHandle: lead.instagramHandle || '',
    facebookPage: lead.facebookPage || '',
    companySize: lead.companySize || '',
    website: lead.website || '',
    industry: lead.industry || '',
    city: lead.city || '',
    state: lead.state || '',
    billingAddress: lead.billingAddress || '',
    gstNumber: lead.gstNumber || '',
    source: lead.source || 'MANUAL',
    assignedToId: lead.assignedToId || '',
    dealValue: lead.dealValue ? String(lead.dealValue) : '',
    expectedCloseDate: lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toISOString().split('T')[0] : '',
    priority: lead.priority || 'MEDIUM',
    followUpDate: lead.followUpDate ? new Date(lead.followUpDate).toISOString().split('T')[0] : '',
    linkedinUrl: lead.linkedinUrl || '',
    lastContactedDate: lead.lastContactedDate ? new Date(lead.lastContactedDate).toISOString().split('T')[0] : '',
  });

  const [errors, setErrors] = useState<{ contactName?: string; contactEmail?: string; contactPhone?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  // Lock body scroll when EditLeadModal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Null-safe: a lead may have no client yet (created before OUTREACH).
  const leadLabel = lead.contactName || lead.companyName || lead.client?.name || 'this lead';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Same hard gate as lead creation: name, email and phone are required.
    const newErrors: { contactName?: string; contactEmail?: string; contactPhone?: string } = {};
    if (!form.contactName || form.contactName.trim().length < 2) newErrors.contactName = 'Full name is required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail)) newErrors.contactEmail = 'A valid email is required.';
    if (form.contactPhone.replace(/\D/g, '').length < 10) newErrors.contactPhone = 'Phone must be at least 10 digits.';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        dealValue: form.dealValue ? parseFloat(form.dealValue) : undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
        followUpDate: form.followUpDate || null,
        lastContactedDate: form.lastContactedDate || null,
        assignedToId: form.assignedToId || undefined,
      };
      await api.patch(`/crm/leads/${lead.id}`, payload);
      toast.success('Lead updated successfully');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col border-l border-border"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-primary">Edit Lead Details</h2>
            <p className="text-sm text-secondary">Update information for {leadLabel}</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#9CA3AF] hover:text-primary rounded-lg hover:bg-[#F3F4F6] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="editLeadForm" onSubmit={handleSubmit} className="space-y-4">
            <Field id="edit-contactName" label="Contact Name" required value={form.contactName} error={errors.contactName} onChange={(v) => setForm({ ...form, contactName: v })} placeholder="Full Name" />

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-email" label="Email" type="email" required value={form.contactEmail} error={errors.contactEmail} onChange={(v) => setForm({ ...form, contactEmail: v })} placeholder="john@example.com" />
              <Field id="edit-phone" label="Phone" required value={form.contactPhone} error={errors.contactPhone} onChange={(v) => setForm({ ...form, contactPhone: v })} placeholder="+91 ..." />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-company" label="Company" value={form.companyName} onChange={(v) => setForm({ ...form, companyName: v })} placeholder="Company name" />
              <Field id="edit-jobTitle" label="Job Title" value={form.jobTitle} onChange={(v) => setForm({ ...form, jobTitle: v })} placeholder="e.g. Marketing Director" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-linkedin" label="LinkedIn Profile URL" value={form.linkedinUrl} onChange={(v) => setForm({ ...form, linkedinUrl: v })} placeholder="https://linkedin.com/..." />
              <Field id="edit-instagram" label="Instagram Handle" value={form.instagramHandle} onChange={(v) => setForm({ ...form, instagramHandle: v })} placeholder="@username or URL" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-facebook" label="Facebook Page" value={form.facebookPage} onChange={(v) => setForm({ ...form, facebookPage: v })} placeholder="URL or username" />
              <div />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-companySize" className="block text-sm font-medium text-[#374151] mb-1.5">Company Size</label>
                <Select
                  value={form.companySize}
                  onChange={(v) => setForm({ ...form, companySize: v })}
                  options={[
                    { label: 'Select Size', value: '' },
                    { label: '1–10', value: '1-10' },
                    { label: '11–100', value: '11-100' },
                    { label: '101–500', value: '101-500' },
                    { label: '501–1,000', value: '501-1000' },
                    { label: '1,000+', value: '1000+' },
                  ]}
                />
              </div>
              <Field id="edit-website" label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="example.com" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-industry" label="Industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} placeholder="e.g. IT/SaaS" />
              <Field id="edit-city" label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} placeholder="City" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-state" label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} placeholder="e.g. Tamil Nadu" />
              <div />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-source" className="block text-sm font-medium text-[#374151] mb-1.5">Source</label>
                <Select
                  value={form.source}
                  onChange={(v) => setForm({ ...form, source: v })}
                  options={[
                    { label: 'LinkedIn', value: 'LINKEDIN' },
                    { label: 'Referral', value: 'REFERRAL' },
                    { label: 'Inbound Form', value: 'INBOUND' },
                    { label: 'Event', value: 'EVENT' },
                    { label: 'Manual', value: 'MANUAL' },
                    { label: 'Other', value: 'OTHER' },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="edit-priority" className="block text-sm font-medium text-[#374151] mb-1.5">Priority</label>
                <Select
                  value={form.priority}
                  onChange={(v) => setForm({ ...form, priority: v })}
                  options={[
                    { label: 'High', value: 'HIGH' },
                    { label: 'Medium', value: 'MEDIUM' },
                    { label: 'Low', value: 'LOW' },
                  ]}
                />
              </div>
            </div>

            <div>
              <label htmlFor="edit-assignee" className="block text-sm font-medium text-[#374151] mb-1.5">Assigned To</label>
              <Select
                value={form.assignedToId}
                onChange={(v) => setForm({ ...form, assignedToId: v })}
                options={[
                  { label: 'Unassigned', value: '' },
                  ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-dealValue" label="Deal Value (₹)" type="number" value={form.dealValue} onChange={(v) => setForm({ ...form, dealValue: v })} placeholder="e.g. 50000" />
              <Field id="edit-closeDate" label="Expected Close Date" type="date" value={form.expectedCloseDate} onChange={(v) => setForm({ ...form, expectedCloseDate: v })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-followUpDate" label="Next Follow-up Date" type="date" value={form.followUpDate} onChange={(v) => setForm({ ...form, followUpDate: v })} />
              <Field id="edit-lastContactedDate" label="Last Contacted Date" type="date" value={form.lastContactedDate} onChange={(v) => setForm({ ...form, lastContactedDate: v })} />
            </div>
          </form>
        </div>

        <div className="p-6 pb-safe border-t border-border bg-[#F9FAFB] shrink-0 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#374151] hover:bg-border rounded-xl transition-all">
            Cancel
          </button>
          <button
            type="submit"
            form="editLeadForm"
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-[#1F2937] transition-all disabled:opacity-50"
          >
            {submitting ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      </motion.div>
    </>
  );
}

function Field({ id, label, value, onChange, type = 'text', required = false, placeholder, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string; error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#374151] mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm outline-none focus:ring-1 transition-all ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : 'border-border focus:border-primary focus:ring-primary'}`}
      />
      {error && <p id={`${id}-error`} aria-live="polite" className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
