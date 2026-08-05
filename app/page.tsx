"use client";

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LandingPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    if (isLogin) {
      const res = await signIn('credentials', { redirect: false, email, password });
      if (res?.error) { setError('Email atau kata sandi tidak sesuai.'); setLoading(false); }
      else router.push('/dashboard');
      return;
    }
    try {
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Akun tidak dapat dibuat.'); setLoading(false); return; }
      await signIn('credentials', { redirect: false, email, password });
      router.push('/dashboard');
    } catch { setError('Terjadi kesalahan. Coba lagi.'); setLoading(false); }
  };

  return <div className="auth-container"><div className="auth-card glass-panel">
    <div className="auth-brand">
      <Image src="/logo.png" alt="CafeSync Logo" width={80} height={80} style={{ borderRadius: '50%', marginBottom: '1rem' }} />
      <h1 className="text-gradient">CafeSync</h1><p>Kelola laporan penjualan kafe dalam satu tempat.</p>
    </div>
    {error && <div className="error-message">{error}</div>}
    <form onSubmit={handleSubmit}>
      <div className="input-group"><label className="input-label">Alamat email</label><input type="email" className="input-field" placeholder="nama@kafe.com" value={email} onChange={e => setEmail(e.target.value)} required /></div>
      <div className="input-group"><label className="input-label">Kata sandi</label><input type="password" className="input-field" placeholder="Masukkan kata sandi" value={password} onChange={e => setPassword(e.target.value)} required /></div>
      <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '6px' }} disabled={loading}>{loading ? 'Memproses...' : isLogin ? 'Masuk' : 'Buat akun'}</button>
    </form>
    <div style={{ textAlign: 'center' }}><button type="button" className="auth-switch" onClick={() => { setIsLogin(!isLogin); setError(''); }}>{isLogin ? 'Belum punya akun? Daftar sekarang' : 'Sudah punya akun? Masuk'}</button></div>
  </div></div>;
}
