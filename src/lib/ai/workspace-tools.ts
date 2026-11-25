import { listWorkspace, readWorkspace, writeWorkspace } from './workspace';
import type { Permission } from './catalog';
export const workspaceTools = [
  { name:'list_artifacts', description:'List files in this account shared agent workspace.', parameters:{ type:'object', properties:{}, additionalProperties:false } },
  { name:'read_artifact', description:'Read a file from the shared agent workspace.', parameters:{ type:'object', properties:{ name:{type:'string'} }, required:['name'], additionalProperties:false } },
  { name:'write_artifact', description:'Save an output document under artifacts/. Requires Allow All.', parameters:{ type:'object', properties:{ name:{type:'string'}, content:{type:'string'} }, required:['name','content'], additionalProperties:false } },
];
export function executeWorkspaceTool(userId: string, permission: Permission, name: string, args: Record<string, unknown>): string {
  try {
    if (name === 'list_artifacts') return JSON.stringify(listWorkspace(userId).files);
    if (name === 'read_artifact' && typeof args.name === 'string') return readWorkspace(userId, args.name).slice(0,64000);
    if (name === 'write_artifact' && permission === 'allow-all' && typeof args.name === 'string' && args.name.startsWith('artifacts/') && typeof args.content === 'string') return JSON.stringify({ saved:writeWorkspace(userId,args.name,args.content) });
    return JSON.stringify({ error:'Tool atau izin tidak tersedia.' });
  } catch { return JSON.stringify({ error:'File tidak tersedia atau path tidak diizinkan.' }); }
}
