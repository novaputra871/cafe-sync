import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { google } from 'googleapis';
import axios from 'axios';
import { setupAdvancedDashboardProgrammatically, DashboardData } from '@/lib/setup-dashboard';
import { parse } from 'csv-parse/sync';
import { detectColumns, aggregateData } from '@/lib/smart-parser';

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

    // In serverless environment (Netlify/Vercel), we cannot save to local filesystem
    // We will just process it in memory.
    const fileName = `Laporan_${reportType}_${new Date().getTime()}.csv`;

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

    // Convert CSV records (objects) to array format for smart parser
    const csvHeaders = Object.keys(records[0]);
    const csvRows = records.map((r: any) => csvHeaders.map(k => r[k]));

    // 3. Smart column detection + aggregation
    const colMap = detectColumns(csvHeaders.map(h => h.toLowerCase().trim()), csvRows);
    console.log('[Upload] Detected columns:', JSON.stringify(colMap));

    const agg = aggregateData(csvRows, colMap, reportType);
    console.log('[Upload] Aggregated:', {
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

    // Prepare rows for Google Sheets
    const sheetRows = records.map((r: any) => {
      const keys = Object.keys(r);
      return keys.map(k => r[k]);
    });

    // Calculate Top 3 Menu
    const topMenus = Object.entries(menuCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const topMenuText = topMenus.map((m, i) => `${i + 1}. ${m[0]} (${m[1]} porsi)`).join('\n');

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
        
        // Store sheets instance for dashboard generation after AI
        (global as any).__sheetsInstance = sheets;
        (global as any).__dashboardData = {
          totalRevenue, totalTransactions, totalItemsSold, avgPerNota,
          menuCount, menuRevenue, hourCount, hourRevenue, categoryRevenue, categoryCount, customerRevenue, dayRevenue,
          aiFeedback: ''
        } as DashboardData;
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

Berikan insight bisnis tajam dan saran strategi aksi. 
Format jawaban Anda WAJIB persis seperti ini (tanpa awalan/akhiran lain):
Wawasan Bisnis: [1-2 kalimat insight berdasarkan data]
Strategi Aksi: [1-2 kalimat strategi yang bisa langsung diterapkan]`;

    if (config.openRouterApiKey) {
      const modelsToTry = [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "gemma2-9b-it",
      ];

      for (const model of modelsToTry) {
        try {
          console.log(`[AI] Mencoba model: ${model}`);
          const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            { model, messages: [{ role: "user", content: prompt }], max_tokens: 300 },
            {
              headers: {
                "Authorization": `Bearer ${config.openRouterApiKey}`,
                "Content-Type": "application/json",
              },
              timeout: 10000
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
          aiFeedback = "AI sedang tidak tersedia.";
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
        await setupAdvancedDashboardProgrammatically(sheetsInstance, config.spreadsheetId, config.sheetName, dashboardData, reportType).catch(console.error);
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
