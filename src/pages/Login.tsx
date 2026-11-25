'use client';
import BrandMark from '@/components/BrandMark';

import { useState, useEffect, FormEvent } from 'react';
import { signIn } from '@/client/auth';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    fetch('/api/auth/desktop-setup')
      .then(async response => {
        if (response.ok) setSetupRequired((await response.json()).setupRequired);
      })
      .catch(() => setError('Tidak dapat memeriksa konfigurasi awal. Buka ulang halaman.'))
      .finally(() => setCheckingSetup(false));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (setupRequired) {
        const response = await fetch('/api/auth/desktop-setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) {
          setError((await response.json()).error || 'Gagal membuat akun');
          if (response.status === 409) setSetupRequired(false);
          return;
        }
        setSetupRequired(false);
      }
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Username atau password salah');
      } else {
        const callback=new URLSearchParams(window.location.search).get('callbackUrl')||'/';
        const target=new URL(callback,window.location.origin);
        navigate(target.origin===window.location.origin?target.pathname+target.search:'/');
      }
    } catch {
      setError('Username atau password salah');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 text-center mb-6">
          <span className="inline-flex items-center gap-3"><BrandMark size={40} />Multiplexity</span>
        </h1>

        {setupRequired && (
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
            Buat akun lokal untuk perangkat ini. Gunakan username 3–64 karakter
            (huruf, angka, titik, garis bawah, atau tanda minus) dan password minimal 12 karakter.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Masukkan username"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={setupRequired ? 12 : undefined}
              autoComplete={setupRequired ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Masukkan password"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || checkingSetup}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800"
          >
            {checkingSetup ? 'Memeriksa konfigurasi...' : isLoading ? 'Memproses...' : setupRequired ? 'Buat Akun & Masuk' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
