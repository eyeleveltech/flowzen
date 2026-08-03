'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials, toDateInput } from '@/lib/utils';
import { useMembers } from '@/hooks/useQueries';
import { useModalSafety } from '@/hooks/useModalSafety';
import { Field, FieldSelect, FieldCheckbox } from '@/components/ui/field';

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
    // billingAddress / gstNumber deliberately absent: they were never rendered here, so the form
    // was round-tripping values the user could not see or change. They belong on the client's
    // billing section, which is where quotations read them from.
    source: lead.source || 'MANUAL',
    assignedToId: lead.assignedToId || '',
    dealValue: lead.dealValue ? String(lead.dealValue) : '',
    expectedCloseDate: toDateInput(lead.expectedCloseDate),
    priority: lead.priority || 'MEDIUM',
    followUpDate: toDateInput(lead.followUpDate),
    lastContactedDate: toDateInput(lead.lastContactedDate),
    contractStartDate: toDateInput(lead.contractStartDate),
    contractEndDate: toDateInput(lead.contractEndDate),
    autoRenewal: Boolean(lead.autoRenewal),
  });

  const [errors, setErrors] = useState<{ companyName?: string; contactEmail?: string; contactPhone?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const initialFormRef = useRef(JSON.stringify(form));
  const isDirty = useCallback(() => {
    return JSON.stringify(form) !== initialFormRef.current;
  }, [form]);

  const { guardedClose, panelRef } = useModalSafety({ onClose, isDirty });

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

    // The company is the lead's identity; the contact person is optional (matches LeadModal
    // and the server's leadSchema). Formats are still validated when a value is supplied.
    const newErrors: { companyName?: string; contactEmail?: string; contactPhone?: string } = {};
    if (!form.companyName || form.companyName.trim().length < 2) newErrors.companyName = 'Company name is required.';

    if (form.contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail.trim())) {
      newErrors.contactEmail = 'Enter a valid email address.';
    }
    if (form.contactPhone.trim() && form.contactPhone.replace(/\D/g, '').length < 10) {
      newErrors.contactPhone = 'Phone must be at least 10 digits.';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        // null, not undefined — undefined reads as "don't touch this field", so clearing the box
        // left the old figure in place with no way to remove it.
        dealValue: form.dealValue ? parseFloat(form.dealValue) : null,
        expectedCloseDate: form.expectedCloseDate || null,
        followUpDate: form.followUpDate || null,
        lastContactedDate: form.lastContactedDate || null,
        contractStartDate: form.contractStartDate || null,
        contractEndDate: form.contractEndDate || null,
        autoRenewal: form.autoRenewal,
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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={guardedClose} />
      <motion.div
        ref={panelRef}
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
          <button onClick={guardedClose} className="p-2 text-secondary hover:text-primary rounded-lg hover:bg-[#F3F4F6] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="editLeadForm" onSubmit={handleSubmit} className="space-y-4">
            {/* The company IS the lead, so it leads the form and carries the required marker. */}
            <Field id="edit-company" label="Company" required value={form.companyName} error={errors.companyName} onChange={(v) => setForm({ ...form, companyName: v })} placeholder="Company name" />

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-contactName" label="Contact Name" value={form.contactName} onChange={(v) => setForm({ ...form, contactName: v })} placeholder="Full Name" />
              <Field id="edit-jobTitle" label="Job Title" value={form.jobTitle} onChange={(v) => setForm({ ...form, jobTitle: v })} placeholder="e.g. Marketing Director" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-email" label="Email" type="email" value={form.contactEmail} error={errors.contactEmail} onChange={(v) => setForm({ ...form, contactEmail: v })} placeholder="john@example.com" />
              <Field id="edit-phone" label="Phone" value={form.contactPhone} error={errors.contactPhone} onChange={(v) => setForm({ ...form, contactPhone: v })} placeholder="+91 ..." />
            </div>

            {/* LinkedIn removed here per corrections #53 — it lives on each contact instead. */}
            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-instagram" label="Instagram Handle" value={form.instagramHandle} onChange={(v) => setForm({ ...form, instagramHandle: v })} placeholder="@username or URL" />
              <Field id="edit-facebook" label="Facebook Page" value={form.facebookPage} onChange={(v) => setForm({ ...form, facebookPage: v })} placeholder="URL or username" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FieldSelect
                id="edit-companySize"
                label="Company Size"
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
              <FieldSelect
                id="edit-source"
                label="Source"
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
              <FieldSelect
                id="edit-priority"
                label="Priority"
                value={form.priority}
                onChange={(v) => setForm({ ...form, priority: v })}
                options={[
                  { label: 'High', value: 'HIGH' },
                  { label: 'Medium', value: 'MEDIUM' },
                  { label: 'Low', value: 'LOW' },
                ]}
              />
            </div>

            <FieldSelect
              id="edit-assignee"
              label="Assigned To"
              value={form.assignedToId}
              onChange={(v) => setForm({ ...form, assignedToId: v })}
              options={[
                { label: 'Unassigned', value: '' },
                ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))
              ]}
            />

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-dealValue" label="Deal Value (₹)" type="number" value={form.dealValue} onChange={(v) => setForm({ ...form, dealValue: v })} placeholder="e.g. 50000" />
              <Field id="edit-closeDate" label="Expected Close Date" type="date" value={form.expectedCloseDate} onChange={(v) => setForm({ ...form, expectedCloseDate: v })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-followUpDate" label="Next Follow-up Date" type="date" value={form.followUpDate} onChange={(v) => setForm({ ...form, followUpDate: v })} />
              <Field id="edit-lastContactedDate" label="Last Contacted Date" type="date" value={form.lastContactedDate} onChange={(v) => setForm({ ...form, lastContactedDate: v })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field id="edit-contractStartDate" label="Contract Start Date" type="date" value={form.contractStartDate} onChange={(v) => setForm({ ...form, contractStartDate: v })} />
              <Field id="edit-contractEndDate" label="Contract End Date" type="date" value={form.contractEndDate} onChange={(v) => setForm({ ...form, contractEndDate: v })} />
            </div>

            <FieldCheckbox
              id="edit-autoRenewal"
              label="Enable Auto-Renewal (Extends contract & updates billing date on expiry)"
              checked={form.autoRenewal}
              onChange={(checked) => setForm({ ...form, autoRenewal: checked })}
            />
          </form>
        </div>

        <div className="p-6 pb-safe border-t border-border bg-[#F9FAFB] shrink-0 flex items-center justify-end gap-3">
          <button type="button" onClick={guardedClose} className="px-4 py-2 text-sm font-medium text-[#374151] hover:bg-border rounded-xl transition-all">
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
