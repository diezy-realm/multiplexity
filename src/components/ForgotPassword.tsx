'use client';
import Dialog from './Dialog';
export default function ForgotPassword({ onClose }: { initialUsername: string; onClose: () => void }) {
  return <Dialog title="Pemulihan akun" onClose={onClose}><p className="text-sm">Pemulihan melalui Windows Hello dinonaktifkan. Gunakan password akun untuk masuk.</p></Dialog>;
}
