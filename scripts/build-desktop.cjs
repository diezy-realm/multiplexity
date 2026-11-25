const { build } = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

function download(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download gagal: HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('Download lisensi Node.js timeout.')));
  });
}

async function main() {
  const directory = path.resolve('desktop-dist');
  const runtime = path.join(directory, 'runtime');
  await fs.mkdir(runtime, { recursive: true });
  // The backend uses the build host's Node ABI, independently of Electron.
  await fs.copyFile(process.execPath, path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'));
  await fs.writeFile(path.join(runtime, 'LICENSE'), await download(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`));
  await fs.writeFile(path.join(runtime, 'runtime.json'), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }));
  await build({
    entryPoints: ['server.ts'],
    outfile: path.join(directory, 'server.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    sourcemap: false,
  });
  console.log(`Desktop backend siap: Node ${process.version}, ${process.platform}-${process.arch}`);
  execFileSync(process.execPath, [path.join(__dirname, 'stage-desktop.cjs')], { stdio: 'inherit' });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
