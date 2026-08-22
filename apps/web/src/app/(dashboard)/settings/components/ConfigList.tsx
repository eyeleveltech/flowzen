import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';

type ConfigListProps = {
  label: string;
  items: any[];
  endpoint: string;
  onChanged: () => void;
  canEdit: boolean;
  canReorder?: boolean;
  renderExtra?: (item: any) => React.ReactNode;
};

export function ConfigList({ label, items, endpoint, onChanged, canEdit, canReorder, renderExtra }: ConfigListProps) {
  const [adding, setAdding] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (!newItemName.trim() || busy) return;
    setBusy(true);
    try {
      await api.config.post(endpoint, { name: newItemName });
      setNewItemName('');
      setAdding(false);
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (id: string) => {
    if (!editName.trim() || busy) return;
    setBusy(true);
    try {
      await api.config.patch(`${endpoint}/${id}`, { name: editName });
      setEditingId(null);
      setEditName('');
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (busy || !confirm('Are you sure you want to archive this item?')) return;
    setBusy(true);
    try {
      await api.config.delete(`${endpoint}/${id}`);
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReorder = async (direction: 'up' | 'down', currentIndex: number) => {
    if (busy) return;
    
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    // We build the new ordered IDs
    const newOrder = [...items];
    const temp = newOrder[currentIndex];
    newOrder[currentIndex] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    const orderedIds = newOrder.map(i => i.id);

    setBusy(true);
    try {
      if (endpoint === 'stages') {
        await api.config.patch(`${endpoint}/reorder`, { orderedIds });
      }
      onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inputClasses = "w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm shadow-sm placeholder:text-secondary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-muted px-4 py-3 flex items-center justify-between border-b border-border">
        <h3 className="text-sm font-medium text-primary">
          {label} <span className="text-secondary font-normal">({items.length})</span>
        </h3>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={busy || adding}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        )}
      </div>

      <div className="divide-y divide-border bg-card">
        {adding && (
          <div className="p-3 flex items-center gap-2 bg-muted/30">
            <input 
              className={inputClasses}
              value={newItemName} 
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewItemName(e.target.value)} 
              placeholder="Name..." 
              autoFocus 
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleAdd()}
            />
            <Button size="sm" variant="primary" onClick={handleAdd} disabled={busy || !newItemName.trim()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
          </div>
        )}

        {items.length === 0 && !adding && (
          <div className="p-4 text-sm text-secondary text-center">No items.</div>
        )}

        {items.map((item, index) => (
          <div key={item.id} className="p-3 flex items-center justify-between group">
            {editingId === item.id ? (
              <div className="flex-1 flex items-center gap-2 mr-2">
                <input 
                  className={inputClasses}
                  value={editName} 
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)} 
                  autoFocus 
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleEdit(item.id)}
                />
                <Button size="sm" variant="primary" onClick={() => handleEdit(item.id)} disabled={busy || !editName.trim()}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={busy}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary font-medium">{item.name}</p>
                {renderExtra && renderExtra(item)}
              </div>
            )}

            {!editingId && canEdit && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {canReorder && (
                  <>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleReorder('up', index)} disabled={index === 0 || busy}>
                      <ArrowUp className="w-4 h-4 text-secondary" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleReorder('down', index)} disabled={index === items.length - 1 || busy}>
                      <ArrowDown className="w-4 h-4 text-secondary" />
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditingId(item.id); setEditName(item.name); }} disabled={busy}>
                  <Edit2 className="w-4 h-4 text-secondary" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleDelete(item.id)} disabled={busy}>
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
