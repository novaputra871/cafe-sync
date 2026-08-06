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

    // Step A: AI call via Groq (fast & free)
    let aiFeedback = "AI tidak tersedia.";
    if (config.openRouterApiKey) {
      try {
        const prompt = `Anda adalah ahli konsultan bisnis F&B. Ringkasan laporan ${reportType.toUpperCase()} kafe:
- Omzet: Rp ${totalRevenue.toLocaleString('id-ID')}, Transaksi: ${totalTransactions}, Rata-rata/Nota: Rp ${Math.round(avgPerNota).toLocaleString('id-ID')}, Item: ${totalItemsSold}
- Kategori Terlaris: ${Object.entries(categoryRevenue).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A'}
- Menu Terlaku: ${Object.entries(menuCount).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A'}

Berikan insight bisnis tajam dan saran strategi aksi. 
Format jawaban Anda WAJIB persis seperti ini (tanpa awalan/akhiran lain):
Wawasan Bisnis: [1-2 kalimat insight]
Strategi Aksi: [1-2 kalimat strategi yang bisa langsung diterapkan]`;

        const modelsToTry = [
          "llama-3.3-70b-versatile",
          "llama-3.1-8b-instant",
          "gemma2-9b-it",
        ];

        for (const model of modelsToTry) {
          try {
            const response = await axios.post(
              "https://api.groq.com/openai/v1/chat/completions",
              { model, messages: [{ role: "user", content: prompt }], max_tokens: 300 },
              {
                headers: {
                  "Authorization": `Bearer ${config.openRouterApiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 8000 // 8s timeout to leave time for Google Sheets
              }
            );
            if (response.data?.choices?.[0]?.message?.content) {
              let text = response.data.choices[0].message.content.trim();
              // Pastikan ada 2 baris enter sebelum Strategi Aksi agar ada jarak
              text = text.replace(/(?:\r\n|\r|\n)*Strategi Aksi:/gi, '\n\nStrategi Aksi:');
              aiFeedback = text;
              console.log(`[AI] Berhasil dengan model: ${model}`);
              break;
            }
          } catch (err: any) {
            console.error(`[AI] Gagal model ${model}:`, err.response?.status || err.message);
          }
        }
        if (aiFeedback === "AI tidak tersedia.") {
            aiFeedback = "AI gagal memproses (timeout/error).";
        }
      } catch (err: any) {
        console.error('[AI] Error:', err.message);
        aiFeedback = "AI sedang tidak tersedia.";
      }
    }

    // Step B: Start dashboard generation (NOW with AI text)
    dashboardData.aiFeedback = aiFeedback;
    await setupAdvancedDashboardProgrammatically(
      sheets, config.spreadsheetId, config.sheetName, dashboardData, reportType
    ).catch(err => console.error('[Dashboard] Error:', err.message));

    const topMenus = Object.entries(menuCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topMenuText = topMenus.map((m, i) => `${i + 1}. ${m[0]} (${m[1]} porsi)`).join('\n');

    // Step C: Telegram notification (after AI so we have the insight text)
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Sync API Error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
