'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Save, Upload, FileText, User, Briefcase, Mail, Phone, Building2, Calendar, IndianRupee, Search, ChevronDown, Check, AlignLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { useMembers, useClients } from '@/hooks/useQueries';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useQueryClient } from '@tanstack/react-query';

export function LeadModal({ onClose, onSuccess, initialMode = 'MANUAL' }: { onClose: () => void; onSuccess: () => void; initialMode?: 'MANUAL' | 'BULK' }) {
  const queryClient = useQueryClient();
  const { data: members = [] } = useMembers();
  const { data: clients = [] } = useClients();
  
  const [form, setForm] = useState({
    clientId: '',
    contactName: '',
    companyName: '',
    jobTitle: '',
    email: '',
    phone: '',
    source: 'MANUAL',
    linkedinUrl: '',
    assignedToId: '',
    dealValue: '',
    expectedRevenue: '',
    expectedCloseDate: '',
    followUpDate: '',
    industry: '',
    city: '',
    state: '',
    companySize: '',
    website: '',
    billingAddress: '',
    gstNumber: '',
    notes: '',
    priority: 'MEDIUM',
  });

  const [errors, setErrors] = useState<{ contactName?: string; email?: string; phone?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [creationMode, setCreationMode] = useState<'MANUAL' | 'BULK'>(initialMode);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; rejectedCount: number; rejected: any[] } | null>(null);

  // Client Combobox State
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredClients = clients?.filter((c: any) => 
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) || 
    (c.company && c.company.toLowerCase().includes(clientSearch.toLowerCase()))
  ) || [];

  const handleSelectClient = (client: any) => {
    setForm(prev => ({
      ...prev,
      clientId: client.id,
      contactName: client.name,
      companyName: client.company || '',
      email: client.email || '',
      phone: client.phone || '',
      industry: client.industry || '',
      city: client.city || ''
    }));
    setClientSearch(client.company || client.name);
    setShowClientDropdown(false);
  };

  const handleClientSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setClientSearch(e.target.value);
    setForm(prev => ({ ...prev, clientId: '', companyName: e.target.value }));
    setShowClientDropdown(true);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Lead Entry Gateway — name, email and phone are required.
    const newErrors: { contactName?: string; email?: string; phone?: string } = {};
    if (!form.contactName || form.contactName.trim().length < 2) newErrors.contactName = 'Full name is required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) newErrors.email = 'A valid email is required.';
    if (form.phone.replace(/\D/g, '').length < 10) newErrors.phone = 'Phone must be at least 10 digits.';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        dealValue: form.dealValue ? parseFloat(form.dealValue) : undefined,
        expectedRevenue: form.expectedRevenue ? parseFloat(form.expectedRevenue) : undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
        followUpDate: form.followUpDate || undefined,
      };

      await api.post('/crm/leads', payload);
      toast.success('Lead added successfully');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  // ... Drag and drop logic (kept mostly the same but shortened for brevity)
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }
  function processFile(file: File) {
    setImportFile(file);
    setImportResult(null);
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          setImportPreview(XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[]);
        } catch { toast.error('Failed to parse Excel file'); }
      };
      reader.onerror = () => toast.error('Failed to read file');
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => setImportPreview(res.data as any[]), error: () => toast.error('Failed to parse CSV file') });
    }
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }
  async function handleBulkImport() {
    if (!importPreview.length) return;
    setImporting(true);
    try {
      // Send every row; the server validates each and returns the rejected ones with reasons.
      const payload = importPreview.map((row: any) => ({
        contactName: row.ContactName ?? row.contactName ?? row['Full Name'] ?? '',
        companyName: row.CompanyName ?? row.companyName ?? row.Company ?? '',
        email: row.Email ?? row.email ?? '',
        phone: row.Phone ?? row.phone ?? row.Mobile ?? row.mobile ?? '',
        stage: row.Stage ?? row.stage ?? 'NEW_LEAD',
        linkedinUrl: row.LinkedinUrl ?? row.linkedinUrl ?? '',
        dealValue: row.DealValue ?? row.dealValue ?? '',
        expectedCloseDate: row.ExpectedCloseDate ?? row.expectedCloseDate ?? '',
        industry: row.Industry ?? row.industry ?? '',
        city: row.City ?? row.city ?? '',
        companySize: row.CompanySize ?? row.companySize ?? '',
        website: row.Website ?? row.website ?? '',
        notes: row.Notes ?? row.notes ?? '',
      }));

      if (payload.length > 500) { toast.error('Max 500 leads at a time.'); setImporting(false); return; }
      const res = await api.post<{ imported: number; rejectedCount: number; rejected: any[] }>('/crm/leads/bulk', { leads: payload });
      setImportResult(res);
      if (res.imported > 0) toast.success(`Imported ${res.imported} lead${res.imported === 1 ? '' : 's'}`);
      else toast.error('No leads imported — see the rejection report.');
    } catch (err: any) { toast.error(err.message || 'Failed to import leads'); } finally { setImporting(false); }
  }

  function downloadRejectionReport() {
    if (!importResult?.rejected?.length) return;
    const csv = Papa.unparse(importResult.rejected);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rejected_leads_${Date.now()}.csv`;
    link.click();
  }

  function downloadTemplate() {
    const csv = Papa.unparse([{ ContactName: 'John Doe', CompanyName: 'Example LLC', Email: 'john@example.com', Phone: '+1-555-0100', Stage: 'NEW_LEAD', DealValue: '50000', ExpectedCloseDate: '2026-06-01', Industry: 'IT/SaaS', City: 'Chennai', Website: 'example.com', Notes: 'Needs immediate follow up' }]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'lead_import_template.csv'; link.click();
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: '100%' }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-primary">Add New Lead</h2>
            <p className="text-sm text-secondary mt-0.5">Enter details to add a new prospect to your pipeline.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-secondary" />
          </button>
        </div>

        <div className="flex gap-6 px-6 border-b border-border bg-gray-50/50">
            <button
              onClick={() => setCreationMode('MANUAL')}
              className={`pb-3 mt-4 text-sm font-medium border-b-2 transition-colors ${creationMode === 'MANUAL' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-[#374151]'}`}
            >
              Manual Entry
            </button>
            <button
              onClick={() => setCreationMode('BULK')}
              className={`pb-3 mt-4 text-sm font-medium border-b-2 transition-colors ${creationMode === 'BULK' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-[#374151]'}`}
            >
              Bulk Import
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
          {creationMode === 'MANUAL' ? (
          <form id="lead-form" onSubmit={handleSubmit} className="space-y-8">
                
                {/* SECTION 1: Lead Information */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <Briefcase className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-primary">1. Lead Information</h3>
                  </div>

                  {/* Client Search / Autocomplete */}
                  <div className="relative" ref={clientDropdownRef}>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Client / Company Name <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary" />
                      <input
                        type="text"
                        value={clientSearch}
                        onChange={handleClientSearchChange}
                        onFocus={() => setShowClientDropdown(true)}
                        placeholder="Search existing clients or type company name..."
                        className={`w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all ${form.clientId ? 'bg-blue-50 border-blue-200 text-blue-900' : ''}`}
                      />
                      {form.clientId && (
                        <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-600" />
                      )}
                    </div>
                    
                    {showClientDropdown && clientSearch.length > 0 && filteredClients.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto p-1">
                        {filteredClients.map((client: any) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => handleSelectClient(client)}
                            className="w-full text-left px-3 py-2 text-sm text-[#374151] hover:bg-gray-50 rounded-lg flex flex-col transition-colors"
                          >
                            <span className="font-medium">{client.name}</span>
                            {client.company && <span className="text-xs text-secondary">{client.company}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="LinkedIn URL" value={form.linkedinUrl} onChange={(v) => setForm({ ...form, linkedinUrl: v })} placeholder="linkedin.com/in/username" />
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Priority <span className="text-red-500">*</span></label>
                      <div className="relative">
                        <select
                          value={form.priority}
                          onChange={(e) => setForm({ ...form, priority: e.target.value })}
                          className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-[#374151] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all appearance-none"
                        >
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                          <PriorityDot level={form.priority} />
                        </div>
                        <style>{`select { padding-left: 2rem !important; }`}</style>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Lead Source <span className="text-red-500">*</span></label>
                      <Select
                        value={form.source}
                        onChange={(v) => setForm({ ...form, source: v })}
                        options={[
                          { label: 'LinkedIn', value: 'LINKEDIN' },
                          { label: 'Referral', value: 'REFERRAL' },
                          { label: 'Inbound Form', value: 'INBOUND' },
                          { label: 'Event', value: 'EVENT' },
                          { label: 'Manual', value: 'MANUAL' },
                          { label: 'Other', value: 'OTHER' }
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Industry</label>
                      <Select
                        value={form.industry}
                        onChange={(v) => setForm({ ...form, industry: v })}
                        options={[
                          { label: 'Select Industry', value: '' },
                          { label: 'Real Estate', value: 'Real Estate' },
                          { label: 'IT/SaaS', value: 'IT/SaaS' },
                          { label: 'Healthcare', value: 'Healthcare' },
                          { label: 'Automotive', value: 'Automotive' },
                          { label: 'Manufacturing', value: 'Manufacturing' },
                          { label: 'Other', value: 'Other' },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Company Size</label>
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
                    <Field label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} placeholder="example.com" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} placeholder="e.g. Tamil Nadu" />
                    <Field label="Follow-up Date" type="date" value={form.followUpDate} onChange={(v) => setForm({ ...form, followUpDate: v })} />
                  </div>
                </div>

                {/* SECTION 2: Contact Details */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <User className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-primary">2. Contact Details</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Contact Name" required error={errors.contactName} value={form.contactName} onChange={(v) => {
                      setForm({ ...form, contactName: v });
                    }} placeholder="Full Name" />
                    <Field label="Job Title" value={form.jobTitle} onChange={(v) => setForm({ ...form, jobTitle: v })} placeholder="e.g. Marketing Director" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Email Address" required error={errors.email} type="email" icon={<Mail className="h-4 w-4 text-secondary" />} value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="john@example.com" />
                    <Field label="Phone Number" required error={errors.phone} icon={<Phone className="h-4 w-4 text-secondary" />} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+1 (555) 000-0000" />
                  </div>
                </div>

                {/* SECTION 3: Assignment & Notes */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <AlignLeft className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-primary">3. Assignment & Notes</h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Owner <span className="text-red-500">*</span></label>
                    <Select
                      value={form.assignedToId}
                      onChange={(v) => setForm({ ...form, assignedToId: v })}
                      options={[
                        { label: 'Unassigned', value: '' },
                        ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))
                      ]}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Notes / Description</label>
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={3}
                      className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none"
                      placeholder="Enter details, background info, or next steps..."
                    />
                  </div>
                </div>

          </form>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-white shadow-sm">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Need a template?</h3>
                  <p className="text-xs text-secondary mt-1">CSV or Excel (.xlsx). <span className="font-medium text-[#374151]">Name, Email and Phone are required</span> on every row.</p>
                </div>
                <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-border bg-gray-50 px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-gray-100 transition-all">
                  <FileText className="h-3.5 w-3.5" /> Template
                </button>
              </div>

              <div>
                <label 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed transition-colors rounded-xl cursor-pointer bg-white ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary hover:bg-gray-50'}`}
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-3 text-secondary" />
                    <p className="mb-2 text-sm text-primary">
                      <span className="font-semibold">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-secondary">CSV or XLSX files</p>
                  </div>
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
                </label>
                {importFile && (
                  <p className="text-sm text-primary mt-3 font-medium flex items-center gap-2 bg-white border border-border p-3 rounded-lg shadow-sm">
                    <FileText className="h-4 w-4 text-green-500" /> {importFile.name}
                  </p>
                )}
              </div>

              {importResult ? (
                <div className={`p-4 rounded-xl border ${importResult.rejectedCount > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
                  <h4 className="text-sm font-semibold text-primary mb-1">Import complete</h4>
                  <p className="text-sm text-[#374151]">
                    <span className="font-semibold text-emerald-700">{importResult.imported} imported</span>
                    {importResult.rejectedCount > 0 && <>, <span className="font-semibold text-amber-700">{importResult.rejectedCount} rejected</span></>}.
                  </p>
                  {importResult.rejectedCount > 0 && (
                    <button onClick={downloadRejectionReport} className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 transition-all">
                      <FileText className="h-3.5 w-3.5" /> Download rejection report
                    </button>
                  )}
                </div>
              ) : importPreview.length > 0 && (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                  <h4 className="text-sm font-semibold text-blue-900 mb-1">Ready to Import</h4>
                  <p className="text-sm text-blue-700">Found {importPreview.length} row{importPreview.length === 1 ? '' : 's'}. Each will be validated on import.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 border-t border-border bg-white flex flex-row justify-end gap-2 sm:gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] z-10">
          <button type="button" onClick={onClose} className="flex-1 sm:flex-none w-full sm:w-auto px-2 sm:px-5 py-2.5 text-sm font-medium text-[#374151] bg-white border border-border rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          {creationMode === 'MANUAL' ? (
            <button type="submit" form="lead-form" disabled={submitting} className="flex-1 sm:flex-none w-full sm:w-auto justify-center px-2 sm:px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5 sm:gap-2">
              <Save className="h-4 w-4 shrink-0" />
              {submitting ? 'Saving...' : <><span className="hidden sm:inline">Save Lead</span><span className="inline sm:hidden">Save</span></>}
            </button>
          ) : importResult ? (
            <button onClick={onSuccess} className="w-full sm:w-auto justify-center px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] shadow-sm transition-all flex items-center gap-2">
              <Check className="h-4 w-4" /> Done
            </button>
          ) : (
            <button onClick={handleBulkImport} disabled={importing || importPreview.length === 0} className="flex-1 sm:flex-none w-full sm:w-auto justify-center px-2 sm:px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5 sm:gap-2">
              <Upload className="h-4 w-4 shrink-0" />
              {importing ? 'Importing...' : <><span className="hidden sm:inline">Import Leads</span><span className="inline sm:hidden">Import</span></>}
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
}

function Field({ label, value, onChange, type = 'text', required = false, placeholder, icon, error }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string; icon?: React.ReactNode; error?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#374151] mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {icon}
          </div>
        )}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full rounded-xl border bg-white ${icon ? 'pl-9' : 'px-4'} pr-4 py-2.5 text-sm text-[#374151] outline-none focus:ring-1 transition-all ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : 'border-border focus:border-primary focus:ring-primary'}`}
        />
      </div>
      {error && <p id={`${id}-error`} aria-live="polite" className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function PriorityDot({ level }: { level: string }) {
  if (level === 'HIGH') return <div className="w-2.5 h-2.5 rounded-full bg-red-500" />;
  if (level === 'MEDIUM') return <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />;
  return <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />;
}
