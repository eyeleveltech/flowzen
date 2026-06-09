const fs = require('fs');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\app\\(dashboard)\\projects\\page.tsx';
let content = fs.readFileSync(file, 'utf-8');

// Replace client options
const oldClientOptions = `                  { label: 'All Clients', value: '' },
                  ...clients.map(c => ({ label: c.name, value: c.id }))`;

const newClientOptions = `                  { label: 'All Clients', value: '' },
                  ...clients.filter(c => c._count?.projects > 0).map(c => ({ label: c.name, value: c.id }))`;

content = content.replace(oldClientOptions, newClientOptions);

// Replace owner options
const oldOwnerOptions = `                    { label: 'All Owners', value: '' },
                    ...members.map(m => ({ label: m.name, value: m.id }))`;

const newOwnerOptions = `                    { label: 'All Owners', value: '' },
                    ...members.filter(m => m.totalProjects > 0).map(m => ({ label: m.name, value: m.id }))`;

content = content.replace(oldOwnerOptions, newOwnerOptions);

fs.writeFileSync(file, content, 'utf-8');
console.log('Successfully updated project filter options to only show those with projects.');
