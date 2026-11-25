const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');

async function verifyPackage(appOutDir) {
  const source = path.resolve(__dirname, '../desktop-dist/backend');
  const resources = path.join(appOutDir, 'resources');
  const target = path.join(resources, 'backend');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  let files = 0; let bytes = 0;
  async function walk(folder, relative = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), name);
      else if (entry.isFile()) {
        if (/^\.env($|\.)/i.test(entry.name) || /\.db($|-wal$|-shm$)/i.test(entry.name) || entry.name === 'desktop-secrets.bin') throw new Error('Unexpected data file in backend stage.');
        const original = await fs.readFile(path.join(source, name));
        const packaged = await fs.readFile(path.join(target, name));
        if (hash(original) !== hash(packaged)) throw new Error(`Packaged backend mismatch: ${name}`);
        files++; bytes += packaged.length;
      }
    }
  }
  await walk(source);
  const archive = path.join(resources, 'app.asar');
  if (asar.listPackage(archive).some(name => name.includes('node_modules'))) throw new Error('Unexpected dependencies inside shell ASAR.');
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  const expected = JSON.parse(await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8'));
  if (manifest.version !== expected.version) throw new Error('Packaged shell version mismatch.');
  console.log('DESKTOP_PACKAGE_VERIFIED', JSON.stringify({ backendFiles: files, backendMiB: Math.round(bytes / 104857.6) / 10, version: manifest.version }));
}

module.exports = { verifyPackage };
if (require.main === module) verifyPackage(path.resolve(process.argv[2] || 'release/win-unpacked')).catch(error => { console.error(error.message); process.exitCode = 1; });
