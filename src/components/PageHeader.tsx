'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const PageActionsContext = createContext<HTMLDivElement | null>(null);
export function PageActions({ children, inline = false }: {children:ReactNode;inline?:boolean}) {
  const target = useContext(PageActionsContext);
  const actions = <div className="flex items-center gap-2 page-actions">{children}</div>;
  return target && !inline ? createPortal(actions,target) : actions;
}
export default function PageHeader({ title, actionsRef, onMenu }: {title:string;actionsRef:(element:HTMLDivElement | null)=>void;onMenu:()=>void}) {
  return <header className="page-header shrink-0 flex items-center justify-between gap-3 px-4 md:px-5 border-b border-gray-200 dark:border-gray-700" data-testid="page-header"><div className="flex items-center gap-3 min-w-0"><button type="button" aria-label="Open sidebar" onClick={onMenu} className="lg:hidden icon-action"><svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button><h1 className="text-base font-semibold truncate">{title}</h1></div><div ref={actionsRef} className="flex items-center gap-2 min-w-0" /></header>;
}
