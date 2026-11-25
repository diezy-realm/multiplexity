const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('jsonc-parser');

async function main() {
  const repository = 'tokyo-night/tokyo-night-vscode-theme';
  async function get(url) { const response = await fetch(url,{headers:{'User-Agent':'manager-system-theme-builder'}}); if (!response.ok) throw new Error(`Theme download failed: ${response.status}`); return response.text(); }
  const commit = JSON.parse(await get(`https://api.github.com/repos/${repository}/commits/master`)).sha;
  const base = `https://raw.githubusercontent.com/${repository}/${commit}`;
  const presets = [];
  for (const [id,file] of [['tokyo-night','tokyo-night-color-theme.json'],['tokyo-storm','tokyo-night-storm-color-theme.json'],['tokyo-light','tokyo-night-light-color-theme.json']]) {
    const errors = []; const source = parse(await get(`${base}/themes/${file}`),errors,{allowTrailingComma:true});
    if (errors.length) throw new Error('Invalid upstream theme.');
    const supported = /^(editor\.(background|foreground)|sideBar\.(background|foreground)|panel\.(background|border)|input\.(background|foreground|border)|button\.(background|foreground)|terminal\.(background|foreground|ansi.+)|terminalCursor\.foreground|focusBorder|foreground)$/;
    presets.push({id,name:source.name,theme:source.type === 'light' || source.type === 'vs' || id === 'tokyo-light' ? 'light' : 'dark',colors:Object.fromEntries(Object.entries(source.colors).filter(([key,value])=>supported.test(key) && typeof value === 'string' && /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value)))});
  }
  const folder = path.resolve(__dirname,'../src/lib/themes'); await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'presets.json'),JSON.stringify({source:`https://github.com/${repository}`,commit,presets},null,2)+'\n');
  const licenseFolder = path.resolve(__dirname,'../desktop/licenses'); await fs.mkdir(licenseFolder,{recursive:true});
  await fs.writeFile(path.join(licenseFolder,'tokyo-night.txt'),await get(`${base}/LICENSE.txt`));
  console.log('THEME_PRESETS_OK',JSON.stringify({presets:presets.length,commit}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
