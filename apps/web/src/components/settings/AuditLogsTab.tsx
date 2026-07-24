import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Shield, Search, FileText } from 'lucide-react';
import { Select } from '@/components/ui/select';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: any;
  createdAt: string;
  user: {
    name: string;
    email: string;
    avatar: string | null;
  };
}

export function AuditLogsTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  const fetchLogs = () => {
    setLoading(true);
    api.get<AuditLog[]>('/settings/audit-logs')
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'UPDATE_ROLE': return 'Role Changed';
      case 'TRANSFER_SUPER_ADMIN': return 'Super Admin Transferred';
      case 'CLIENT_CREATE': return 'Client Created';
      case 'CLIENT_UPDATE': return 'Client Updated';
      case 'CLIENT_DELETE': return 'Client Deleted';
      case 'LEAD_CREATE': return 'Lead Created';
      case 'LEAD_UPDATE': return 'Lead Updated';
      case 'LEAD_DELETE': return 'Lead Deleted';
      case 'PROJECT_ARCHIVE': return 'Project Archived';
      case 'PROJECT_DELETE': return 'Project Deleted';
      default: return action;
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('CREATE')) return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
    if (action.includes('DELETE')) return 'bg-rose-50 text-rose-700 ring-rose-600/10';
    if (action.includes('UPDATE') || action.includes('ROLE')) return 'bg-amber-50 text-amber-700 ring-amber-600/20';
    if (action.includes('ARCHIVE')) return 'bg-gray-50 text-gray-700 ring-gray-600/20';
    return 'bg-blue-50 text-blue-700 ring-blue-600/20';
  };

  const renderDetails = (log: AuditLog) => {
    const details = log.details;
    if (!details) return <span className="text-secondary">—</span>;

    if (log.action === 'UPDATE_ROLE') {
      return (
        <p className="text-sm text-primary">
          Changed <span className="font-semibold">{details.userName}</span> ({details.userEmail}) from{' '}
          <span className="font-semibold text-secondary">{details.previousRole}</span> to{' '}
          <span className="font-semibold text-amber-600">{details.newRole}</span>.
        </p>
      );
    }

    if (log.action === 'TRANSFER_SUPER_ADMIN') {
      return (
        <p className="text-sm text-primary">
          Transferred Super Admin role to{' '}
          <span className="font-semibold text-amber-600">{details.transferredToName}</span> ({details.transferredToEmail}).
        </p>
      );
    }

    if (log.action.startsWith('CLIENT_') || log.action.startsWith('LEAD_')) {
      const type = log.action.startsWith('CLIENT_') ? 'Client' : 'Lead';
      const entityName = details.companyName 
        ? `${details.contactName || ''} (${details.companyName})` 
        : (details.contactName || details.name || 'Unknown');
      
      const changeList = details.changes && Array.isArray(details.changes) && details.changes.length > 0
        ? `: ${details.changes.join(', ')}`
        : '';

      return (
        <p className="text-sm text-primary">
          {type}: <span className="font-semibold">{entityName}</span>{changeList}.
        </p>
      );
    }

    if (log.action === 'PROJECT_ARCHIVE') {
      return (
        <p className="text-sm text-primary">
          Project <span className="font-semibold">{details.name}</span> archived as{' '}
          <span className="font-semibold text-rose-600">{details.status}</span>.
        </p>
      );
    }

    if (log.action === 'PROJECT_DELETE') {
      return (
        <p className="text-sm text-primary">
          Project <span className="font-semibold">{details.name}</span> was permanently deleted.
        </p>
      );
    }

    return <pre className="text-xs text-secondary font-mono max-w-md overflow-x-auto">{JSON.stringify(details, null, 2)}</pre>;
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'ALL') return true;
    if (filter === 'ROLES') return log.action.includes('ROLE') || log.action.includes('SUPER_ADMIN');
    if (filter === 'CLIENTS') return log.entityType === 'CLIENT';
    if (filter === 'LEADS') return log.entityType === 'LEAD';
    if (filter === 'PROJECTS') return log.entityType === 'PROJECT';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" /> System Audit Logs
          </h2>
          <p className="text-sm text-secondary mt-0.5">Track administrative and state modifications across the workspace.</p>
        </div>

        <div className="w-full sm:w-48 shrink-0">
          <Select
            value={filter}
            onChange={setFilter}
            options={[
              { label: 'All Log Types', value: 'ALL' },
              { label: 'Role Changes', value: 'ROLES' },
              { label: 'Clients', value: 'CLIENTS' },
              { label: 'Leads', value: 'LEADS' },
              { label: 'Projects', value: 'PROJECTS' },
            ]}
            className="w-full py-1.5! text-xs! rounded-lg!"
          />
        </div>
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden overflow-x-auto">
        {loading ? (
          <div className="text-center py-12 text-sm text-secondary">Loading audit logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-sm text-secondary flex flex-col items-center gap-2">
            <FileText className="h-8 w-8 text-muted stroke-[1.5]" />
            No audit logs found matching the filter.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface border-b border-border">
              <tr>
                <th className="px-6 py-4 font-semibold text-secondary uppercase tracking-wide text-xs">Timestamp</th>
                <th className="px-6 py-4 font-semibold text-secondary uppercase tracking-wide text-xs">User</th>
                <th className="px-6 py-4 font-semibold text-secondary uppercase tracking-wide text-xs">Action</th>
                <th className="px-6 py-4 font-semibold text-secondary uppercase tracking-wide text-xs">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-surface/50 transition-colors">
                  <td className="px-6 py-4 text-xs text-secondary whitespace-nowrap">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-semibold text-primary">{log.user?.name || 'Unknown'}</p>
                      <p className="text-xs text-secondary">{log.user?.email || ''}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${getActionColor(log.action)}`}>
                      {getActionLabel(log.action)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {renderDetails(log)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
