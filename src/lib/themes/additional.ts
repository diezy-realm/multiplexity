import type { Appearance } from '@/lib/appearance';
function palette(id:string,name:string,background:string,foreground:string,accent:string,panel:string) {
  return {id,name,theme:'dark' as Appearance['theme'],colors:{'editor.background':background,'editor.foreground':foreground,'sideBar.background':panel,'sideBar.foreground':foreground,'panel.background':panel,'panel.border':accent+'66','input.background':background,'input.foreground':foreground,'button.background':accent,'button.foreground':'#101018','terminal.background':background,'terminal.foreground':foreground,'terminalCursor.foreground':accent,'focusBorder':accent}};
}
// Original UI palettes; existing imported theme sources remain unchanged.
export const additionalThemes = [
  palette('vampire','Vampire','#19131f','#eee6f4','#e979aa','#261b30'),
  palette('neon','Neon','#101221','#e1f8f5','#37efc8','#191b32'),
  palette('nord-inspired','Nord inspired','#293340','#e0e7ef','#91c8d4','#333e4e'),
  palette('monokai-inspired','Monokai inspired','#25271f','#eeeede','#b2d95f','#303329'),
  palette('solarized-inspired','Solarized inspired','#092a34','#b3cac9','#e7bd55','#103743'),
];
