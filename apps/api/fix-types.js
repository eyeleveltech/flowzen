const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');
const files = fs.readdirSync(routesDir).map(f => path.join(routesDir, f));

for (const file of files) {
  if (!file.endsWith('.ts')) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Fix req.params.id -> (req.params.id as string)
  content = content.replace(/req\.params\.id(?! as string)/g, '(req.params.id as string)');

  // Fix req.params.taskId -> (req.params.taskId as string)
  content = content.replace(/req\.params\.taskId(?! as string)/g, '(req.params.taskId as string)');
  
  // Fix search as string, status as string, etc which are already there but might need fixing where we didn't add it.
  // We can just add as string to req.query properties if they are assigned.
  // Actually, the error says: Type 'string | string[]' is not assignable to type 'string'
  // Where is status assigned?
  // `where.status = status;` -> `where.status = status as string;`
  content = content.replace(/where\.status = status;/g, 'where.status = status as string;');
  content = content.replace(/where\.priority = priority;/g, 'where.priority = priority as string;');

  // Save back
  fs.writeFileSync(file, content);
}

// Fix team.ts error: Property 'assignedTasks' does not exist on type...
const teamFile = path.join(routesDir, 'team.ts');
let teamContent = fs.readFileSync(teamFile, 'utf8');
teamContent = teamContent.replace(/u\.assignedTasks/g, '(u as any).assignedTasks');
teamContent = teamContent.replace(/u\.ownedProjects/g, '(u as any).ownedProjects');
teamContent = teamContent.replace(/t =>/g, '(t: any) =>');
teamContent = teamContent.replace(/where: \{ id: req.params.id \},/g, 'where: { id: req.params.id as string },');
fs.writeFileSync(teamFile, teamContent);

// Fix jwt.ts error
const jwtFile = path.join(__dirname, 'src', 'utils', 'jwt.ts');
let jwtContent = fs.readFileSync(jwtFile, 'utf8');
jwtContent = jwtContent.replace(/\{ expiresIn: JWT_EXPIRES_IN \}/g, '{ expiresIn: JWT_EXPIRES_IN as any }');
fs.writeFileSync(jwtFile, jwtContent);

console.log('Fixed typescript errors');
