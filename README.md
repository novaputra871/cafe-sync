# Penjelasan Alur Data untuk Klien UMKM

Sistem ini dirancang untuk bekerja secara otomatis di belakang layar (middleware) tanpa perlu menyalakan komputer server 24 jam.

## 1. Input (Kasir ke Google Sheets)
Setiap kali ada transaksi di mesin kasir (POS), mesin tersebut akan mengirimkan sinyal data (disebut Webhook) ke sistem kita (`/api/webhook`). Sistem kita kemudian akan mengambil data tersebut (nama menu, harga, jumlah) dan langsung menulisnya ke dalam Google Sheets secara rapi dari atas ke bawah.
**Manfaat:** Anda memiliki database harian yang rapi di Google Sheets, yang sangat bersahabat untuk dibaca atau dihubungkan ke Looker Studio.

## 2. Pemrosesan Otomatis (Cron Job)
Setiap hari pada jam 22:00 WIB, sistem kita memiliki "alarm otomatis" (disebut Cron Job via Vercel). Alarm ini akan memicu sistem (`/api/cron`) untuk membaca kembali Google Sheets, memilah data khusus hari ini saja, dan menghitung:
- Total Omzet (uang masuk).
- Total Transaksi (berapa kali kasir melayani pesanan).
- 3 Menu Paling Laris (berdasarkan jumlah yang terjual).

## 3. Output (Notifikasi WhatsApp)
Setelah sistem selesai menghitung rekapan, ia akan langsung mengirimkan laporan tersebut ke nomor WhatsApp pemilik kafe menggunakan sistem resmi dari WhatsApp (Meta API). Pesan sudah diformat dengan emoji agar mudah dan enak dibaca.

---

### Cara Mengatur Environment Variables (API Keys)

Karena kita menggunakan Vercel (platform Serverless gratis), Anda perlu memasukkan kode rahasia ini di menu **Settings > Environment Variables** pada dashboard Vercel Anda, bukan di dalam kode secara langsung (agar aman).

1. **Google Sheets Integration:**
   - Buka Google Cloud Console, buat Service Account, dan unduh `credentials.json`.
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Isi dengan email dari file JSON tersebut (berakhir dengan `iam.gserviceaccount.com`).
   - `GOOGLE_PRIVATE_KEY`: Isi dengan Private Key dari JSON tersebut. (Penting: Ganti tanda `\n` dengan baris baru atau ikuti format Vercel).
   - `SPREADSHEET_ID`: Ambil ID dari URL Google Sheets Anda (antara `/d/` dan `/edit`).
   - `SHEET_NAME`: Nama sheet Anda (misal `Sheet1`).

2. **WhatsApp Meta API Integration:**
   - Daftar di portal Meta for Developers, buat aplikasi jenis Business, lalu tambahkan produk WhatsApp.
   - `WA_PHONE_NUMBER_ID`: Dapatkan dari dashboard Meta API.
   - `WA_ACCESS_TOKEN`: Token akses permanen atau sementara yang didapatkan dari Meta API.
   - `WA_RECIPIENT_PHONE`: Nomor HP pemilik kafe, gunakan format internasional tanpa '+' (misal: `62812...`).
