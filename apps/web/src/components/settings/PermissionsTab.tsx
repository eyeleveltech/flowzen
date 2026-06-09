import { Check, Minus } from 'lucide-react';

export function PermissionsTab() {
  const roles = ['Super Admin', 'Admin', 'Manager', 'Executive'];
  
  const permissions = [
    { name: 'Full access', values: [true, false, false, false] },
    { name: 'Manage organization settings', values: [true, true, false, false] },
    { name: 'Invite / remove members', values: [true, true, false, false] },
    { name: 'Manage projects', values: [true, true, true, false] },
    { name: 'Create / edit tasks', values: [true, true, true, true] },
    { name: 'View all projects', values: [true, true, true, false] },
    { name: 'View own tasks only', values: [true, true, true, true] },
    { name: 'Approve deliverables', values: [true, true, true, false] },
    { name: 'View reports', values: [true, true, true, false] },
    { name: 'Manage permissions', values: [true, false, false, false] },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[#111827]">Role Permissions</h2>
        <p className="text-sm text-[#6B7280]">Review what each role can access and do within the platform.</p>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#FAFAFA] border-b border-[#E5E7EB]">
            <tr>
              <th className="px-6 py-4 font-semibold text-[#6B7280] uppercase tracking-wide text-xs">Permission</th>
              {roles.map(r => (
                <th key={r} className="px-6 py-4 font-semibold text-[#6B7280] uppercase tracking-wide text-xs text-center">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {permissions.map((p, i) => (
              <tr key={i} className="hover:bg-[#FAFAFA] transition-colors">
                <td className="px-6 py-4 font-medium text-[#111827]">{p.name}</td>
                {p.values.map((v, j) => (
                  <td key={j} className="px-6 py-4 text-center">
                    {v ? (
                      <Check className="h-4 w-4 text-green-600 mx-auto" strokeWidth={3} />
                    ) : (
                      <Minus className="h-4 w-4 text-[#D1D5DB] mx-auto" />
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
