import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { google } from 'googleapis';
import prisma from '@/lib/prisma';
import axios from 'axios';
import { setupAdvancedDashboardProgrammatically, DashboardData } from '@/lib/setup-dashboard';

export async function POST(req: Request) {
  try {
    const { reportType } = await req.json();

    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const config = await prisma.cafeConfig.findUnique({
      where: { userId }
    });
    
    if (!config || !config.googleServiceAccountEmail || !config.googlePrivateKey || !config.spreadsheetId || !config.sheetName) {
      return NextResponse.json({ error: 'Konfigurasi Google Sheets belum lengkap' }, { status: 400 });
    }

    // 2. Connect to Google Sheets & Read Data
    const auth = new google.auth.JWT(
      config.googleServiceAccountEmail,
      undefined,
      config.googlePrivateKey.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: config.sheetName,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return NextResponse.json({ error: 'Data di Spreadsheet kosong atau tidak memiliki header' }, { status: 400 });
    }

    const headers = rows[0].map((h: any) => String(h).toLowerCase().trim());
    const dataRows = rows.slice(1);

    // 3. Process and Aggregate Data
    let totalRevenue = 0;
    let totalItemsSold = 0;
    const totalTransactions = dataRows.length;
    const menuCount: Record<string, number> = {};
    const menuRevenue: Record<string, number> = {};
    const hourCount: Record<string, number> = {};
    const hourRevenue: Record<string, number> = {};
    const categoryRevenue: Record<string, number> = {};
    const categoryCount: Record<string, number> = {};
    const customerRevenue: Record<string, number> = {};
    const dayRevenue: Record<string, number> = {};

    dataRows.forEach((row: any[]) => {
      const getVal = (possibleNames: string[]) => {
        const index = headers.findIndex((h: string) => possibleNames.some(name => h.includes(name.toLowerCase())));
        return index !== -1 ? row[index] : undefined;
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
          const dateObj = new Date(String(tanggalStr));
          if (!isNaN(dateObj.getTime())) {
            const dateNum = dateObj.getDate().toString();
            dayRevenue[dateNum] = (dayRevenue[dateNum] || 0) + rev;
          } else {
            const dStr = String(tanggalStr).trim();
            dayRevenue[dStr] = (dayRevenue[dStr] || 0) + rev;
          }
        } else if (reportType === 'tahunan' && tanggalStr) {
          const dateObj = new Date(String(tanggalStr));
          if (!isNaN(dateObj.getTime())) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const monthName = months[dateObj.getMonth()];
            dayRevenue[monthName] = (dayRevenue[monthName] || 0) + rev;
          }
        } else if (reportType === 'harian') {
          if (hari && String(hari).trim() !== '' && String(hari).trim() !== '-') {
            const dayName = String(hari).trim();
            dayRevenue[dayName] = (dayRevenue[dayName] || 0) + rev;
          }
        }
      }
    });

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

    const avgPerNota = totalTransactions > 0 ? (totalRevenue / totalTransactions) : 0;

    const dashboardData: DashboardData = {
      totalRevenue, totalTransactions, totalItemsSold, avgPerNota,
      menuCount, hourCount, categoryRevenue, dayRevenue, menuRevenue, hourRevenue, categoryCount, customerRevenue,
      aiFeedback: ''
    };

    // 4. OpenRouter AI Integration
    let aiFeedback = "Belum ada API Key OpenRouter yang dikonfigurasi di Web Dashboard.";
    const prompt = `Anda adalah ahli konsultan bisnis F&B. Saya baru saja mengambil laporan penjualan (${reportType.toUpperCase()}) kafe saya dari database Google Sheets.
Berikut adalah ringkasannya:
- Total Omzet: Rp ${totalRevenue.toLocaleString('id-ID')}
- Total Transaksi: ${totalTransactions}
- Rata-rata per Nota: Rp ${Math.round(avgPerNota).toLocaleString('id-ID')}
- Item Terjual: ${totalItemsSold}
- Kategori Terlaris: ${Object.entries(categoryRevenue).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A'}
- Menu Paling Laku: ${Object.entries(menuCount).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A'}
${reportType === 'harian' ? `- Waktu Tersibuk: Jam ${peakHourStr} (${peakHourCount} transaksi)` : ''}

Berdasarkan data historis ini, berikan 1 paragraf (maksimal 3 kalimat) wawasan (insight) bisnis yang tajam dan satu saran strategi aksi (actionable strategy) untuk meningkatkan profit. Gunakan bahasa Indonesia yang profesional dan memotivasi.`;

    if (config.openRouterApiKey) {
      const modelsToTry = [
        "openrouter/auto",
        "nvidia/llama-3.1-nemotron-ultra-253b:free",
        "inclusionai/ling-3.0-flash:free",
      ];

      for (const modelId of modelsToTry) {
        try {
          const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              model: modelId,
              messages: [{ role: "user", content: prompt }]
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
            break;
          }
        } catch (err: any) {
          aiFeedback = `Gagal memproses AI. Error.`;
        }
      }
    }

    const topMenus = Object.entries(menuCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topMenuText = topMenus.map((m, i) => `${i + 1}. ${m[0]} (${m[1]} porsi)`).join('\n');

    // 5. Send Telegram Notification
    if (config.telegramBotToken && config.telegramChatId) {
      try {
        const spreadsheetLink = config.spreadsheetId 
          ? `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit` 
          : "https://docs.google.com/spreadsheets/";
        
        const reportTitle = reportType.charAt(0).toUpperCase() + reportType.slice(1);
        const message = `🔄 *Sinkronisasi Data ${reportTitle} Selesai*\n\n` +
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

    // 6. Generate Dashboard in Google Sheets
    dashboardData.aiFeedback = aiFeedback;
    await setupAdvancedDashboardProgrammatically(sheets, config.spreadsheetId, config.sheetName, dashboardData, reportType);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Sync API Error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
