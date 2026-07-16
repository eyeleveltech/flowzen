'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FileText, Plus } from 'lucide-react';
import { ContractFormModal } from './components/ContractFormModal';

export default function ContractsPage() {
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => api.get<any[]>('/revenue/contracts'),
  });
  const contracts = data || [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Contracts</h1>
          <p className="text-sm text-secondary mt-1">Manage active contracts and service agreements</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#1F2937] transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Contract
        </button>
      </div>

      {showModal && (
        <ContractFormModal 
          onClose={() => setShowModal(false)} 
          onSaved={() => {
            setShowModal(false);
            refetch();
          }} 
        />
      )}

      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Company</th>
                <th className="px-6 py-3">Start Date</th>
                <th className="px-6 py-3 text-right">Value</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-sm text-secondary">Loading…</td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-secondary">No contracts found.</td></tr>
              ) : contracts.map((c) => (
                <tr key={c.id} className="hover:bg-surface transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[#9CA3AF] shrink-0" />
                      <span className="text-sm font-medium text-primary">{c.title}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-primary">{c.client.company || c.client.name}</td>
                  <td className="px-6 py-4 text-sm text-secondary">{formatDate(c.startDate)}</td>
                  <td className="px-6 py-4 text-sm font-medium text-primary text-right">{formatCurrency(Number(c.value))}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border bg-gray-100 text-gray-600 border-gray-200">
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
