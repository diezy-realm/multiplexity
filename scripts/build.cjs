const { build } = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
async function main(){
  require('./generate-routes.cjs');
  const vite=await import('vite');
  await vite.build();
  await build({entryPoints:['server.ts'],outfile:'dist/server/server.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external'});
  await fs.mkdir('dist/server',{recursive:true});
  await fs.copyFile('src/lib/db/schema.sql',path.join('dist/server','schema.sql'));
  console.log('SHARED_BUILD_OK');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
