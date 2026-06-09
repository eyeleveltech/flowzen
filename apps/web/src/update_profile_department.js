const fs = require('fs');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\app\\(dashboard)\\profile\\page.tsx';
let content = fs.readFileSync(file, 'utf-8');

// 1. Add imports
const importTarget = `import toast from 'react-hot-toast';`;
const newImports = `import toast from 'react-hot-toast';
import { Select } from '@/components/ui/select';
import { useTeams } from '@/hooks/useQueries';`;
content = content.replace(importTarget, newImports);

// 2. Add useTeams hook
const hookTarget = `  const { user, setAuth } = useAuthStore();`;
const newHook = `  const { user, setAuth } = useAuthStore();
  const { data: teams = [] } = useTeams();`;
content = content.replace(hookTarget, newHook);

// 3. Replace department input with Select
const inputTarget = `<label className="text-sm font-medium text-[#374151]">Department (Optional)</label>
                  <input
                    type="text"
                    value={profileForm.department}
                    onChange={(e) => setProfileForm({ ...profileForm, department: e.target.value })}
                    placeholder="e.g. Engineering, Marketing"
                    className="w-full rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
                  />`;
const newSelect = `<label className="text-sm font-medium text-[#374151]">Department (Optional)</label>
                  <Select
                    value={profileForm.department}
                    onChange={(value) => setProfileForm({ ...profileForm, department: value })}
                    options={[
                      { label: 'Select a department...', value: '' },
                      ...teams.map((t: any) => ({ label: t.name, value: t.name }))
                    ]}
                  />`;
content = content.replace(inputTarget, newSelect);

fs.writeFileSync(file, content, 'utf-8');
console.log('Successfully updated profile page department input');
