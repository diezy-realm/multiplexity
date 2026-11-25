const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function stageFrontend() {
  const source = path.join(root, 'dist/client');
  const destination = path.join(root, 'rust/target/release/frontend');
  await fs.access(path.join(source, 'index.html'));
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
}
module.exports = { stageFrontend };
if (require.main === module) stageFrontend().catch(error => { console.error(error.message); process.exitCode = 1; });
