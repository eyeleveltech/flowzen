'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Save, Upload, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { useMembers } from '@/hooks/useQueries';
import Papa from 'papaparse';

export function LeadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void; }) {
  const isEditing = false;
  const { data: members = [] } = useMembers();
  
  const [form, setForm] = useState({
    contactName: '',
    companyName: '',
    email: '',
    phone: '',
    source: 'MANUAL',
    assignedToId: '',
    dealValue: '',
    expectedCloseDate: '',
    stage: 'LEAD',
    industry: '',
    city: '',
    notes: '',
  });
  
  const [submitting, setSubmitting] = useState(false);

  const [creationMode, setCreationMode] = useState<'MANUAL' | 'BULK'>('MANUAL');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);



  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        dealValue: form.dealValue ? parseFloat(form.dealValue) : undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
      };

      await api.post('/crm/leads', payload);
      toast.success('Lead created successfully');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function processFile(file: File) {
    setImportFile(file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setImportPreview(results.data);
      },
      error: () => {
        toast.error('Failed to parse CSV file');
      }
    });
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

      if (payload.length > 50) {
        toast.error(`You are trying to import ${payload.length} leads. The maximum allowed is 50 at a time.`);
        setImporting(false);
        return;
      }

      await api.post('/crm/leads/bulk', { leads: payload });
      toast.success(`Imported ${payload.length} leads`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Failed to import leads');
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const csv = Papa.unparse([{
      ContactName: 'John Doe',
      CompanyName: 'Example LLC',
      Email: 'john@example.com',
      Phone: '+1-555-0100',
      Source: 'EXCEL',
      Stage: 'LEAD',
      DealValue: '50000',
      ExpectedCloseDate: '2026-06-01',
      Industry: 'Real Estate',
      City: 'New York',
      Notes: 'Needs immediate follow up'
    }]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'lead_import_template.csv';
    link.click();
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white border-l border-border shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-primary">Add New Lead</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>

        <div className="flex gap-4 px-6 border-b border-border">
            <button
              onClick={() => setCreationMode('MANUAL')}
              className={`pb-2 mt-4 text-sm font-medium border-b-2 transition-colors ${creationMode === 'MANUAL' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-[#374151]'}`}
            >
              Manual Entry
            </button>
            <button
              onClick={() => setCreationMode('BULK')}
              className={`pb-2 mt-4 text-sm font-medium border-b-2 transition-colors ${creationMode === 'BULK' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-[#374151]'}`}
            >
              Bulk Import
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {creationMode === 'MANUAL' ? (
          <form id="lead-form" onSubmit={handleSubmit} className="space-y-4">
                <Field label="Contact Name *" value={form.contactName} onChange={(v) => setForm({ ...form, contactName: v })} required />
                <Field label="Company Name *" value={form.companyName} onChange={(v) => setForm({ ...form, companyName: v })} required />
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Industry / Vertical</label>
                  <Select
                    value={form.industry}
                    onChange={(v) => setForm({ ...form, industry: v })}
                    options={[
                      { label: 'Select Industry', value: '' },
                      { label: 'Real Estate', value: 'Real Estate' },
                      { label: 'IT/SaaS', value: 'IT/SaaS' },
                      { label: 'Healthcare', value: 'Healthcare' },
                      { label: 'Automotive', value: 'Automotive' },
                      { label: 'Manufacturing/B2B', value: 'Manufacturing/B2B' },
                      { label: 'Other', value: 'Other' },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                  <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                </div>

                <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Lead Source</label>
                  <Select
                    value={form.source}
                    onChange={(v) => setForm({ ...form, source: v })}
                    options={[
                      { label: 'Manual', value: 'MANUAL' },
                      { label: 'Inbound', value: 'INBOUND' },
                      { label: 'Referral', value: 'REFERRAL' },
                      { label: 'LinkedIn', value: 'LINKEDIN' },
                      { label: 'Instagram', value: 'INSTAGRAM' },
                      { label: 'WhatsApp', value: 'WHATSAPP' },
                      { label: 'Other', value: 'OTHER' }
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Notes / Lead Description</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all min-h-25"
                    placeholder="Enter any initial notes about this lead..."
                  />
                </div>



          </form>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-[#F9FAFB]">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Need a template?</h3>
                  <p className="text-xs text-secondary mt-1">Download our CSV template to see the required format.</p>
                </div>
                <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-gray-50 transition-all">
                  <FileText className="h-3.5 w-3.5" /> Template
                </button>
              </div>

              <div>
                <label 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed transition-colors rounded-xl cursor-pointer ${isDragging ? 'border-primary bg-gray-50' : 'border-[#D1D5DB] hover:border-primary hover:bg-gray-50'}`}
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-3 text-[#9CA3AF]" />
                    <p className="mb-2 text-sm text-[#4B5563]">
                      <span className="font-semibold">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-[#9CA3AF]">CSV files only</p>
                  </div>
                  <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                </label>
                {importFile && (
                  <p className="text-xs text-primary mt-2 font-medium flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-[#10B981]" /> {importFile.name}
                  </p>
                )}
              </div>

              {importPreview.length > 0 && (
                <div className="p-4 rounded-xl border border-blue-100 bg-blue-50">
                  <h4 className="text-sm font-semibold text-blue-900 mb-1">Ready to Import</h4>
                  <p className="text-xs text-blue-700">Found {importPreview.filter(r => r.ContactName || r.CompanyName).length} valid leads in the CSV file.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border bg-gray-50 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          {creationMode === 'MANUAL' ? (
            <button type="submit" form="lead-form" disabled={submitting} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
              <Save className="h-4 w-4" />
              {submitting ? 'Saving...' : 'Save Lead'}
            </button>
          ) : (
            <button onClick={handleBulkImport} disabled={importing || importPreview.length === 0} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
              <Upload className="h-4 w-4" />
              {importing ? 'Importing...' : 'Import Leads'}
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
      />
    </div>
  );
}
