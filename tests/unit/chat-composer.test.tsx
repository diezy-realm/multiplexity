// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
vi.mock('@/components/Select',()=>({default:({children,...props}:React.SelectHTMLAttributes<HTMLSelectElement>)=><select {...props}>{children}</select>}));
import ChatWorkspace from '@/components/ChatWorkspace';
import { composerContext, parseComposerInput, type ComposerMode } from '@/lib/ai/composer';
const source={vmId:'vm-fixture',kind:'systemd' as const,target:'fixture.service',label:'Fixture service'};
let bodies:Record<string,unknown>[];
beforeEach(()=>{
  bodies=[];window.history.replaceState({},'','/chat');Element.prototype.scrollIntoView=vi.fn();
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if(url==='/api/ai/chat'&&options?.method==='POST'){bodies.push(JSON.parse(String(options.body)));return new Response(JSON.stringify({message:'Fixture answer'}),{headers:{'Content-Type':'application/json'}});}
    return new Response(JSON.stringify(url==='/api/ai/settings'?{provider:'codex',model:'fixture',connections:[]}:
      url==='/api/vms'?[{id:source.vmId,label:'Fixture VM'}]:url.includes('/services')?{services:[{id:'fixture',name:source.target,type:'systemd'}]}:
      url==='/api/artifacts'?{files:[]}: {messages:[]}));
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'','/chat');});
async function mount(deep=false,embedded=false){if(deep)window.history.replaceState({},'','/chat?vm=vm-fixture&kind=systemd&target=fixture.service');render(<ChatWorkspace embedded={embedded}/>);await waitFor(()=>expect((screen.getByLabelText('Pesan chat') as HTMLTextAreaElement).disabled).toBe(false));}
function mode(label:string){fireEvent.click(screen.getByLabelText('Tambah ke chat'));fireEvent.click(screen.getByRole('button',{name:label,exact:true}));}
async function send(){fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Check fixture'}});fireEvent.click(screen.getByLabelText('Kirim pesan'));await waitFor(()=>expect(bodies.length).toBe(1));}
it.each([
  ['logs','logs',false],['status','status',false],['resources','resources',false],['logs-resources','logs',true],[null,'logs',false],
])('maps mode %s to the existing request contract',(mode,diagnostic,includeResources)=>{
  expect(composerContext(mode as ComposerMode,[source])).toEqual({sources:mode?[source]:[],diagnostic,includeResources});
});
it('parses shortcuts without treating arbitrary exclamation text as active sources',()=>{
  expect(parseComposerInput('!resources Check')).toEqual({draft:'Check',mode:'resources'});
  expect(parseComposerInput('/diagnose Check')).toEqual({draft:'Check',skill:'diagnose'});
  expect(parseComposerInput('Hello!')).toEqual({draft:'Hello!'});expect(parseComposerInput('!unknown').error).toBeTruthy();
});
it('replaces the single mode without diagnostic requests and removing it excludes retained sources',async()=>{
  await mount(true);expect(screen.getByTestId('composer-mode').textContent).toContain('Analisis log');
  mode('Resource VM');mode('Log + resource');expect(screen.getAllByTestId('composer-mode')).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).includes('/services'))).toBe(false);
  fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Keep draft'}});
  fireEvent.click(screen.getByLabelText('Hapus mode Log + resource'));expect((screen.getByLabelText('Pesan chat') as HTMLTextAreaElement).value).toBe('Keep draft');expect(screen.getAllByText(/tidak dikirim/)[0]).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Kirim pesan'));await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0]).toMatchObject({sources:[],includeResources:false,message:'Keep draft'});
});
it.each([['Status service','status',false],['Resource VM','resources',false],['Log + resource','logs',true]])('sends %s with the correct source payload',async(label,diagnostic,includeResources)=>{
  await mount(true);mode(label);await send();expect(bodies[0]).toMatchObject({diagnostic,includeResources,sources:[{vmId:'vm-fixture',kind:'systemd',target:'fixture.service'}]});
});
it('requires a source and allows adding one through @ with visible default mode',async()=>{
  await mount();mode('Status service');fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Check fixture'}});fireEvent.click(screen.getByLabelText('Kirim pesan'));
  expect(bodies).toHaveLength(0);expect(await screen.findByText('Pilih sumber VM terlebih dahulu.')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Tutup pilihan'));fireEvent.click(screen.getByLabelText('Hapus mode Status service'));
  fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'@'}});
  fireEvent.change(screen.getByLabelText('VM sumber'),{target:{value:'vm-fixture'}});
  await waitFor(()=>expect((screen.getByLabelText('Service sumber') as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Service sumber'),{target:{value:'fixture'}});fireEvent.click(screen.getByText('Tambahkan'));
  expect(screen.getByTestId('composer-mode').textContent).toContain('Analisis log');
});
it('synchronizes diagnostic and skill shortcuts, preserves skill across mode switches, and keeps menus exclusive',async()=>{
  await mount(true);fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'!resources Investigate'}});
  expect(screen.getByTestId('composer-mode').textContent).toContain('Resource VM');
  fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'/summarize Investigate'}});
  mode('Status service');expect(screen.getByLabelText('Hapus skill summarize')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Pengaturan AI'));expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.keyDown(screen.getByLabelText('Permission'),{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('Pengaturan AI')));
});
it('supports keyboard menu navigation and source-free send with ordinary punctuation',async()=>{
  await mount();const add=screen.getByLabelText('Tambah ke chat');fireEvent.click(add);
  const first=screen.getByLabelText('Tutup pilihan');fireEvent.keyDown(first,{key:'ArrowDown'});expect(document.activeElement).toBe(within(screen.getByLabelText('Pilihan chat')).getByRole('button',{name:'Analisis log',exact:true}));
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});await waitFor(()=>expect(document.activeElement).toBe(add));
  fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Hello!'}});fireEvent.keyDown(screen.getByLabelText('Pesan chat'),{key:'Enter',shiftKey:true});expect(bodies).toHaveLength(0);
  fireEvent.keyDown(screen.getByLabelText('Pesan chat'),{key:'Enter',isComposing:true});expect(bodies).toHaveLength(0);
  fireEvent.keyDown(screen.getByLabelText('Pesan chat'),{key:'Enter'});await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0].sources).toEqual([]);
});
it('invalidates approval after provider, model, permission, and mode changes; Retry retains its snapshot',async()=>{
  await mount(true);fireEvent.click(screen.getByLabelText('Pengaturan AI'));fireEvent.change(screen.getByLabelText('Permission'),{target:{value:'ask'}});fireEvent.click(screen.getByLabelText('Tutup pilihan'));
  fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Original'}});fireEvent.click(screen.getByLabelText('Kirim pesan'));expect(screen.getByLabelText('Izin membaca log')).toBeTruthy();expect(bodies).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('AI provider'),{target:{value:'openai'}});expect(screen.queryByLabelText('Izin membaca log')).toBeNull();
  fireEvent.click(screen.getByLabelText('Kirim pesan'));expect(screen.getByLabelText('Izin membaca log')).toBeTruthy();
  mode('Status service');expect(screen.queryByLabelText('Izin membaca log')).toBeNull();
  fireEvent.click(screen.getByLabelText('Kirim pesan'));fireEvent.click(screen.getByText('Izinkan'));await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0]).toMatchObject({permission:'ask',approved:true,provider:'openai',diagnostic:'status'});
});
it('handles backend approvalRequired and asks again with the failed request snapshot',async()=>{
  const original=fetch;let calls=0;vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if(url==='/api/ai/chat'&&options?.method==='POST'&&calls++===0)return new Response(JSON.stringify({approvalRequired:true,error:'Confirm fixture'}),{status:428});return original(url,options);
  }));
  await mount(true);fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Original'}});fireEvent.click(screen.getByLabelText('Kirim pesan'));
  await screen.findByText('Confirm fixture');expect(screen.getByLabelText('Izin membaca log')).toBeTruthy();
  fireEvent.click(screen.getByText('Izinkan'));await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0]).toMatchObject({message:'Original',approved:true});
});
it('keeps the narrow composer context collapsed and rejects unsupported images without clearing text',async()=>{
  await mount(true,true);expect(screen.getByText(/Konteks · 1 sumber/).closest('details')?.open).toBe(false);
  fireEvent.change(screen.getByLabelText('Pesan chat'),{target:{value:'Keep text'}});fireEvent.change(screen.getByLabelText('AI provider'),{target:{value:'kiro'}});
  fireEvent.change(screen.getByLabelText('Attachment file'),{target:{files:[new File(['fixture'],'image.png',{type:'image/png'})]}});
  expect(await screen.findByText('Adaptor provider ini belum mendukung gambar.')).toBeTruthy();expect((screen.getByLabelText('Pesan chat') as HTMLTextAreaElement).value).toBe('Keep text');
});
