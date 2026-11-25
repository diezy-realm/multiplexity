import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));

export default defineConfig({
  plugins:[react(),{
    name:'server-boundary',
    resolveId(source,importer){
      if(importer && !importer.includes('node_modules') && /(?:^@\/server\/|\/src\/server\/)/.test(source)) throw new Error('Server modules cannot be imported by the renderer: '+source);
    },
  }],
  resolve:{alias:{'@':path.resolve(root,'src')}},
  build:{outDir:'dist/client',emptyOutDir:true,sourcemap:false},
  server:{host:'127.0.0.1',port:3300,strictPort:true,proxy:{'/api':{target:`http://127.0.0.1:${process.env.MULTIPLEXITY_API_PORT || 3301}`,ws:true,changeOrigin:false}},fs:{strict:true},allowedHosts:['localhost','127.0.0.1'],watch:{ignored:['**/desktop-dist/**','**/dist/**','**/release/**','**/.local-dev/**','**/.test-artifacts/**','**/.test-tmp/**','**/desktop/**','**/scripts/**','**/tests/**','**/src/server/**','**/rust/**','**/src-tauri/**']}},
});
