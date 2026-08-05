import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { google } from 'googleapis';
import axios from 'axios';
import { setupAdvancedDashboardProgrammatically, DashboardData } from '@/lib/setup-dashboard';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';

// Dashboard generation is now handled in lib/setup-dashboard.ts

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const config = await prisma.cafeConfig.findUnique({
      where: { userId }
    });

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('csvFile') as Blob | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const reportType = formData.get('reportType') as string || 'harian';

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileContent = buffer.toString('utf-8');

    // 1. Save Backup Locally
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const files = fs.readdirSync(uploadsDir);
    let nextNum = 1;
    files.forEach(f => {
      const match = f.match(/Laporan Harian (\d+)\.csv/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= nextNum) nextNum = num + 1;
      }
    });

    const fileName = `Laporan Harian ${String(nextNum).padStart(2, '0')}.csv`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // Detect delimiter
    const delimiter = fileContent.includes(';') && (fileContent.split(';').length > fileContent.split(',').length) ? ';' : ',';

    // 2. Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      delimiter: delimiter
    });

    if (records.length === 0) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    let totalRevenue = 0;
    let totalItemsSold = 0;
    const totalTransactions = records.length;
    const menuCount: Record<string, number> = {};
    const menuRevenue: Record<string, number> = {};
    const hourCount: Record<string, number> = {};
    const hourRevenue: Record<string, number> = {};
    const categoryRevenue: Record<string, number> = {};
    const categoryCount: Record<string, number> = {};
    const customerRevenue: Record<string, number> = {};
    const dayRevenue: Record<string, number> = {};

    // Prepare rows for Google Sheets and Calculate Stats
    const sheetRows = records.map((r: any) => {
      const keys = Object.keys(r);
      const getVal = (possibleNames: string[]) => {
        const foundKey = keys.find(k => possibleNames.some(name => k.toLowerCase().includes(name.toLowerCase())));
        return foundKey ? r[foundKey] : undefined;
      };

      const revStr = getVal(['total pendapatan', 'omzet', 'total', 'revenue']) || '0';
      const qtyStr = getVal(['jumlah terjual', 'qty', 'jumlah', 'porsi']) || '0';
      const menu = getVal(['nama menu', 'menu', 'produk', 'item']);
      const jamStr = getVal(['jam', 'time', 'waktu']);
      const kategori = getVal(['kategori', 'category', 'jenis']);
      const pelanggan = getVal(['nama pelanggan', 'pelanggan', 'customer']);
      const hari = getVal(['hari', 'day']);
      const tanggalStr = getVal(['tanggal', 'date', 'tgl']);
      
      const rev = parseFloat(String(revStr).replace(/[^0-9.-]+/g,""));
      const qty = parseInt(String(qtyStr).replace(/[^0-9.-]+/g,""), 10);
      
      if (!isNaN(rev)) totalRevenue += rev;
      if (!isNaN(qty)) {
        totalItemsSold += qty;
        if (menu && String(menu).trim() !== '' && String(menu).trim() !== '-') {
          menuCount[String(menu)] = (menuCount[String(menu)] || 0) + qty;
        }
      }

      if (menu && String(menu).trim() !== '' && String(menu).trim() !== '-' && !isNaN(rev)) {
        const menuName = String(menu).trim();
        menuRevenue[menuName] = (menuRevenue[menuName] || 0) + rev;
      }

      if (jamStr) {
        const match = String(jamStr).match(/^(\d{1,2}):/);
        if (match) {
          const hour = parseInt(match[1], 10);
          hourCount[hour] = (hourCount[hour] || 0) + 1;
          if (!isNaN(rev)) hourRevenue[hour] = (hourRevenue[hour] || 0) + rev;
        }
      }

      // Track category revenue
      if (kategori && String(kategori).trim() !== '' && String(kategori).trim() !== '-') {
        const catName = String(kategori).trim();
        if (!isNaN(rev)) categoryRevenue[catName] = (categoryRevenue[catName] || 0) + rev;
        if (!isNaN(qty)) categoryCount[catName] = (categoryCount[catName] || 0) + qty;
      }

      if (pelanggan && String(pelanggan).trim() !== '' && String(pelanggan).trim() !== '-' && !isNaN(rev)) {
        const customerName = String(pelanggan).trim();
        customerRevenue[customerName] = (customerRevenue[customerName] || 0) + rev;
      }

      // Track time period revenue based on reportType
      if (!isNaN(rev)) {
        if (reportType === 'bulanan' && tanggalStr) {
          // Parse as date and extract day (1-31)
          const dateObj = new Date(String(tanggalStr));
          if (!isNaN(dateObj.getTime())) {
            const dateNum = dateObj.getDate().toString();
            dayRevenue[dateNum] = (dayRevenue[dateNum] || 0) + rev;
          } else {
            const dStr = String(tanggalStr).trim();
            dayRevenue[dStr] = (dayRevenue[dStr] || 0) + rev;
          }
        } else if (reportType === 'tahunan' && tanggalStr) {
          // Parse as date and extract month name
          const dateObj = new Date(String(tanggalStr));
          if (!isNaN(dateObj.getTime())) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const monthName = months[dateObj.getMonth()];
            dayRevenue[monthName] = (dayRevenue[monthName] || 0) + rev;
          }
        } else if (reportType === 'harian') {
          // Track day of week revenue
          if (hari && String(hari).trim() !== '' && String(hari).trim() !== '-') {
            const dayName = String(hari).trim();
            dayRevenue[dayName] = (dayRevenue[dayName] || 0) + rev;
          }
        }
      }

      return keys.map(k => r[k]);
    });

    // Calculate Peak Hours
    let peakHourStr = "Data tidak tersedia";
    let peakHourCount = 0;
    const hours = Object.keys(hourCount).map(Number).sort((a,b) => hourCount[b] - hourCount[a]);
    if (hours.length > 0) {
      const peakHour = hours[0];
      peakHourCount = hourCount[peakHour];
      const nextHour = (peakHour + 1).toString().padStart(2, '0');
      const startHour = peakHour.toString().padStart(2, '0');
      peakHourStr = `${startHour}:00 - ${nextHour}:00`;
    }

    // Calculate Avg per Nota
    const avgPerNota = totalTransactions > 0 ? (totalRevenue / totalTransactions) : 0;

    // Calculate Top 3 Menu
    const topMenus = Object.entries(menuCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const topMenuText = topMenus.map((m, i) => `${i + 1}. ${m[0]} (${m[1]} porsi)`).join('\n');
    const topMenuForPrompt = topMenus.map((m) => `${m[0]} (${m[1]} porsi)`).join(', ');

    // 3. Append to Google Sheets
    if (config.googleServiceAccountEmail && config.googlePrivateKey && config.spreadsheetId && config.sheetName) {
      try {
        const auth = new google.auth.JWT(
          config.googleServiceAccountEmail,
          undefined,
          config.googlePrivateKey.replace(/\\n/g, '\n'),
          ['https://www.googleapis.com/auth/spreadsheets']
        );
        const sheets = google.sheets({ version: 'v4', auth });
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.spreadsheetId,
          range: config.sheetName,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: sheetRows }
        });
        
        // Asynchronously setup dashboard charts (does not block)
        const dashboardData: DashboardData = {
          totalRevenue, totalTransactions, totalItemsSold, avgPerNota,
          menuCount, menuRevenue, hourCount, hourRevenue, categoryRevenue, categoryCount, customerRevenue, dayRevenue,
          aiFeedback: '' // Will be updated below after AI call
        };
        // We need to wait for AI first, so we'll call dashboard setup after AI
        // Store sheets instance for later use
        (global as any).__sheetsInstance = sheets;
        (global as any).__dashboardData = dashboardData;
      } catch (err: any) {
        console.error('Google Sheets error:', err.message);
      }
    }

    // 4. OpenRouter AI Integration
    let aiFeedback = "Belum ada API Key OpenRouter yang dikonfigurasi di Web Dashboard.";
    const prompt = `Anda adalah ahli konsultan bisnis F&B. Saya baru saja mengunggah laporan penjualan (${reportType.toUpperCase()}) kafe saya.
Berikut adalah ringkasannya:
- Total Omzet: Rp ${totalRevenue.toLocaleString('id-ID')}
- Total Transaksi: ${totalTransactions}
- Rata-rata per Nota: Rp ${Math.round(avgPerNota).toLocaleString('id-ID')}
- Item Terjual: ${totalItemsSold}
- Kategori Terlaris: ${Object.entries(categoryRevenue).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A'}
- Menu Paling Laku: ${Object.entries(menuCount).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A'}
${reportType === 'harian' ? `- Waktu Tersibuk: Jam ${peakHourStr} (${peakHourCount} transaksi)` : ''}

Berdasarkan data ini, berikan 1 paragraf (maksimal 3 kalimat) wawasan (insight) bisnis yang tajam dan satu saran strategi aksi (actionable strategy) untuk meningkatkan profit. Gunakan bahasa Indonesia yang profesional dan memotivasi.`;

    if (config.openRouterApiKey) {
      // Daftar model untuk dicoba berurutan (fallback)
      const modelsToTry = [
        "openrouter/auto",                                // Smart router - picks the best available
        "nvidia/llama-3.1-nemotron-ultra-253b:free",      // NVIDIA Nemotron free
        "inclusionai/ling-3.0-flash:free",                // InclusionAI Ling free
      ];

      for (const modelId of modelsToTry) {
        try {
          console.log(`[AI] Mencoba model: ${modelId}`);
          const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              model: modelId,
              messages: [
                { role: "user", content: prompt }
              ]
            },
            {
              headers: {
                "Authorization": `Bearer ${config.openRouterApiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Cafe Middleware SaaS"
              },
              timeout: 30000
            }
          );

          if (response.data?.choices?.[0]?.message?.content) {
            aiFeedback = response.data.choices[0].message.content.trim();
            console.log(`[AI] Berhasil menggunakan model: ${modelId}`);
            break; // Berhasil, keluar dari loop
          }
        } catch (err: any) {
          const errDetail = err.response?.data?.error?.message || err.response?.data?.error || err.message;
          console.error(`[AI] Gagal model ${modelId}:`, errDetail);
          aiFeedback = `Gagal memproses AI. Model terakhir dicoba: ${modelId}. Error: ${String(errDetail).substring(0, 100)}`;
          // Lanjut ke model berikutnya
        }
      }
    }

    // 5. Send Telegram Notification
    if (config.telegramBotToken && config.telegramChatId) {
      try {
        const spreadsheetLink = config.spreadsheetId 
          ? `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit` 
          : "https://docs.google.com/spreadsheets/";
        
        const reportTitle = reportType.charAt(0).toUpperCase() + reportType.slice(1);
        const message = `📊 *Rekap Laporan ${reportTitle} Selesai*\n\n` +
                        `📁 File: ${fileName}\n` +
                        `💰 Omzet: Rp ${totalRevenue.toLocaleString('id-ID')}\n` +
                        `🧾 Transaksi: ${totalTransactions} transaksi\n` +
                        `🍽️ Item Terjual: ${totalItemsSold} porsi\n` +
                        `📈 Rata-rata/Nota: Rp ${Math.round(avgPerNota).toLocaleString('id-ID')}\n\n` +
                        `🔥 *Top 3 Menu*\n${topMenuText}\n\n` +
                        (reportType === 'harian' ? `⏰ *Jam Tersibuk*\n${peakHourStr} (${peakHourCount} Transaksi)\n\n` : '') +
                        `💡 *Insight AI:*\n${aiFeedback}\n\n` +
                        `🔗 *Dashboard:* [Buka Google Sheets](${spreadsheetLink})`;
        
        await axios.post(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
          chat_id: config.telegramChatId,
          text: message,
          parse_mode: 'Markdown'
        });
      } catch (err: any) {
        console.error('Telegram error:', err.message);
      }
    }

    // 6. Generate Dashboard in Google Sheets (after AI so we include the insight)
    if (config.googleServiceAccountEmail && config.googlePrivateKey && config.spreadsheetId && config.sheetName) {
      const sheetsInstance = (global as any).__sheetsInstance;
      const dashboardData = (global as any).__dashboardData as DashboardData | undefined;
      if (sheetsInstance && dashboardData) {
        dashboardData.aiFeedback = aiFeedback;
        setupAdvancedDashboardProgrammatically(sheetsInstance, config.spreadsheetId, config.sheetName, dashboardData, reportType).catch(console.error);
        // Clean up
        delete (global as any).__sheetsInstance;
        delete (global as any).__dashboardData;
      }
    }

    return NextResponse.json({ success: true, fileName });
  } catch (error: any) {
    console.error('Upload API Error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
