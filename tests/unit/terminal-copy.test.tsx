// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
const selection=vi.hoisted(()=>({changed:()=>{},text:''}));
vi.mock('@xterm/xterm',()=>({Terminal:class {loadAddon(){} open(){} onData(){} dispose(){} getSelection(){return selection.text;} onSelectionChange(callback:()=>void){selection.changed=callback;}}}));
vi.mock('@xterm/addon-fit',()=>({FitAddon:class {fit(){}}}));
vi.mock('socket.io-client',()=>({io:()=>({on:vi.fn(),emit:vi.fn(),disconnect:vi.fn(),connected:false})}));
vi.mock('@/components/TerminalSearchBar',()=>({default:()=>null}));
vi.mock('@/components/AIAnalyzeModal',()=>({default:()=>null}));
vi.mock('@/components/PrettifyModal',()=>({default:()=>null}));
import Terminal from '@/components/Terminal';
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue(undefined)}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('copies the exact xterm selection and hides the action when selection is cleared',async()=>{
 render(<Terminal vmId="synthetic" vmLabel="Synthetic" isActive onClose={()=>{}} />);
 expect(screen.queryByLabelText('Copy terminal selection')).toBeNull();
 act(()=>{selection.text='first line\nsecond line';selection.changed();});
 fireEvent.click(screen.getByLabelText('Copy terminal selection'));
 expect(navigator.clipboard.writeText).toHaveBeenCalledWith('first line\nsecond line');
 act(()=>{selection.text='';selection.changed();});
 expect(screen.queryByLabelText('Copy terminal selection')).toBeNull();
});
