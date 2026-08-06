import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { google } from 'googleapis';
import prisma from '@/lib/prisma';
import axios from 'axios';
import { setupAdvancedDashboardProgrammatically, DashboardData } from '@/lib/setup-dashboard';
import { detectColumns, aggregateData } from '@/lib/smart-parser';

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

    // 3. Smart column detection + aggregation
    const colMap = detectColumns(headers, dataRows);
    console.log('[Sync] Detected columns:', JSON.stringify(colMap));
    
    const agg = aggregateData(dataRows, colMap, reportType);
    console.log('[Sync] Aggregated:', {
      totalRevenue: agg.totalRevenue,
      totalTransactions: agg.totalTransactions,
      dayRevenueKeys: Object.keys(agg.dayRevenue).length,
      hourCountKeys: Object.keys(agg.hourCount).length,
    });

    const {
      totalRevenue, totalTransactions, totalItemsSold, avgPerNota,
      menuCount, menuRevenue, hourCount, hourRevenue,
      categoryRevenue, categoryCount, customerRevenue, dayRevenue,
      peakHourStr, peakHourCount,
    } = agg;

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
              timeout: 15000
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
    setupAdvancedDashboardProgrammatically(sheets, config.spreadsheetId, config.sheetName, dashboardData, reportType).catch(console.error);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Sync API Error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
