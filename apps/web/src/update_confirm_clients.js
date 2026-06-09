const fs = require('fs');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\app\\(dashboard)\\clients\\[id]\\page.tsx';
let content = fs.readFileSync(file, 'utf-8');

// 1. Add import for useConfirmStore
if (!content.includes('useConfirmStore')) {
  content = content.replace(
    `import { useMembers } from '@/hooks/useQueries';`,
    `import { useMembers } from '@/hooks/useQueries';\nimport { useConfirmStore } from '@/stores';`
  );
}

// 2. Add confirm = useConfirmStore inside component
if (!content.includes('const confirm = useConfirmStore')) {
  content = content.replace(
    `export default function ClientDetailPage() {\n  const { id } = useParams();`,
    `export default function ClientDetailPage() {\n  const { id } = useParams();\n  const confirm = useConfirmStore((s) => s.confirm);`
  );
}

// 3. Update handleDelete
const oldDelete = `  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this client? All associated projects will also be removed. This action cannot be undone.')) return;
    try {
      await api.delete(\`/clients/\${id}\`);
      toast.success('Client deleted successfully');
      router.push('/clients');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete client');
    }
  }`;

const newDelete = `  async function handleDelete() {
    const isConfirmed = await confirm({
      title: 'Delete Client',
      message: 'Are you sure you want to delete this client? All associated projects will also be removed. This action cannot be undone.',
      confirmText: 'Delete Client',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!isConfirmed) return;
    try {
      await api.delete(\`/clients/\${id}\`);
      toast.success('Client deleted successfully');
      router.push('/clients');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete client');
    }
  }`;

content = content.replace(oldDelete, newDelete);

fs.writeFileSync(file, content, 'utf-8');
console.log('Successfully updated confirm in clients/[id]/page.tsx');
