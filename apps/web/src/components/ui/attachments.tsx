'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Upload, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { formatDate } from '@/lib/utils';

/**
 * Files attached to a record — task, lead, client, project or expense.
 *
 * One component for all five, because the API is one endpoint keyed on which owner id is passed.
 * Splitting it per entity would mean five copies of the same upload/delete/error handling, which
 * is how the URL-string fields (driveLink, folderLink, assetLinks, receiptUrl) ended up
 * inconsistent with each other in the first place.
 */

type OwnerKey = 'taskId' | 'leadId' | 'clientId' | 'projectId' | 'expenseId';

const MAX_MB = 25;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Attachments({ owner, ownerId, title = 'Attachments', compact = false }: {
  owner: OwnerKey;
  ownerId: string;
  title?: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<any[]>(`/attachments?${owner}=${ownerId}`));
    } catch {
      /* nothing attached yet is the normal case, not an error worth shouting about */
    } finally {
      setLoading(false);
    }
  }, [owner, ownerId]);

  useEffect(() => { load(); }, [load]);

  const send = async (file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`${file.name} is larger than the ${MAX_MB} MB limit`);
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append(owner, ownerId);
      // Sent as FormData, so the browser sets the multipart boundary itself — setting
      // Content-Type by hand here would omit it and the server would reject the body.
      await api.post('/attachments', body);
      await load();
      toast.success('File attached');
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (a: any) => {
    if (!window.confirm(`Remove ${a.filename}?`)) return;
    try {
      await api.delete(`/attachments/${a.id}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove the file');
    }
  };

  // The download route is session-authenticated, so a plain navigation carries the httpOnly
  // cookie — same approach the quote PDFs already use.
  const download = (a: any) => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    window.open(`${base}/attachments/${a.id}/download`, '_blank');
  };

  return (
    <div className={compact ? '' : 'mt-8 border-t border-[#F3F4F6] pt-6'}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-secondary" /> {title}
          {items.length > 0 && <span className="text-secondary font-normal">({items.length})</span>}
        </h3>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-black transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) send(f); }}
        className={`rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-transparent'}`}
      >
        {loading ? (
          <p className="text-sm text-secondary italic py-2">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-secondary italic py-3">
            No files yet. Upload one, or drag it here — up to {MAX_MB} MB.
          </p>
        ) : (
          <div className="space-y-1.5">
            {items.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-[#F9FAFB]">
                <Paperclip className="h-3.5 w-3.5 text-secondary shrink-0" />
                <button
                  onClick={() => download(a)}
                  className="text-sm font-medium text-primary hover:underline truncate text-left"
                  title={a.filename}
                >
                  {a.filename}
                </button>
                <span className="text-xs text-secondary shrink-0 tabular-nums">{humanSize(a.size)}</span>
                <span className="text-xs text-secondary shrink-0 hidden sm:inline">{formatDate(a.createdAt)}</span>
                {a.uploadedBy?.name && (
                  <span className="text-xs text-secondary shrink-0 hidden md:inline truncate">{a.uploadedBy.name}</span>
                )}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <button onClick={() => download(a)} className="p-1 text-secondary hover:text-primary rounded" aria-label={`Download ${a.filename}`}>
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(a)} className="p-1 text-secondary hover:text-red-500 rounded" aria-label={`Remove ${a.filename}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
