import { SKILLS, type LogSource } from './catalog';

export type ComposerMode = null | 'logs' | 'status' | 'resources' | 'logs-resources';
export type ComposerMenu = null | 'add' | 'source' | 'skills' | 'commands' | 'artifacts' | 'settings';
export const COMPOSER_MODES = [
  { id:'logs', label:'Analisis log' },
  { id:'status', label:'Status service' },
  { id:'resources', label:'Resource VM' },
  { id:'logs-resources', label:'Log + resource' },
] as const;
export function composerContext(mode:ComposerMode,sources:LogSource[]) {
  return { sources:mode ? sources : [], diagnostic:mode==='status'?'status' as const:mode==='resources'?'resources' as const:'logs' as const, includeResources:mode==='logs-resources' };
}
export function parseComposerInput(value:string) {
  const command=value.match(/^!(\S+)(\s|$)/);
  const slash=value.match(/^\/(\S+)(\s|$)/);
  if(command){
    if(!['logs','status','resources'].includes(command[1]))return {draft:value,error:'Command tersedia: !logs, !status, !resources.'};
    return {draft:value.slice(command[0].length),mode:command[1] as Exclude<ComposerMode,null|'logs-resources'>};
  }
  if(slash&&SKILLS.some(item=>item.id===slash[1]))return {draft:value.slice(slash[0].length),skill:slash[1]};
  return {draft:value};
}
