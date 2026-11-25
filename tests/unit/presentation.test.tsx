// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MarkdownOutput from '@/components/MarkdownOutput';
import SnippetPanel from '@/components/SnippetPanel';
import AIAnalyzeModal from '@/components/AIAnalyzeModal';
import { themePresets } from '@/lib/themes';
import { defaultAppearance, validAppearance } from '@/lib/appearance';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('renders Markdown structure without executing HTML or loading remote images',()=>{
  const {container}=render(<MarkdownOutput content={'# Result\n\n**Evidence** and `code`\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>unsafe()</script>\n\n![remote](https://example.com/pixel)\n\n[bad](javascript:alert(1))'} />);
  expect(screen.getByRole('heading',{name:'Result'})).toBeTruthy();
  expect(container.querySelector('strong')?.textContent).toBe('Evidence');
  expect(container.querySelector('table')).toBeTruthy();
  expect(container.querySelector('script,img')).toBeNull();
  expect(container.innerHTML).not.toContain('href="javascript:');
  expect(screen.getByLabelText('Unduh Markdown')).toBeTruthy();
});
it('opens snippet editor only on demand and copies saved snippets directly',async()=>{
  const copy=vi.fn(async()=>{});vi.stubGlobal('navigator',{clipboard:{writeText:copy}});
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('?id=') ? {id:'s1',title:'Synthetic',kind:'credential',content:'synthetic-only'} : {snippets:[{id:'s1',title:'Synthetic',kind:'credential'}]}})));
  render(<SnippetPanel />);
  const item=await screen.findByLabelText('Salin Synthetic');
  expect(screen.queryByLabelText('Judul snipet')).toBeNull();
  fireEvent.click(item);await screen.findByText('Synthetic disalin');
  expect(copy).toHaveBeenCalledWith('synthetic-only');
  expect(screen.queryByLabelText('Isi snipet')).toBeNull();
  fireEvent.click(screen.getByText('Tambah baru'));
  expect(screen.getByLabelText('Judul snipet')).toBeTruthy();expect(screen.getByLabelText('Isi snipet')).toBeTruthy();
});
it('ships valid dark and light palettes from the pinned upstream theme source',()=>{
  expect(themePresets.length).toBeGreaterThanOrEqual(3);
  expect(themePresets.some(item=>item.theme==='light')).toBe(true);
  for(const preset of themePresets) expect(validAppearance({...defaultAppearance,theme:preset.theme,colors:preset.colors})).toBe(true);
});
it('uses the same Markdown renderer for service AI analysis',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({analysis:'## Diagnosis\n\n**Synthetic evidence**',artifact:'artifacts/result.md'})})));
  render(<AIAnalyzeModal isOpen onClose={()=>{}} logText="Synthetic log" />);
  fireEvent.click(screen.getByText('Analisis'));
  expect(await screen.findByRole('heading',{name:'Diagnosis'})).toBeTruthy();
  expect((await screen.findByText('Synthetic evidence')).tagName).toBe('STRONG');
});
