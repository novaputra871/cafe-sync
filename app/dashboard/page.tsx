"use client";

import React, { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import Image from 'next/image';

type Tab = 'upload' | 'google' | 'telegram';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState('harian');
  const [uploadStatus, setUploadStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [configStatus, setConfigStatus] = useState('');

  useEffect(() => {
    fetch('/api/config').then(res => res.json()).then(data => {
      if (!data.config) return;
      setGoogleEmail(data.config.googleServiceAccountEmail || '');
      setGoogleKey(data.config.googlePrivateKey || '');
      setSheetId(data.config.spreadsheetId || '');
      setSheetName(data.config.sheetName || '');
      setTelegramToken(data.config.telegramBotToken || '');
      setTelegramChatId(data.config.telegramChatId || '');
      setOpenRouterApiKey(data.config.openRouterApiKey || '');
    }).catch(err => console.error('Failed to load config', err));
  }, []);

  const changeTab = (tab: Tab) => { setActiveTab(tab); setConfigStatus(''); };
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true); setUploadStatus('Laporan sedang diproses...');
    const formData = new FormData();
    formData.append('csvFile', file); formData.append('reportType', reportType);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      setUploadStatus(res.ok ? 'Laporan berhasil dikirim dan dashboard sedang diperbarui.' : `Error: ${data.error || 'Upload gagal'}`);
      if (res.ok) setFile(null);
    } catch { setUploadStatus('Error: Terjadi masalah jaringan.'); }
    finally { setLoading(false); }
  };
  const handleSync = async () => {
    setSyncLoading(true); setUploadStatus('Membaca data dari Spreadsheet...');
    try {
      const res = await fetch('/api/sync-sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportType }) });
      const data = await res.json();
      setUploadStatus(res.ok ? 'Dashboard berhasil diperbarui dari Spreadsheet.' : `Error: ${data.error || 'Sinkronisasi gagal'}`);
    } catch { setUploadStatus('Error: Terjadi masalah jaringan.'); }
    finally { setSyncLoading(false); }
  };
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault(); setConfigStatus('Menyimpan...');
    try {
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googleServiceAccountEmail: googleEmail, googlePrivateKey: googleKey, spreadsheetId: sheetId, sheetName, telegramBotToken: telegramToken, telegramChatId, openRouterApiKey }) });
      setConfigStatus(res.ok ? 'Pengaturan berhasil disimpan.' : 'Pengaturan gagal disimpan.');
    } catch { setConfigStatus('Terjadi kesalahan saat menyimpan.'); }
  };

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand">
          <Image src="/logo.png" alt="CafeSync Logo" width={40} height={40} style={{ borderRadius: '50%' }} />
          <div><h1>CafeSync</h1><p>Ruang kerja analitik penjualan</p></div>
        </div>
      </header>
      <div className="dashboard-layout">
        <nav className="glass-panel sidebar" aria-label="Navigasi dashboard">
          <p className="sidebar-label">Menu utama</p>
          <ul className="nav-list">
            <li><button className={`nav-button ${activeTab === 'upload' ? 'is-active' : ''}`} onClick={() => changeTab('upload')}><span className="nav-icon">↑</span>Data penjualan</button></li>
            <li><button className={`nav-button ${activeTab === 'google' ? 'is-active' : ''}`} onClick={() => changeTab('google')}><span className="nav-icon">□</span>Google Sheets</button></li>
            <li><button className={`nav-button ${activeTab === 'telegram' ? 'is-active' : ''}`} onClick={() => changeTab('telegram')}><span className="nav-icon">◌</span>Notifikasi</button></li>
            <li className="mobile-only-nav"><button className="nav-button" onClick={() => signOut({ callbackUrl: '/' })}><span className="nav-icon">⇥</span>Keluar</button></li>
          </ul>
          <div className="desktop-only-logout" style={{ marginTop: 'auto', paddingTop: '20px' }}>
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => signOut({ callbackUrl: '/' })}>Keluar</button>
          </div>
        </nav>
        <main className="glass-panel content-panel">
          {activeTab === 'upload' && <section>
            <div className="panel-heading"><p className="eyebrow">Data penjualan</p><h2>Perbarui laporan Anda</h2><p>Unggah laporan CSV baru, atau buat ulang visualisasi dari data yang sudah tersimpan di Google Sheets.</p></div>
            <form className="upload-form" onSubmit={handleUpload}>
              <div className="form-grid"><div className="input-group"><label className="input-label">Periode laporan</label><select className="input-field" value={reportType} onChange={e => setReportType(e.target.value)}><option value="harian">Harian — tren per jam</option><option value="bulanan">Bulanan — tren per tanggal</option><option value="tahunan">Tahunan — tren per bulan</option></select></div><div className="input-group"><label className="input-label">File laporan</label><div className="file-drop"><div><strong>{file?.name || 'Pilih file CSV'}</strong><span>Kolom: tanggal, menu, kategori, jumlah, total</span></div><input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] || null)} /></div></div></div>
              <div className="action-row"><button type="submit" className="btn btn-primary" disabled={loading || syncLoading || !file}>{loading ? 'Memproses...' : 'Unggah laporan'}</button><button type="button" className="btn btn-secondary" disabled={loading || syncLoading} onClick={handleSync}>{syncLoading ? 'Memperbarui...' : 'Buat ulang dari Spreadsheet'}</button></div>
            </form>
            {uploadStatus && <p className="status-message">{uploadStatus}</p>}
          </section>}
          {activeTab === 'google' && <form onSubmit={handleSaveConfig}>
            <div className="panel-heading"><p className="eyebrow">Integrasi</p><h2>Hubungkan Google Sheets</h2><p>Data laporan disimpan dan visualisasi dashboard dibuat pada spreadsheet ini.</p></div>
            <div className="form-grid"><div className="input-group"><label className="input-label">Email service account</label><input type="email" className="input-field" placeholder="project@iam.gserviceaccount.com" value={googleEmail} onChange={e => setGoogleEmail(e.target.value)} /></div><div className="input-group"><label className="input-label">Spreadsheet ID</label><input className="input-field" placeholder="1BxiMVs0XRYFg..." value={sheetId} onChange={e => setSheetId(e.target.value)} /></div></div>
            <div className="form-grid"><div className="input-group"><label className="input-label">Nama sheet</label><input className="input-field" placeholder="Sheet1" value={sheetName} onChange={e => setSheetName(e.target.value)} /></div></div><div className="input-group"><label className="input-label">Private key</label><textarea className="input-field" placeholder="-----BEGIN PRIVATE KEY-----" value={googleKey} onChange={e => setGoogleKey(e.target.value)} /></div><button type="submit" className="btn btn-primary">Simpan pengaturan</button>{configStatus && <p className="save-status">{configStatus}</p>}
          </form>}
          {activeTab === 'telegram' && <form onSubmit={handleSaveConfig}>
            <div className="panel-heading"><p className="eyebrow">Notifikasi</p><h2>Atur pengiriman ringkasan</h2><p>Hubungkan bot Telegram untuk menerima update laporan otomatis.</p></div>
            <div className="form-grid"><div className="input-group"><label className="input-label">Token bot Telegram</label><input className="input-field" placeholder="123456:ABC-DEF..." value={telegramToken} onChange={e => setTelegramToken(e.target.value)} /></div><div className="input-group"><label className="input-label">Chat ID</label><input className="input-field" placeholder="Ketik /start di bot Anda" value={telegramChatId} onChange={e => setTelegramChatId(e.target.value)} /></div></div><div className="input-group"><label className="input-label">OpenRouter API key</label><input className="input-field" placeholder="sk-or-v1-..." value={openRouterApiKey} onChange={e => setOpenRouterApiKey(e.target.value)} /></div><button type="submit" className="btn btn-primary">Simpan pengaturan</button>{configStatus && <p className="save-status">{configStatus}</p>}
          </form>}
        </main>
      </div>
    </div>
  );
}
