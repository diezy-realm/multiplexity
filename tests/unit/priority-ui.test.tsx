// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import ConfirmDialog from '@/components/ConfirmDialog';
import ArtifactPage from '@/pages/Artifacts';
beforeEach(()=>{vi.stubGlobal('React',React);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps a failed confirmation open and blocks dismissal while its action is running',async()=>{
 let finish!:()=>void;const close=vi.fn();const action=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<ConfirmDialog confirmation={{title:'Fixture action',description:'Synthetic operation',action}} onClose={close}/>);
 fireEvent.click(screen.getByText('Lanjutkan'));fireEvent.click(screen.getByLabelText('Tutup'));
 expect(close).not.toHaveBeenCalled();expect((screen.getByText('Memproses…') as HTMLButtonElement).disabled).toBe(true);
 finish();await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(action).toHaveBeenCalledTimes(1);
});
it('shows action failures inside the confirmation instead of implying success',async()=>{
 const close=vi.fn();render(<ConfirmDialog confirmation={{title:'Fixture action',description:'Synthetic operation',action:async()=>{throw new Error('Synthetic failure');}}} onClose={close}/>);
 fireEvent.click(screen.getByText('Lanjutkan'));expect(await screen.findByRole('alert')).toHaveProperty('textContent','Synthetic failure');expect(close).not.toHaveBeenCalled();
});
it('loads an old artifact version for review and requires Save before restoring it',async()=>{
 const posts:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  const parsed=new URL(url,'http://localhost');const query=parsed.searchParams;
  let data:unknown;
  if(options?.method==='POST'){posts.push(JSON.parse(options.body as string));data={success:true};}
  else if(query.has('versions'))data={versions:[{id:'old-version',hash:'b'.repeat(64),created_at:'2026-01-01'}]};
  else if(query.has('version'))data={content:'Old document'};
  else if(query.has('name'))data={name:'artifacts/test.md',content:'Current document',hash:'a'.repeat(64)};
  else data={files:[{name:'artifacts/test.md',size:16}]};
  return {ok:true,json:async()=>data};
 }));
 render(<ArtifactPage/>);fireEvent.click(await screen.findByTitle('artifacts/test.md'));
 await waitFor(()=>expect((screen.getByLabelText('Isi artifact') as HTMLTextAreaElement).value).toBe('Current document'));
 fireEvent.click(screen.getByRole('tab',{name:'Versi'}));fireEvent.click(await screen.findByText('2026-01-01 · bbbbbbbb'));
 expect(await screen.findByText('Old document')).toBeTruthy();expect(screen.getByText('Current document')).toBeTruthy();
 fireEvent.click(screen.getByText('Muat versi ke editor'));
 expect((screen.getByLabelText('Isi artifact') as HTMLTextAreaElement).value).toBe('Old document');expect(posts).toHaveLength(0);
 fireEvent.click(screen.getByText('Simpan'));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0]).toMatchObject({content:'Old document',expectedHash:'a'.repeat(64)});
});
