const fs = require('node:fs/promises');
const path = require('node:path');
const { nodeFileTrace } = require('@vercel/nft');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'desktop-dist');
const excluded = name => name.split('/').some(part => /^\.env/i.test(part) || part === 'config.json') || /\.(db|db-wal|db-shm)$/i.test(name);

async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['cache', 'standalone'].includes(entry.name) || entry.name === 'trace') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

async function resetStage(name) {
  const location = path.resolve(output, name);
  if (path.dirname(location) !== output || !['backend', 'shell'].includes(name)) throw new Error('Invalid desktop staging path.');
  await fs.rm(location, { recursive: true, force: true });
  await fs.mkdir(location, { recursive: true });
  return location;
}

async function main() {
  const backend = await resetStage('backend');
  const shell = await resetStage('shell');
  const files = new Set(['package.json', 'src/lib/db/schema.sql', 'desktop-dist/server.cjs']);
  try { for(const file of await walk(path.join(root,'public')))files.add(path.relative(root,file).replaceAll('\\','/')); }
  catch(error){if(error.code!=='ENOENT')throw error;}
  for (const file of await walk(path.join(root, 'dist', 'client'))) files.add(path.relative(root,file).replaceAll('\\','/'));
  // Trace the shared Node backend and native drivers independently of the renderer.
  const drivers = ['mysql2', 'mysql2/promise', 'pg', 'ssh2', 'bcrypt', 'better-sqlite3'].map(name => path.relative(root, require.resolve(name)));
  const trace = await nodeFileTrace(['desktop-dist/server.cjs', ...drivers], {
    base: root, processCwd: root,
    ignore: ['node_modules/vite/**', 'node_modules/@vitejs/**', 'node_modules/rolldown/**', 'data/**', '.env*', '**/config.json'],
  });
  for (const file of trace.fileList) files.add(file.replaceAll('\\', '/'));
  // node-gyp-build chooses this prebuild dynamically, outside static import tracing.
  for (const file of await walk(path.join(root, 'node_modules', 'bcrypt', 'prebuilds', `${process.platform}-${process.arch}`))) files.add(path.relative(root, file).replaceAll('\\', '/'));
  for (const file of await walk(path.join(output, 'runtime'))) files.add(path.relative(root, file).replaceAll('\\', '/'));
  for (const file of [...files]) {
    if (!file.startsWith('node_modules/') || !file.endsWith('/package.json')) continue;
    const folder = path.dirname(file);
    for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
      if (entry.isFile() && /^(licen[sc]e|notice|copying)([.-]|$)/i.test(entry.name)) files.add(path.join(folder, entry.name).replaceAll('\\', '/'));
    }
  }
  let count = 0; let bytes = 0;
  for (const file of [...files].sort()) {
    const source = path.resolve(root, file);
    if (!source.startsWith(root + path.sep) || excluded(file)) continue;
    const stat = await fs.stat(source);
    if (!stat.isFile()) continue;
    const target = path.resolve(backend, file);
    if (!target.startsWith(backend + path.sep)) throw new Error('Dependency outside backend staging path.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    count++; bytes += stat.size;
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  await fs.mkdir(path.join(shell, 'desktop'), { recursive: true });
  for (const file of await walk(path.join(root, 'desktop'))) {
    if (file.endsWith('.cjs')) await fs.copyFile(file, path.join(shell, 'desktop', path.basename(file)));
    else if (file.endsWith('.txt')) { const target = path.join(shell,'desktop',path.relative(path.join(root,'desktop'),file)); await fs.mkdir(path.dirname(target),{recursive:true}); await fs.copyFile(file,target); }
  }
  await fs.writeFile(path.join(shell, 'package.json'), JSON.stringify({name:manifest.name, version:manifest.version, private:true, description:manifest.description, main:manifest.main}, null, 2));
  console.log('DESKTOP_STAGE_OK', JSON.stringify({backendFiles:count, backendMiB:Math.round(bytes / 104857.6) / 10, shellAsar:true}));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
