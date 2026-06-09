const fs = require('fs');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\app\\(dashboard)\\projects\\page.tsx';
let content = fs.readFileSync(file, 'utf-8');

// 1. Add Filter state variables
const stateBlockToReplace = `  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');`;

const newStates = `  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');`;

content = content.replace(stateBlockToReplace, newStates);

// 2. Update useProjects hook usage
const oldHook = `    isFetchingNextPage
  } = useProjects(search, view === 'calendar');`;

const newHook = `    isFetchingNextPage
  } = useProjects(search, view === 'calendar', statusFilter, clientFilter, ownerFilter);`;

content = content.replace(oldHook, newHook);

// 3. Update Toolbar to add dropdowns
const toolbarToReplace = `      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..." className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
        </div>
        <div className="flex items-center rounded-xl border border-[#E5E7EB] p-1">`;

const newToolbar = `      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 mb-6">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..." className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2 text-sm outline-none focus:border-[#111827] transition-all" />
          </div>
          
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-32">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { label: 'All Statuses', value: '' },
                  { label: 'Planning', value: 'PLANNING' },
                  { label: 'In Progress', value: 'IN_PROGRESS' },
                  { label: 'In Review', value: 'REVIEW' },
                  { label: 'Completed', value: 'COMPLETED' },
                  { label: 'On Hold', value: 'ON_HOLD' },
                  { label: 'Cancelled', value: 'CANCELLED' }
                ]}
              />
            </div>
            <div className="w-40">
              <Select
                value={clientFilter}
                onChange={setClientFilter}
                options={[
                  { label: 'All Clients', value: '' },
                  ...clients.map(c => ({ label: c.name, value: c.id }))
                ]}
              />
            </div>
            {user?.role !== 'TEAM_MEMBER' && (
              <div className="w-40">
                <Select
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  options={[
                    { label: 'All Owners', value: '' },
                    ...members.map(m => ({ label: m.name, value: m.id }))
                  ]}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center shrink-0 rounded-xl border border-[#E5E7EB] p-1 bg-white">`;

content = content.replace(toolbarToReplace, newToolbar);

fs.writeFileSync(file, content, 'utf-8');
console.log('Successfully added filters to projects page');
