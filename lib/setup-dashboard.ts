export interface DashboardData {
  totalRevenue: number;
  totalTransactions: number;
  totalItemsSold: number;
  avgPerNota: number;
  menuCount: Record<string, number>;
  menuRevenue: Record<string, number>;
  hourCount: Record<string, number>;
  hourRevenue: Record<string, number>;
  categoryRevenue: Record<string, number>;
  categoryCount: Record<string, number>;
  customerRevenue: Record<string, number>;
  dayRevenue: Record<string, number>;
  aiFeedback: string;
}

export async function setupAdvancedDashboardProgrammatically(
  sheets: any,
  spreadsheetId: string,
  dataSheetName: string,
  data: DashboardData,
  reportType: string = 'harian'
) {
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const allSheets = res.data.sheets;

    // ---- Step 1: Create or recreate _ChartData helper sheet ----
    const helperName = '_ChartData';
    const existingHelper = allSheets.find((s: any) => s.properties.title === helperName);
    if (existingHelper) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: existingHelper.properties.sheetId } }] }
      });
    }

    const helperRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: helperName, hidden: true } } }] }
    });
    const helperSheetId = helperRes.data.replies[0].addSheet.properties.sheetId;

    // ---- Step 2: Prepare aggregated data ----
    const sortedMenus = Object.entries(data.menuCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const sortedMenuRevenue = Object.entries(data.menuRevenue).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const sortedHours = Object.keys(data.hourCount).map(Number).sort((a, b) => a - b)
      .map(h => [`${String(h).padStart(2, '0')}:00`, data.hourCount[h]]);
    const sortedHourRevenue = Object.keys(data.hourRevenue).map(Number).sort((a, b) => a - b)
      .map(h => [`${String(h).padStart(2, '0')}:00`, data.hourRevenue[h]]);
    const sortedCategories = Object.entries(data.categoryRevenue).sort((a, b) => b[1] - a[1]);
    const sortedCategoryCount = Object.entries(data.categoryCount).sort((a, b) => b[1] - a[1]);
    const sortedCustomers = Object.entries(data.customerRevenue).sort((a, b) => b[1] - a[1]).slice(0, 10);
    
    let sortedDays: any[][] = [];
    if (reportType === 'bulanan') {
      sortedDays = Object.entries(data.dayRevenue)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([k, v]) => [k, v]);
    } else if (reportType === 'tahunan') {
      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      sortedDays = monthOrder.filter(m => data.dayRevenue[m] !== undefined).map(m => [m, data.dayRevenue[m]]);
    } else {
      const dayOrder = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
      sortedDays = dayOrder.filter(d => data.dayRevenue[d] !== undefined).map(d => [d, data.dayRevenue[d]]);
    }

    // Write all aggregated data to _ChartData sheet. Kolom dipisahkan agar setiap
    // visual memakai agregasi yang tepat tanpa menduplikasi atau memalsukan data.
    const maxRows = Math.max(sortedMenus.length, sortedMenuRevenue.length, sortedHours.length, sortedHourRevenue.length, sortedCategories.length, sortedCategoryCount.length, sortedDays.length, sortedCustomers.length, 1);
    const chartDataRows: any[][] = [];
    
    // Header
    const timeColumnName = reportType === 'bulanan' ? 'Tanggal' : reportType === 'tahunan' ? 'Bulan' : 'Hari';
    chartDataRows.push(['Menu', 'Porsi', '', 'Menu', 'Omzet', '', 'Jam', 'Transaksi', '', 'Jam', 'Omzet', '', 'Kategori', 'Omzet', '', 'Kategori', 'Porsi', '', timeColumnName, 'Omzet', '', 'Pelanggan', 'Omzet']);
    
    for (let i = 0; i < maxRows; i++) {
      const row: any[] = [];
      row.push(sortedMenus[i]?.[0] || '', sortedMenus[i]?.[1] || '', '');
      row.push(sortedMenuRevenue[i]?.[0] || '', sortedMenuRevenue[i]?.[1] || '', '');
      row.push(sortedHours[i]?.[0] || '', sortedHours[i]?.[1] || '', '');
      row.push(sortedHourRevenue[i]?.[0] || '', sortedHourRevenue[i]?.[1] || '', '');
      row.push(sortedCategories[i]?.[0] || '', sortedCategories[i]?.[1] || '', '');
      row.push(sortedCategoryCount[i]?.[0] || '', sortedCategoryCount[i]?.[1] || '', '');
      row.push(sortedDays[i]?.[0] || '', sortedDays[i]?.[1] || '', '');
      row.push(sortedCustomers[i]?.[0] || '', sortedCustomers[i]?.[1] || '');
      chartDataRows.push(row);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${helperName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: chartDataRows }
    });
    console.log(`[Dashboard] Wrote ${chartDataRows.length} rows to ${helperName}`);

    // ---- Step 3: Create or recreate Dashboard sheet ----
    const dashboardName = 'Dashboard';
    const existingDash = allSheets.find((s: any) => s.properties.title === dashboardName);
    if (existingDash) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: existingDash.properties.sheetId } }] }
      });
    }

    const dashRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: dashboardName, gridProperties: { rowCount: 80, columnCount: 14, hideGridlines: true } } } }] }
    });
    const dashSheetId = dashRes.data.replies[0].addSheet.properties.sheetId;

    // ---- Step 4: Format Dashboard (dark theme + scorecards) ----
    const darkBg = { red: 0.118, green: 0.125, blue: 0.141 };
    const cardBg = { red: 0.157, green: 0.165, blue: 0.184 };
    const white = { red: 1, green: 1, blue: 1 };
    const blue = { red: 0.24, green: 0.62, blue: 0.95 };
    const green = { red: 0.18, green: 0.80, blue: 0.44 };
    const orange = { red: 1, green: 0.6, blue: 0.15 };
    const purple = { red: 0.69, green: 0.36, blue: 0.95 };

    const fmt: any[] = [];

    // Format semua kolom omzet sebagai rupiah agar sumbu dan tooltip mudah dibaca.
    const rupiahNumberFormat = '[$Rp-421]#,##0';
    [4, 10, 13, 19, 22].forEach(columnIndex => {
      fmt.push({
        repeatCell: {
          range: { sheetId: helperSheetId, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1, startRowIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: rupiahNumberFormat } } },
          fields: 'userEnteredFormat.numberFormat'
        }
      });
    });

    // Dark background
    fmt.push({
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 0, endRowIndex: 80, startColumnIndex: 0, endColumnIndex: 14 },
        cell: { userEnteredFormat: { backgroundColor: darkBg, textFormat: { foregroundColor: white, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    });

    // Column widths
    for (let i = 0; i < 12; i++) {
      fmt.push({ updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } });
    }

    // Row heights for scorecard area
    fmt.push({ updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });

    // Title
    fmt.push({
      mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' }
    });
    fmt.push({
      updateCells: {
        start: { sheetId: dashSheetId, rowIndex: 0, columnIndex: 0 },
        rows: [{ values: [{ userEnteredValue: { stringValue: `📊 DASHBOARD ANALITIK F&B - ${reportType.toUpperCase()}` }, userEnteredFormat: { textFormat: { bold: true, fontSize: 18, foregroundColor: white, fontFamily: 'Roboto' }, backgroundColor: darkBg, verticalAlignment: 'MIDDLE' } }] }],
        fields: 'userEnteredValue,userEnteredFormat'
      }
    });

    // Scorecards (row 2-3)
    const cards = [
      { label: '💰 Total Omzet', value: `Rp ${data.totalRevenue.toLocaleString('id-ID')}`, color: blue },
      { label: '🧾 Transaksi', value: `${data.totalTransactions.toLocaleString('id-ID')}`, color: green },
      { label: '📈 Rata-rata/Nota', value: `Rp ${Math.round(data.avgPerNota).toLocaleString('id-ID')}`, color: orange },
      { label: '🍽️ Porsi Terjual', value: `${data.totalItemsSold.toLocaleString('id-ID')}`, color: purple },
    ];

    for (let i = 0; i < 4; i++) {
      const col = i * 3;
      fmt.push({ mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: col, endColumnIndex: col + 2 }, mergeType: 'MERGE_ALL' } });
      fmt.push({ mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: col, endColumnIndex: col + 2 }, mergeType: 'MERGE_ALL' } });
      fmt.push({
        updateCells: {
          start: { sheetId: dashSheetId, rowIndex: 2, columnIndex: col },
          rows: [{ values: [{ userEnteredValue: { stringValue: cards[i].label }, userEnteredFormat: { backgroundColor: cardBg, textFormat: { fontSize: 10, foregroundColor: { red: 0.7, green: 0.7, blue: 0.7 }, fontFamily: 'Roboto' }, horizontalAlignment: 'CENTER', verticalAlignment: 'BOTTOM', borders: { top: { style: 'SOLID', width: 2, colorStyle: { rgbColor: cards[i].color } } } } }] }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });
      fmt.push({
        updateCells: {
          start: { sheetId: dashSheetId, rowIndex: 3, columnIndex: col },
          rows: [{ values: [{ userEnteredValue: { stringValue: cards[i].value }, userEnteredFormat: { backgroundColor: cardBg, textFormat: { bold: true, fontSize: 18, foregroundColor: cards[i].color, fontFamily: 'Roboto' }, horizontalAlignment: 'CENTER', verticalAlignment: 'TOP' } }] }],
          fields: 'userEnteredValue,userEnteredFormat'
        }
      });
    }

    // AI Insight (Dynamic Height on Row 5)
    const aiText = `💡 AI Insight:\n\n${data.aiFeedback}`;
    let totalLines = 0;
    for (const line of aiText.split('\n')) {
      totalLines += Math.max(1, Math.ceil(line.length / 140)); // Approx 140 chars per line for columns A-M
    }
    const aiBoxHeight = Math.max(100, (totalLines * 18) + 30); // 18px per line + 30px padding

    fmt.push({ mergeCells: { range: { sheetId: dashSheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } });
    fmt.push({ updateDimensionProperties: { range: { sheetId: dashSheetId, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: aiBoxHeight }, fields: 'pixelSize' } });
    fmt.push({
      updateCells: {
        start: { sheetId: dashSheetId, rowIndex: 5, columnIndex: 0 },
        rows: [{ values: [{ userEnteredValue: { stringValue: aiText }, userEnteredFormat: { backgroundColor: { red: 0.13, green: 0.17, blue: 0.22 }, textFormat: { fontSize: 10, italic: true, foregroundColor: { red: 0.75, green: 0.85, blue: 1 }, fontFamily: 'Roboto' }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP', borders: { left: { style: 'SOLID', width: 3, colorStyle: { rgbColor: blue } } } } }] }],
        fields: 'userEnteredValue,userEnteredFormat'
      }
    });

    // ---- Step 5: Charts (reference _ChartData sheet) ----
    const chartBg = white;
    const chartTitleText = { foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 }, fontSize: 12, bold: true };

    // Column Chart: Tren Penjualan
    const trenTitle = reportType === 'harian' ? '📅 Penjualan Harian' : reportType === 'bulanan' ? '📅 Penjualan Per Tanggal' : '📅 Penjualan Per Bulan';
    if (sortedDays.length > 0) {
      fmt.push({
        addChart: {
          chart: {
            spec: {
              title: trenTitle,
              titleTextFormat: chartTitleText,
              basicChart: {
                chartType: 'COLUMN',
                legendPosition: 'NO_LEGEND',
                domains: [{ domain: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedDays.length + 1, startColumnIndex: 18, endColumnIndex: 19 }] } } }],
                series: [{ series: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedDays.length + 1, startColumnIndex: 19, endColumnIndex: 20 }] } }, colorStyle: { rgbColor: blue } }],
                headerCount: 1
              },
              backgroundColorStyle: { rgbColor: chartBg }
            },
            position: { overlayPosition: { anchorCell: { sheetId: dashSheetId, rowIndex: 6, columnIndex: 0 }, widthPixels: 580, heightPixels: 300 } }
          }
        }
      });
    }

    // Line Chart: Jam Ramai (D:E = col 3-4)
    if (sortedHours.length > 0) {
      fmt.push({
        addChart: {
          chart: {
            spec: {
              title: '⏰ Jam Ramai',
              titleTextFormat: chartTitleText,
              basicChart: {
                chartType: 'LINE',
                legendPosition: 'NO_LEGEND',
                domains: [{ domain: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedHours.length + 1, startColumnIndex: 6, endColumnIndex: 7 }] } } }],
                series: [{ series: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedHours.length + 1, startColumnIndex: 7, endColumnIndex: 8 }] } }, colorStyle: { rgbColor: green } }],
                headerCount: 1
              },
              backgroundColorStyle: { rgbColor: chartBg }
            },
            position: { overlayPosition: { anchorCell: { sheetId: dashSheetId, rowIndex: 6, columnIndex: 6 }, widthPixels: 580, heightPixels: 300 } }
          }
        }
      });
    }

    // Bar Chart: Menu Terlaris (A:B = col 0-1)
    if (sortedMenus.length > 0) {
      fmt.push({
        addChart: {
          chart: {
            spec: {
              title: '🔥 Top Menu Terlaris',
              titleTextFormat: chartTitleText,
              basicChart: {
                chartType: 'BAR',
                legendPosition: 'NO_LEGEND',
                domains: [{ domain: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedMenus.length + 1, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
                series: [{ series: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedMenus.length + 1, startColumnIndex: 1, endColumnIndex: 2 }] } }, colorStyle: { rgbColor: orange } }],
                headerCount: 1
              },
              backgroundColorStyle: { rgbColor: chartBg }
            },
            position: { overlayPosition: { anchorCell: { sheetId: dashSheetId, rowIndex: 22, columnIndex: 0 }, widthPixels: 580, heightPixels: 400 } }
          }
        }
      });
    }

    // Donut Chart: Kategori (G:H = col 6-7)
    if (sortedCategories.length > 0) {
      fmt.push({
        addChart: {
          chart: {
            spec: {
              title: '🎯 Sumber Pendapatan',
              titleTextFormat: chartTitleText,
              pieChart: {
                legendPosition: 'LABELED_LEGEND',
                domain: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedCategories.length + 1, startColumnIndex: 12, endColumnIndex: 13 }] } },
                series: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: sortedCategories.length + 1, startColumnIndex: 13, endColumnIndex: 14 }] } },
                pieHole: 0.45
              },
              backgroundColorStyle: { rgbColor: chartBg }
            },
            position: { overlayPosition: { anchorCell: { sheetId: dashSheetId, rowIndex: 22, columnIndex: 6 }, widthPixels: 580, heightPixels: 400 } }
          }
        }
      });
    }

    // Visual tambahan untuk analisis yang lebih lengkap seperti dashboard BI:
    // omzet per menu, volume per kategori, omzet per jam, dan pelanggan teratas.
    const addBasicChart = (title: string, chartType: string, domainColumn: number, metricColumn: number, rowCount: number, color: any, rowIndex: number, columnIndex: number, isCurrency = false) => {
      if (rowCount === 0) return;
      const basicChart: any = {
        chartType,
        legendPosition: 'NO_LEGEND',
        domains: [{ domain: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: rowCount + 1, startColumnIndex: domainColumn, endColumnIndex: domainColumn + 1 }] } } }],
        series: [{ series: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: rowCount + 1, startColumnIndex: metricColumn, endColumnIndex: metricColumn + 1 }] } }, colorStyle: { rgbColor: color } }],
        headerCount: 1
      };
      fmt.push({ addChart: { chart: { spec: { title, titleTextFormat: chartTitleText, basicChart, backgroundColorStyle: { rgbColor: chartBg } }, position: { overlayPosition: { anchorCell: { sheetId: dashSheetId, rowIndex, columnIndex }, widthPixels: 580, heightPixels: 290 } } } } });
    };
    const addDonutChart = (title: string, domainColumn: number, metricColumn: number, rowCount: number, rowIndex: number, columnIndex: number) => {
      if (rowCount === 0) return;
      fmt.push({ addChart: { chart: { spec: {
        title,
        titleTextFormat: chartTitleText,
        pieChart: {
          legendPosition: 'LABELED_LEGEND',
          domain: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: rowCount + 1, startColumnIndex: domainColumn, endColumnIndex: domainColumn + 1 }] } },
          series: { sourceRange: { sources: [{ sheetId: helperSheetId, startRowIndex: 0, endRowIndex: rowCount + 1, startColumnIndex: metricColumn, endColumnIndex: metricColumn + 1 }] } },
          pieHole: 0.45
        },
        backgroundColorStyle: { rgbColor: chartBg }
      }, position: { overlayPosition: { anchorCell: { sheetId: dashSheetId, rowIndex, columnIndex }, widthPixels: 580, heightPixels: 290 } } } } });
    };

    addBasicChart('Omzet per Menu', 'BAR', 3, 4, sortedMenuRevenue.length, purple, 46, 0, true);
    addDonutChart('Porsi Terjual per Kategori', 15, 16, sortedCategoryCount.length, 46, 6);
    addBasicChart('Omzet per Jam', 'LINE', 9, 10, sortedHourRevenue.length, blue, 62, 0, true);
    addBasicChart('Pelanggan dengan Omzet Tertinggi', 'BAR', 21, 22, sortedCustomers.length, green, 62, 6, true);

    // Execute all
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: fmt }
    });

    console.log('[Dashboard] Advanced Dashboard berhasil dibuat!');
    return dashSheetId;
  } catch (error: any) {
    console.error('[Dashboard] Gagal membuat dashboard:', error.message);
    throw error;
  }
}
