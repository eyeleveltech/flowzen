import { Check, Minus } from 'lucide-react';
import { USER_ROLES, ROLE_LABELS } from '@flowzen/shared';
import { Icon } from '@/components/ui/icon';

export function PermissionsTab() {
  const roles = USER_ROLES.map((r) => ROLE_LABELS[r]);

  // Order of roles: SUPER_ADMIN (0), ADMIN (1), PROJECT_MANAGER (2), TEAM_MEMBER (3)
  const permissions = [
    { name: 'Manage organization settings & modules', values: [true, true, false, false] },
    { name: 'Invite & remove organization members', values: [true, true, false, false] },
    { name: 'Manage teams & departments', values: [true, true, false, false] },
    { name: 'Manage clients (create, edit)', values: [true, true, true, false] },
    { name: 'Manage projects (create, edit, delete)', values: [true, true, true, false] },
    { name: 'Approve deliverables & bulk tasks', values: [true, true, true, false] },
    { name: 'Manage workflow templates', values: [true, true, true, false] },
    { name: 'View analytics & reports', values: [true, true, true, false] },
    { name: 'View system audit logs', values: [true, false, false, false] },
    { name: 'Manage API keys', values: [true, false, false, false] },
    { name: 'Transfer Super Admin ownership', values: [true, false, false, false] },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-primary">Role Permissions</h2>
        <p className="text-sm text-secondary">Review what each canonical role can access and do within the platform.</p>
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface border-b border-border">
            <tr>
              <th className="px-6 py-4 font-semibold text-secondary uppercase tracking-wide text-xs">Permission</th>
              {roles.map(r => (
                <th key={r} className="px-6 py-4 font-semibold text-secondary uppercase tracking-wide text-xs text-center">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {permissions.map((p, i) => (
              <tr key={i} className="hover:bg-surface transition-colors">
                <td className="px-6 py-4 font-medium text-primary">{p.name}</td>
                {p.values.map((v, j) => (
                  <td key={j} className="px-6 py-4 text-center">
                    {v ? (
                      <Icon as={Check} size="md" className="text-emerald-600 mx-auto" strokeWidth={3} />
                    ) : (
                      <Icon as={Minus} size="md" className="text-secondary/40 mx-auto" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
