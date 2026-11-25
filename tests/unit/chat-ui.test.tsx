// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
vi.mock('@/components/Select',()=>({default:({children,...props}:React.SelectHTMLAttributes<HTMLSelectElement>)=><select {...props}>{children}</select>}));
import ChatWorkspace from '@/components/ChatWorkspace';
import MarkdownOutput from '@/components/MarkdownOutput';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
beforeEach(()=>{
 vi.stubGlobal('React',React);
 Element.prototype.scrollIntoView=vi.fn();
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue(undefined)}});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/ai/settings'?{connections:[],provider:'codex',model:''}:url==='/api/ai/chat'?{messages:[]}:url==='/api/artifacts'?{files:[]}:[]})));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('copies fenced code without Markdown and offers response copy',async()=>{
 render(<MarkdownOutput content={'```sh\necho test\n```'} />);
 fireEvent.click(screen.getByLabelText('Copy code'));
 await waitFor(()=>expect(navigator.clipboard.writeText).toHaveBeenCalledWith('echo test\n'));
 expect(screen.getByLabelText('Copy response')).toBeTruthy();
});
it('pastes a clipboard image, previews it and toggles Artifact closed',async()=>{
 render(<ChatWorkspace />);
 const input=screen.getByLabelText('Pesan chat');
 await waitFor(()=>expect((input as HTMLTextAreaElement).disabled).toBe(false));
 const file=new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'clipboard.png',{type:'image/png'});
 fireEvent.paste(input,{clipboardData:{items:[{kind:'file',getAsFile:()=>file}],getData:()=>''}});
 expect(await screen.findByAltText('clipboard.png')).toBeTruthy();
 expect((screen.getByLabelText('Kirim pesan') as HTMLButtonElement).disabled).toBe(false);
 expect(screen.queryByPlaceholderText('Default CLI')).toBeNull();
 fireEvent.click(screen.getByLabelText('Tambah ke chat'));fireEvent.click(screen.getByLabelText('Lampirkan Artifact'));
 await screen.findByLabelText('Pilihan chat');
 fireEvent.click(screen.getByLabelText('Tutup pilihan'));
 await waitFor(()=>expect(screen.queryByLabelText('Pilihan chat')).toBeNull());
});
it('retries the failed request snapshot rather than a subsequently edited draft',async()=>{
 const base=fetch;const bodies:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(url==='/api/ai/chat'&&options?.method==='POST'){bodies.push(JSON.parse(options.body as string));return bodies.length===1?new Response(JSON.stringify({error:'Synthetic timeout'}),{status:502}):new Response(JSON.stringify({message:'Recovered'}),{headers:{'Content-Type':'application/json'}});}
  return base(url,options);
 }));
 render(<ChatWorkspace/>);const input=screen.getByLabelText('Pesan chat');
 await waitFor(()=>expect((input as HTMLTextAreaElement).disabled).toBe(false));
 fireEvent.change(input,{target:{value:'Original request'}});fireEvent.click(screen.getByLabelText('Kirim pesan'));
 const retry=await screen.findByText('Coba lagi');fireEvent.change(input,{target:{value:'Edited after failure'}});fireEvent.click(retry);
 await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[1]).toEqual(bodies[0]);
});
it('opens a persisted evidence snapshot instead of requesting current server logs',async()=>{
 const base=fetch;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>url==='/api/ai/chat'&&!options?.method?{ok:true,json:async()=>({messages:[{id:2,role:'assistant',content:'Diagnosis',sources:[{label:'Fixture service',timestamp:'2026-01-01T00:00:00Z',excerpt:'Original bounded snapshot',truncated:true}]}]})}:base(url,options)));
 render(<ChatWorkspace/>);fireEvent.click(await screen.findByText('Fixture service'));
 expect(await screen.findByText('Original bounded snapshot')).toBeTruthy();
 expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).includes('/services'))).toBe(false);
});
it('finishes local reveal without discarding an answer that already completed on the server',async()=>{
 const original=fetch;const answer=Array(80).fill('Synthetic completed sentence.').join(' ');let completed=false;
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  calls.push(url);
  if(url==='/api/ai/chat' && options?.method==='POST'){completed=true;return new Response(JSON.stringify({message:answer,sources:[]}),{headers:{'Content-Type':'application/json'}});}
  if(url==='/api/ai/chat' && completed)return new Response(JSON.stringify({messages:[{role:'user',content:'Synthetic question'},{role:'assistant',content:answer}]}));
  return original(url,options);
 }));
 render(<ChatWorkspace />);const input=screen.getByLabelText('Pesan chat');
 await waitFor(()=>expect((input as HTMLTextAreaElement).disabled).toBe(false));
 fireEvent.change(input,{target:{value:'Synthetic question'}});fireEvent.click(screen.getByLabelText('Kirim pesan'));
 await screen.findByLabelText('Respons AI berjalan');fireEvent.click(screen.getByLabelText('Hentikan respons'));
 await waitFor(()=>expect(screen.queryByLabelText('Hentikan respons')).toBeNull());
 expect((await screen.findByLabelText('Respons AI')).textContent).toContain('Synthetic completed sentence.');
 expect(calls).not.toContain('/api/ai/chat/cancel');
});
