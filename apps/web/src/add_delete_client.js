const fs = require('fs');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\app\\(dashboard)\\clients\\[id]\\page.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Add Trash2 to lucide-react imports
content = content.replace(
  `import { ArrowLeft, Mail, Phone, MapPin, Building2, DollarSign, X, Plus, Users, Globe, Briefcase } from 'lucide-react';`,
  `import { ArrowLeft, Mail, Phone, MapPin, Building2, DollarSign, X, Plus, Users, Globe, Briefcase, Trash2 } from 'lucide-react';`
);

// Insert handleDelete function before openEdit
const handleDeleteFn = `
  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this client? All associated projects will also be removed. This action cannot be undone.')) return;
    try {
      await api.delete(\`/clients/\${id}\`);
      toast.success('Client deleted successfully');
      router.push('/clients');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete client');
    }
  }

  function openEdit() {`;

content = content.replace('  function openEdit() {', handleDeleteFn);

// Insert Delete button next to Edit Client button
const editBtnBlock = `        {!client.name.includes('(Internal)') && (
          <button onClick={openEdit} className="px-4 py-2 bg-white border border-[#E5E7EB] rounded-xl text-sm font-medium text-[#374151] hover:bg-gray-50 transition-colors shadow-sm">
            Edit Client
          </button>
        )}`;

const newButtons = `        {!client.name.includes('(Internal)') && (
          <div className="flex items-center gap-2">
            <button onClick={openEdit} className="px-4 py-2 bg-white border border-[#E5E7EB] rounded-xl text-sm font-medium text-[#374151] hover:bg-gray-50 transition-colors shadow-sm">
              Edit Client
            </button>
            <button onClick={handleDelete} className="px-4 py-2 bg-white border border-red-200 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors shadow-sm flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        )}`;

content = content.replace(editBtnBlock, newButtons);

fs.writeFileSync(file, content, 'utf-8');
console.log('Successfully added delete client option.');
