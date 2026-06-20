'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Save, Upload, FileText, User, Briefcase, Mail, Phone, Building2, Calendar, IndianRupee, Search, ChevronDown, Check, AlignLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { useMembers, useClients } from '@/hooks/useQueries';
import Papa from 'papaparse';

export function LeadModal({ onClose, onSuccess, initialMode = 'MANUAL' }: { onClose: () => void; onSuccess: () => void; initialMode?: 'MANUAL' | 'BULK' }) {
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
    assignedToId: '',
    dealValue: '',
    expectedRevenue: '',
    expectedCloseDate: '',
    followUpDate: '',
    stage: 'LEAD',
    industry: '',
    city: '',
    notes: '',
    priority: 'MEDIUM',
  });
  
  const [submitting, setSubmitting] = useState(false);
  const [creationMode, setCreationMode] = useState<'MANUAL' | 'BULK'>(initialMode);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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
    setClientSearch(client.name + (client.company ? ` (${client.company})` : ''));
    setShowClientDropdown(false);
  };

  const handleClientSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setClientSearch(e.target.value);
    setForm(prev => ({ ...prev, clientId: '', contactName: e.target.value }));
    setShowClientDropdown(true);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!form.clientId && !form.contactName && !form.companyName) {
      toast.error('Please provide either a Client, Contact Name, or Company Name');
      return;
    }

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
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => setImportPreview(res.data), error: () => toast.error('Failed to parse CSV file') });
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }
  async function handleBulkImport() {
    if (!importPreview.length) return;
    setImporting(true);
    try {
      const payload = importPreview.map((row: any) => ({
        contactName: row.ContactName || row.contactName,
        companyName: row.CompanyName || row.companyName,
        email: row.Email || row.email,
        phone: row.Phone || row.phone,
        source: row.Source || row.source || 'EXCEL',
        stage: row.Stage || row.stage || 'LEAD',
        dealValue: row.DealValue || row.dealValue,
        expectedCloseDate: row.ExpectedCloseDate || row.expectedCloseDate,
        industry: row.Industry || row.industry,
        city: row.City || row.city,
        notes: row.Notes || row.notes,
      })).filter(l => l.contactName || l.companyName);

      if (payload.length > 50) { toast.error(`Max 50 leads at a time.`); setImporting(false); return; }
      await api.post('/crm/leads/bulk', { leads: payload });
      toast.success(`Imported ${payload.length} leads`);
      onSuccess();
    } catch (err: any) { toast.error(err.message || 'Failed to import leads'); } finally { setImporting(false); }
  }

  function downloadTemplate() {
    const csv = Papa.unparse([{ ContactName: 'John Doe', CompanyName: 'Example LLC', Email: 'john@example.com', Phone: '+1-555-0100', Source: 'EXCEL', Stage: 'LEAD', DealValue: '50000', ExpectedCloseDate: '2026-06-01', Industry: 'Real Estate', City: 'New York', Notes: 'Needs immediate follow up' }]);
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
                        placeholder="Search existing clients or type new..."
                        className={`w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all ${form.clientId ? 'bg-blue-50 border-blue-200 text-blue-900' : ''}`}
                      />
                      {form.clientId && (
                        <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-600" />
                      )}
                    </div>
                    
                    {showClientDropdown && clientSearch.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto p-1">
                        {filteredClients.length > 0 ? (
                          filteredClients.map((client: any) => (
                            <button
                              key={client.id}
                              type="button"
                              onClick={() => handleSelectClient(client)}
                              className="w-full text-left px-3 py-2 text-sm text-[#374151] hover:bg-gray-50 rounded-lg flex flex-col transition-colors"
                            >
                              <span className="font-medium">{client.name}</span>
                              {client.company && <span className="text-xs text-secondary">{client.company}</span>}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-secondary flex items-center justify-between">
                            <span>No exact match found.</span>
                            <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded font-medium">Will create new</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {!form.clientId && (
                    <div className="pl-4 border-l-2 border-primary/20 space-y-4 py-1">
                      <Field label="Company Name" value={form.companyName} onChange={(v) => setForm({ ...form, companyName: v })} placeholder="Optional company name" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Stage <span className="text-red-500">*</span></label>
                      <Select
                        value={form.stage}
                        onChange={(v) => setForm({ ...form, stage: v })}
                        options={[
                          { label: 'Lead', value: 'LEAD' },
                          { label: 'Qualified', value: 'QUALIFIED' },
                          { label: 'Proposal Sent', value: 'PROPOSAL_SENT' },
                          { label: 'Negotiation', value: 'NEGOTIATION' },
                          { label: 'Won', value: 'WON' },
                          { label: 'Lost', value: 'LOST' }
                        ]}
                      />
                    </div>
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

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Lead Source <span className="text-red-500">*</span></label>
                      <Select
                        value={form.source}
                        onChange={(v) => setForm({ ...form, source: v })}
                        options={[
                          { label: 'Referral', value: 'REFERRAL' },
                          { label: 'Inbound', value: 'INBOUND' },
                          { label: 'Outbound', value: 'OUTBOUND' },
                          { label: 'Social Media', value: 'SOCIAL_MEDIA' },
                          { label: 'Event', value: 'EVENT' },
                          { label: 'Cold Call', value: 'COLD_CALL' },
                          { label: 'Existing Client', value: 'EXISTING_CLIENT' },
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

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Deal Value (₹)" type="number" icon={<IndianRupee className="h-4 w-4 text-secondary" />} value={form.dealValue} onChange={(v) => setForm({ ...form, dealValue: v })} placeholder="0.00" />
                    <Field label="Expected Revenue (Monthly, ₹)" type="number" icon={<IndianRupee className="h-4 w-4 text-secondary" />} value={form.expectedRevenue} onChange={(v) => setForm({ ...form, expectedRevenue: v })} placeholder="0.00" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Close Date" type="date" value={form.expectedCloseDate} onChange={(v) => setForm({ ...form, expectedCloseDate: v })} />
                    <Field label="Follow-up Date" type="date" value={form.followUpDate} onChange={(v) => setForm({ ...form, followUpDate: v })} />
                  </div>
                </div>

                {/* SECTION 2: Contact Details */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <User className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-primary">2. Contact Details</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Contact Name" value={form.contactName} onChange={(v) => {
                      setForm({ ...form, contactName: v });
                      if(!form.clientId) setClientSearch(v);
                    }} placeholder="Full Name" />
                    <Field label="Job Title" value={form.jobTitle} onChange={(v) => setForm({ ...form, jobTitle: v })} placeholder="e.g. Marketing Director" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Email Address" type="email" icon={<Mail className="h-4 w-4 text-secondary" />} value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="john@example.com" />
                    <Field label="Phone Number" icon={<Phone className="h-4 w-4 text-secondary" />} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+1 (555) 000-0000" />
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
                  <p className="text-xs text-secondary mt-1">Download our CSV template to see the required format.</p>
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
                    <p className="text-xs text-secondary">CSV files only</p>
                  </div>
                  <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                </label>
                {importFile && (
                  <p className="text-sm text-primary mt-3 font-medium flex items-center gap-2 bg-white border border-border p-3 rounded-lg shadow-sm">
                    <FileText className="h-4 w-4 text-green-500" /> {importFile.name}
                  </p>
                )}
              </div>

              {importPreview.length > 0 && (
                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                  <h4 className="text-sm font-semibold text-blue-900 mb-1">Ready to Import</h4>
                  <p className="text-sm text-blue-700">Found {importPreview.filter(r => r.ContactName || r.CompanyName).length} valid leads in the CSV file.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border bg-white flex justify-end gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] z-10">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-[#374151] bg-white border border-border rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          {creationMode === 'MANUAL' ? (
            <button type="submit" form="lead-form" disabled={submitting} className="px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] shadow-sm transition-all disabled:opacity-50 flex items-center gap-2">
              <Save className="h-4 w-4" />
              {submitting ? 'Saving...' : 'Save Lead'}
            </button>
          ) : (
            <button onClick={handleBulkImport} disabled={importing || importPreview.length === 0} className="px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] shadow-sm transition-all disabled:opacity-50 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {importing ? 'Importing...' : 'Import Leads'}
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
}

function Field({ label, value, onChange, type = 'text', required = false, placeholder, icon }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string; icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          className={`w-full rounded-xl border border-border bg-white ${icon ? 'pl-9' : 'px-4'} pr-4 py-2.5 text-sm text-[#374151] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all`}
        />
      </div>
    </div>
  );
}

function PriorityDot({ level }: { level: string }) {
  if (level === 'HIGH') return <div className="w-2.5 h-2.5 rounded-full bg-red-500" />;
  if (level === 'MEDIUM') return <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />;
  return <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />;
}
