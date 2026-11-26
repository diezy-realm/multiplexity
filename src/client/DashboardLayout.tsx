'use client';
import ActionIcon from '@/components/ActionIcon';
import { useState, lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  ChevronLeft,
  Code2,
  FileSearch,
  FolderGit2,
  MessageSquare,
  LibraryBig,
  Settings,
  X,
} from 'lucide-react';
import { useLibraryApps } from '@/components/LibraryProvider';
import { LIBRARY_APPS, launchUrl } from '@/lib/library';
import { signOut } from '@/client/auth';
import AppearanceProvider from '@/components/AppearanceProvider';
import PageHeader, { PageActionsContext } from '@/components/PageHeader';
import BrandMark from '@/components/BrandMark';

const ChatWorkspace = lazy(() => import('@/components/ChatWorkspace'));
const SnippetPanel = lazy(() => import('@/components/SnippetPanel'));

const primaryNav = [
  { href: '/investigate', label: 'Investigate', Icon: FileSearch },
  { href: '/chat', label: 'Chat', Icon: MessageSquare },
  { href: '/workspace', label: 'Workspace', Icon: FolderGit2 },
  { href: '/library', label: 'Library', Icon: LibraryBig },
];

const activityNav = { href: '/activity', label: 'Activity', Icon: Activity };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { pathname, search } = useLocation();
  const { data } = useLibraryApps();
  const visibleApps = LIBRARY_APPS.filter(app => data?.apps[app.id]?.enabled);
  const libraryAppId = new URLSearchParams(search).get('app');
  const activeLibraryShortcut = pathname === '/library' && visibleApps.some(app => app.id === libraryAppId && !('href' in app));
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dock, setDock] = useState<'snippets' | 'chat' | null>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);

  const title =
    ({
      '/': 'Virtual Machines',
      '/investigate': 'Investigate',
      '/chat': 'Chat',
      '/code-review': 'Code Review',
      '/library': 'Library',
      '/workspace': 'Workspace',
      '/artifacts': 'Workspace',
      '/activity': 'Activity',
      '/databases': 'Databases',
      '/konga': 'Konga',
      '/openshift': 'Openshift',
      '/confluent': 'Confluent',
      '/settings': 'Setting',
    } as Record<string, string>)[pathname] || 'Multiplexity';
  const navClass = (active: boolean) => `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${active ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`;

  return (
    <PageActionsContext.Provider value={actionsTarget}>
      <div className="h-dvh flex overflow-hidden bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 app-shell">
        <AppearanceProvider />
        {open && <button type="button" aria-label="Tutup sidebar" className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
        <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-all lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'lg:w-14' : 'lg:w-56'} w-56 shrink-0`}>
          <div className="h-14 shrink-0 flex items-center justify-between px-3 border-b border-gray-200 dark:border-gray-700">
            {!collapsed && <span className="inline-flex items-center gap-2 font-semibold text-sm"><BrandMark />Multiplexity</span>}
            <button type="button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="hidden lg:flex icon-action">
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={2} className={collapsed ? 'rotate-180' : ''} />
            </button>
            <button type="button" aria-label="Close sidebar" onClick={() => setOpen(false)} className="lg:hidden icon-action">
              <X aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          </div>
          <nav aria-label="Navigasi utama" className="p-2 space-y-1 flex-1 overflow-y-auto">
            {primaryNav.map(({ href, label, Icon }) => {
              const active = (pathname === href && !activeLibraryShortcut) || (href === '/workspace' && pathname === '/artifacts');
              return (
                <Link key={href} to={href} title={label} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)} className={navClass(active)}>
                  <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.7} />
                  {!collapsed && <span>{label}</span>}
                </Link>
              );
            })}
            {!!visibleApps.length && <div className="border-t border-[var(--ui-border)] pt-2 mt-2">
              {!collapsed && <p className="px-3 pb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Apps</p>}
              {visibleApps.map(app => {
                const href = launchUrl(app, data!.apps[app.id]);
                const active = 'href' in app ? pathname === app.href : pathname === '/library' && libraryAppId === app.id;
                return <Link key={app.id} to={href} title={app.name} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)} className={navClass(active)}>
                  <app.Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.7} />
                  {!collapsed && <span>{app.name}</span>}
                </Link>;
              })}
            </div>}
            <Link to={activityNav.href} title={activityNav.label} aria-current={pathname === activityNav.href ? 'page' : undefined} onClick={() => setOpen(false)} className={navClass(pathname === activityNav.href)}>
              <activityNav.Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.7} />
              {!collapsed && <span>{activityNav.label}</span>}
            </Link>
          </nav>
          <div className="p-2 border-t border-gray-200 dark:border-gray-700">
            <Link to="/settings" title="Setting" aria-current={pathname === '/settings' ? 'page' : undefined} onClick={() => setOpen(false)} className={navClass(pathname === '/settings')}>
              <Settings aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.7} />
              {!collapsed && <span>Setting</span>}
            </Link>
          </div>
        </aside>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <PageHeader title={title} actionsRef={setActionsTarget} onMenu={() => setOpen(true)} />
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            <main className={`flex-1 min-w-0 min-h-0 ${pathname === '/chat' ? 'overflow-hidden' : 'p-4 md:p-5 overflow-auto'}`}>
              {children}
            </main>
            {dock && (
              <aside aria-label="Panel kanan" className="absolute right-10 inset-y-0 z-20 w-[min(420px,calc(100%-40px))] xl:static xl:w-[400px] shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col min-h-0 shadow-xl xl:shadow-none">
                <div className="flex justify-between items-center px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-xs font-medium">{dock === 'snippets' ? 'Snipet' : 'Chat'}</span>
                  <button type="button" aria-label="Tutup panel kanan" onClick={() => setDock(null)} className="icon-action text-gray-500">
                    <X aria-hidden="true" size={16} strokeWidth={2} />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<div role="status" className="p-3 text-sm">Memuat…</div>}>
                    {dock === 'snippets' ? <SnippetPanel /> : <ChatWorkspace embedded />}
                  </Suspense>
                </div>
              </aside>
            )}
            <div aria-label="Sidebar kanan" className="w-10 shrink-0 flex flex-col gap-2 items-center pt-3 pb-3 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <button type="button" title="Snipet" aria-label="Buka Snipet" aria-pressed={dock === 'snippets'} onClick={() => setDock(dock === 'snippets' ? null : 'snippets')} className={`p-2 rounded ${dock === 'snippets' ? 'bg-gray-200 dark:bg-gray-700' : ''}`}>
                <Code2 aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.7} />
              </button>
              <button type="button" title="Chat kanan" aria-label="Buka Chat kanan" aria-pressed={dock === 'chat'} onClick={() => setDock(dock === 'chat' ? null : 'chat')} className={`p-2 rounded ${dock === 'chat' ? 'bg-gray-200 dark:bg-gray-700' : ''}`}>
                <MessageSquare aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.7} />
              </button>
              <button type="button" aria-label="Logout" title="Logout" onClick={() => void signOut({ callbackUrl: '/login' })} className="mt-auto icon-action">
                <ActionIcon name="logout" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageActionsContext.Provider>
  );
}
