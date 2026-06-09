const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\components\\settings';

const files = fs.readdirSync(dir).filter(f => f.endsWith('Tab.tsx'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Replace font-bold in labels/headers/buttons
  content = content.replace(/text-lg font-bold/g, 'text-lg font-semibold');
  content = content.replace(/text-base font-bold/g, 'text-base font-semibold');
  content = content.replace(/font-bold/g, 'font-medium');

  // Replace tracking-wider with tracking-wide for a softer look
  content = content.replace(/tracking-wider/g, 'tracking-wide');

  // Remove small shadows
  content = content.replace(/shadow-sm/g, '');

  // Flatten out shadows on big modals if any to match other modals
  content = content.replace(/shadow-xl/g, 'shadow-2xl shadow-black/10');

  fs.writeFileSync(filePath, content, 'utf-8');
});

console.log('Settings tabs updated successfully!');
