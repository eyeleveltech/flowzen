'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Key, Trash2, Copy, Check, Clock, AlertCircle } from 'lucide-react';
import { formatRelativeDate } from '@/lib/utils';

export function ApiKeysTab() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    try {
      const res = await api.get<any[]>('/settings/api-keys');
      setKeys(res);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setGenerating(true);
      const res = await api.post<any>('/settings/api-keys', { name });
      setNewKey(res.key);
      setName('');
      fetchKeys();
      toast.success('API Key generated successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate API Key');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? External systems using it will immediately lose access.')) return;
    try {
      await api.delete(`/settings/api-keys/${id}`);
      toast.success('API Key revoked');
      fetchKeys();
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke API key');
    }
  };

  const handleCopy = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    toast.success('API Key copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="text-sm text-secondary">Loading API Keys...</div>;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold text-primary mb-1">Developer API Keys</h3>
        <p className="text-xs text-secondary mb-4">
          Generate API keys to authenticate external systems or custom integrations with the Flowzen API.
          All requests must authenticate using the Authorization Bearer header or the `apiKey` query parameter.
        </p>
      </div>

      {/* Generate API Key Form */}
      <form onSubmit={handleGenerate} className="bg-gray-50 border border-border p-5 rounded-2xl space-y-4 max-w-xl">
        <h4 className="text-xs font-semibold text-primary uppercase tracking-wider">Generate New Key</h4>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="e.g. Make.com Integration, Zapier Connection"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex-1 rounded-xl border border-border bg-white px-3.5 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={generating || !name.trim()}
            className="px-4 py-2 text-xs font-bold text-white bg-primary rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors shrink-0"
          >
            {generating ? 'Generating…' : 'Generate Key'}
          </button>
        </div>
      </form>

      {/* Newly Generated Key Banner */}
      {newKey && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 max-w-xl space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h5 className="text-xs font-bold text-emerald-800">Copy your API Key</h5>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                For security reasons, this key will only be shown once. If you lose it, you will need to revoke it and generate a new one.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white border border-emerald-100 rounded-xl p-2.5">
            <code className="text-xs font-mono select-all break-all flex-1 text-primary">{newKey}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="p-2 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors shrink-0"
              title="Copy to Clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* API Key List */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider">Active Keys ({keys.length})</h4>
        {keys.length === 0 ? (
          <div className="border border-dashed border-border p-8 rounded-2xl bg-white text-center text-sm text-secondary">
            No API keys generated yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 border border-border rounded-2xl bg-white overflow-hidden">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between p-4 hover:bg-surface transition-colors">
                <div className="flex items-start gap-3 min-w-0 pr-4">
                  <div className="h-9 w-9 rounded-xl bg-gray-50 border border-border flex items-center justify-center text-secondary shrink-0">
                    <Key className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{k.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-secondary mt-1 font-medium">
                      <span>Created by {k.user?.name}</span>
                      <span>•</span>
                      <span>Created {formatRelativeDate(k.createdAt)}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {k.lastUsedAt ? `Last used ${formatRelativeDate(k.lastUsedAt)}` : 'Never used'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(k.id)}
                  className="p-2 text-secondary hover:text-red-600 border border-border hover:border-red-100 rounded-xl hover:bg-red-50 transition-colors shrink-0"
                  title="Revoke Key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
