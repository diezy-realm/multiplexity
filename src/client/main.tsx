import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import DashboardLayout from './DashboardLayout';
import Login from '@/pages/Login';
import '@/styles/globals.css';

const VirtualMachines=lazy(()=>import('@/pages/VirtualMachines'));
const Chat=lazy(()=>import('@/pages/Chat'));
const Artifacts=lazy(()=>import('@/pages/Artifacts'));
const Databases=lazy(()=>import('@/pages/Databases'));
const Konga=lazy(()=>import('@/pages/Konga'));
const Openshift=lazy(()=>import('@/pages/Openshift'));
const Settings=lazy(()=>import('@/pages/Settings'));
function Loading(){return <div role="status" className="p-5 text-sm text-gray-500">Memuat…</div>;}
class AppBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed ? <div role="alert" className="p-5">Halaman gagal dimuat. <button className="ui-button" onClick={()=>window.location.reload()}>Muat ulang</button></div> : this.props.children;}
}
function Protected(){
  const [state,setState]=useState<'loading'|'authenticated'|'anonymous'|'error'>('loading');
  const location=useLocation();
  useEffect(()=>{const controller=new AbortController();fetch('/api/auth/session',{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();setState((await response.json()).user?'authenticated':'anonymous');}).catch(()=>{if(!controller.signal.aborted)setState('error');});return()=>controller.abort();},[location.pathname]);
  if(state==='loading')return <Loading />;
  if(state==='error')return <div role="alert" className="p-5">Koneksi terputus. <button className="ui-button" onClick={()=>window.location.reload()}>Coba lagi</button></div>;
  if(state==='anonymous')return <Navigate to={'/login?callbackUrl='+encodeURIComponent(location.pathname+location.search)} replace />;
  return <DashboardLayout><Suspense fallback={<Loading />}><Outlet /></Suspense></DashboardLayout>;
}
createRoot(document.getElementById('root')!).render(<AppBoundary><BrowserRouter><Suspense fallback={<Loading />}><Routes>
  <Route path="/login" element={<Login />} />
  <Route element={<Protected />}>
    <Route path="/" element={<VirtualMachines />} /><Route path="/chat" element={<Chat />} />
    <Route path="/artifacts" element={<Artifacts />} /><Route path="/databases" element={<Databases />} />
    <Route path="/konga" element={<Konga />} /><Route path="/openshift" element={<Openshift />} /><Route path="/settings" element={<Settings />} />
  </Route>
  <Route path="*" element={<div className="p-5">Halaman tidak ditemukan. <a href="/">Kembali</a></div>} />
</Routes></Suspense></BrowserRouter></AppBoundary>);
