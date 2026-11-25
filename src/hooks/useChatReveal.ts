'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
export function useChatReveal(){
  const [text,setText]=useState('');const target=useRef('');const visible=useRef(0);const timer=useRef<ReturnType<typeof setTimeout> | null>(null);const completed=useRef<(()=>void) | null>(null);
  const tick=useCallback(function advance(){
    timer.current=null;
    const reduced=typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const remaining=target.current.length-visible.current;
    visible.current=reduced?target.current.length:Math.min(target.current.length,visible.current+Math.max(24,Math.ceil(remaining/10)));
    if(visible.current<target.current.length && /[\uD800-\uDBFF]/.test(target.current[visible.current-1] || ''))visible.current++;
    setText(target.current.slice(0,visible.current));
    if(visible.current<target.current.length)timer.current=setTimeout(advance,24);
    else{completed.current?.();completed.current=null;}
  },[]);
  const reset=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;completed.current?.();completed.current=null;target.current='';visible.current=0;setText('');},[]);
  const append=useCallback((delta:string)=>{target.current+=delta;if(!timer.current)tick();},[tick]);
  const finish=useCallback((answer:string)=>new Promise<void>(resolve=>{target.current=answer;visible.current=Math.min(visible.current,answer.length);completed.current=resolve;if(!timer.current)tick();}),[tick]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);completed.current?.();},[]);
  return {text,append,finish,reset};
}
