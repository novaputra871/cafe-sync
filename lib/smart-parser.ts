/**
 * Smart Data Parser for CSV/Google Sheets data
 * Automatically detects columns and extracts date/time information
 * regardless of column naming conventions.
 */

// ─── Flexible Column Matcher ─────────────────────────────────────────────────
// Instead of relying only on column names, this also scans actual cell values
// to auto-detect date and time columns.

const DATE_PATTERNS = [
  /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/,           // DD/MM/YYYY or DD-MM-YYYY
  /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/,              // YYYY-MM-DD
  /^\d{1,2}\s+(jan|feb|mar|apr|mei|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)/i, // 5 Jan 2026
  /^(jan|feb|mar|apr|mei|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)\s+\d/i,     // Jan 5, 2026
  /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\s+\d{1,2}:/,  // DD/MM/YYYY HH:MM (datetime)
  /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}T/,               // ISO format 2026-08-05T...
];

const TIME_PATTERNS = [
  /^\d{1,2}:\d{2}/,           // HH:MM or H:MM
  /^\d{1,2}\.\d{2}/,          // HH.MM (Indonesian format)
  /^\d{1,2}:\d{2}:\d{2}/,     // HH:MM:SS
];

const DAY_NAMES_ID = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
const DAY_NAMES_EN = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export interface SmartColumnMap {
  revenueIdx: number;
  qtyIdx: number;
  menuIdx: number;
  timeIdx: number;
  categoryIdx: number;
  customerIdx: number;
  dayNameIdx: number;
  dateIdx: number;
}

/**
 * Auto-detect which column index corresponds to which data type.
 * First tries header name matching. For any column not found by name,
 * scans actual data values to detect patterns.
 */
export function detectColumns(headers: string[], sampleRows: any[][]): SmartColumnMap {
  const h = headers.map(s => s.toLowerCase().trim());

  const findByName = (names: string[]): number => {
    // Exact match first
    for (const name of names) {
      const idx = h.findIndex(header => header === name);
      if (idx !== -1) return idx;
    }
    // Then partial match
    for (const name of names) {
      const idx = h.findIndex(header => header.includes(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const result: SmartColumnMap = {
    revenueIdx: findByName(['total pendapatan', 'omzet', 'pendapatan', 'total harga', 'subtotal', 'sub total', 'revenue', 'total', 'harga total', 'amount', 'grand total', 'sales']),
    qtyIdx: findByName(['jumlah terjual', 'qty', 'kuantitas', 'quantity', 'jumlah', 'porsi', 'banyak', 'pcs', 'unit']),
    menuIdx: findByName(['nama menu', 'menu', 'produk', 'item', 'nama produk', 'product', 'nama item', 'barang', 'pesanan', 'order']),
    timeIdx: findByName(['jam', 'waktu', 'time', 'pukul', 'clock', 'hour', 'jam transaksi', 'waktu transaksi', 'waktu order', 'order time']),
    categoryIdx: findByName(['kategori', 'category', 'jenis', 'tipe', 'type', 'golongan', 'kelompok', 'group']),
    customerIdx: findByName(['nama pelanggan', 'pelanggan', 'customer', 'pembeli', 'buyer', 'nama customer', 'customer name', 'nama pembeli', 'konsumen']),
    dayNameIdx: findByName(['hari', 'day', 'nama hari', 'day name']),
    dateIdx: findByName(['tanggal', 'date', 'tgl', 'tanggal transaksi', 'transaction date', 'created_at', 'created at', 'order date', 'tanggal order', 'tgl transaksi']),
  };

  // ─── Auto-detect from data values if not found by name ───────────────────
  const samples = sampleRows.slice(0, Math.min(20, sampleRows.length));
  const usedIndices = new Set(Object.values(result).filter(v => v !== -1));

  // Auto-detect DATE column
  if (result.dateIdx === -1) {
    for (let col = 0; col < headers.length; col++) {
      if (usedIndices.has(col)) continue;
      let dateMatches = 0;
      for (const row of samples) {
        const val = String(row[col] || '').trim();
        if (val && DATE_PATTERNS.some(p => p.test(val))) dateMatches++;
      }
      if (dateMatches >= Math.min(3, samples.length * 0.3)) {
        result.dateIdx = col;
        usedIndices.add(col);
        break;
      }
    }
  }

  // Auto-detect TIME column (also check if dateIdx column contains time info)
  if (result.timeIdx === -1) {
    // First check if dateIdx column already contains time (datetime column)
    if (result.dateIdx !== -1) {
      let hasTime = 0;
      for (const row of samples) {
        const val = String(row[result.dateIdx] || '').trim();
        if (val && /\d{1,2}:\d{2}/.test(val)) hasTime++;
      }
      if (hasTime >= Math.min(3, samples.length * 0.3)) {
        result.timeIdx = result.dateIdx; // Same column has both date and time
      }
    }

    // If still not found, scan other columns
    if (result.timeIdx === -1) {
      for (let col = 0; col < headers.length; col++) {
        if (usedIndices.has(col)) continue;
        let timeMatches = 0;
        for (const row of samples) {
          const val = String(row[col] || '').trim();
          if (val && TIME_PATTERNS.some(p => p.test(val))) timeMatches++;
        }
        if (timeMatches >= Math.min(3, samples.length * 0.3)) {
          result.timeIdx = col;
          usedIndices.add(col);
          break;
        }
      }
    }
  }

  // Auto-detect DAY NAME column
  if (result.dayNameIdx === -1) {
    for (let col = 0; col < headers.length; col++) {
      if (usedIndices.has(col)) continue;
      let dayMatches = 0;
      for (const row of samples) {
        const val = String(row[col] || '').toLowerCase().trim();
        if (val && (DAY_NAMES_ID.includes(val) || DAY_NAMES_EN.includes(val))) dayMatches++;
      }
      if (dayMatches >= Math.min(3, samples.length * 0.3)) {
        result.dayNameIdx = col;
        usedIndices.add(col);
        break;
      }
    }
  }

  return result;
}

/**
 * Extract hour (0-23) from a cell value.
 * Handles: "08:30", "8:30:00", "08.30", "2026-01-05 08:30:00", "2026-01-05T08:30:00"
 */
export function extractHour(val: any): number | null {
  const s = String(val || '').trim();
  if (!s) return null;
  
  // Try HH:MM pattern (most common)
  const matchColon = s.match(/(\d{1,2}):(\d{2})/);
  if (matchColon) {
    const h = parseInt(matchColon[1], 10);
    if (h >= 0 && h <= 23) return h;
  }
  
  // Try HH.MM pattern (Indonesian)
  const matchDot = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (matchDot) {
    const h = parseInt(matchDot[1], 10);
    if (h >= 0 && h <= 23) return h;
  }
  
  return null;
}

/**
 * Extract day number (1-31) from a date cell value.
 * Handles many formats: DD/MM/YYYY, YYYY-MM-DD, "5 Jan 2026", ISO, etc.
 */
export function extractDayOfMonth(val: any): string | null {
  const s = String(val || '').trim();
  if (!s) return null;
  
  // Try standard Date parsing first (handles ISO, YYYY-MM-DD, etc.)
  const dateObj = new Date(s);
  if (!isNaN(dateObj.getTime()) && dateObj.getFullYear() > 1970 && dateObj.getFullYear() < 2100) {
    return dateObj.getDate().toString();
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const matchDMY = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (matchDMY) {
    const day = parseInt(matchDMY[1], 10);
    if (day >= 1 && day <= 31) return day.toString();
  }

  // Try extracting from datetime string like "05/08/2026 08:30"
  const matchDateTime = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\s+\d/);
  if (matchDateTime) {
    const day = parseInt(matchDateTime[1], 10);
    if (day >= 1 && day <= 31) return day.toString();
  }
  
  // Just a number (could be day of month already in the sheet)
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 1 && num <= 31 && s.length <= 2) {
    return num.toString();
  }

  return null;
}

/**
 * Extract month name from a date cell value.
 */
export function extractMonthName(val: any): string | null {
  const s = String(val || '').trim();
  if (!s) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  const dateObj = new Date(s);
  if (!isNaN(dateObj.getTime()) && dateObj.getFullYear() > 1970 && dateObj.getFullYear() < 2100) {
    return months[dateObj.getMonth()];
  }

  // DD/MM/YYYY — month is the second group
  const matchDMY = s.match(/^\d{1,2}[\/-](\d{1,2})[\/-]\d{2,4}/);
  if (matchDMY) {
    const m = parseInt(matchDMY[1], 10);
    if (m >= 1 && m <= 12) return months[m - 1];
  }

  return null;
}

/**
 * Extract day-of-week name (Indonesian) from a date cell value.
 */
export function extractDayName(val: any): string | null {
  const s = String(val || '').trim();
  if (!s) return null;

  // Check if the value itself IS a day name
  const lower = s.toLowerCase();
  const dayIdx = DAY_NAMES_ID.findIndex(d => lower.startsWith(d));
  if (dayIdx !== -1) {
    return DAY_NAMES_ID[dayIdx].charAt(0).toUpperCase() + DAY_NAMES_ID[dayIdx].slice(1);
  }
  const dayIdxEn = DAY_NAMES_EN.findIndex(d => lower.startsWith(d));
  if (dayIdxEn !== -1) {
    return DAY_NAMES_ID[dayIdxEn].charAt(0).toUpperCase() + DAY_NAMES_ID[dayIdxEn].slice(1);
  }

  // Try to parse as date and get day of week
  const dateObj = new Date(s);
  if (!isNaN(dateObj.getTime()) && dateObj.getFullYear() > 1970) {
    const jsDay = dateObj.getDay(); // 0=Sunday
    const mapped = [6, 0, 1, 2, 3, 4, 5]; // JS Sunday=0 -> Minggu index=6
    return DAY_NAMES_ID[mapped[jsDay]].charAt(0).toUpperCase() + DAY_NAMES_ID[mapped[jsDay]].slice(1);
  }

  return null;
}

/**
 * Main aggregation function that works for both upload and sync-sheets routes.
 * Takes raw row data and column map, returns all aggregated data.
 */
export interface AggregatedData {
  totalRevenue: number;
  totalItemsSold: number;
  totalTransactions: number;
  menuCount: Record<string, number>;
  menuRevenue: Record<string, number>;
  hourCount: Record<string, number>;
  hourRevenue: Record<string, number>;
  categoryRevenue: Record<string, number>;
  categoryCount: Record<string, number>;
  customerRevenue: Record<string, number>;
  dayRevenue: Record<string, number>;
  peakHourStr: string;
  peakHourCount: number;
  avgPerNota: number;
}

export function aggregateData(
  rows: any[][],
  colMap: SmartColumnMap,
  reportType: string
): AggregatedData {
  let totalRevenue = 0;
  let totalItemsSold = 0;
  const totalTransactions = rows.length;
  const menuCount: Record<string, number> = {};
  const menuRevenue: Record<string, number> = {};
  const hourCount: Record<string, number> = {};
  const hourRevenue: Record<string, number> = {};
  const categoryRevenue: Record<string, number> = {};
  const categoryCount: Record<string, number> = {};
  const customerRevenue: Record<string, number> = {};
  const dayRevenue: Record<string, number> = {};

  for (const row of rows) {
    const revRaw = colMap.revenueIdx !== -1 ? row[colMap.revenueIdx] : undefined;
    const qtyRaw = colMap.qtyIdx !== -1 ? row[colMap.qtyIdx] : undefined;
    const menuRaw = colMap.menuIdx !== -1 ? row[colMap.menuIdx] : undefined;
    const timeRaw = colMap.timeIdx !== -1 ? row[colMap.timeIdx] : undefined;
    const catRaw = colMap.categoryIdx !== -1 ? row[colMap.categoryIdx] : undefined;
    const custRaw = colMap.customerIdx !== -1 ? row[colMap.customerIdx] : undefined;
    const dayNameRaw = colMap.dayNameIdx !== -1 ? row[colMap.dayNameIdx] : undefined;
    const dateRaw = colMap.dateIdx !== -1 ? row[colMap.dateIdx] : undefined;

    const rev = parseFloat(String(revRaw || '0').replace(/[^0-9.-]+/g, ''));
    const qty = parseInt(String(qtyRaw || '0').replace(/[^0-9.-]+/g, ''), 10);

    if (!isNaN(rev)) totalRevenue += rev;
    if (!isNaN(qty)) {
      totalItemsSold += qty;
      if (menuRaw && String(menuRaw).trim() && String(menuRaw).trim() !== '-') {
        const m = String(menuRaw).trim();
        menuCount[m] = (menuCount[m] || 0) + qty;
      }
    }

    // Menu revenue
    if (menuRaw && String(menuRaw).trim() && String(menuRaw).trim() !== '-' && !isNaN(rev)) {
      const m = String(menuRaw).trim();
      menuRevenue[m] = (menuRevenue[m] || 0) + rev;
    }

    // Hour extraction (from time column OR from date column if it contains time)
    const hour = extractHour(timeRaw) ?? (dateRaw !== timeRaw ? extractHour(dateRaw) : null);
    if (hour !== null) {
      hourCount[hour] = (hourCount[hour] || 0) + 1;
      if (!isNaN(rev)) hourRevenue[hour] = (hourRevenue[hour] || 0) + rev;
    }

    // Category
    if (catRaw && String(catRaw).trim() && String(catRaw).trim() !== '-') {
      const c = String(catRaw).trim();
      if (!isNaN(rev)) categoryRevenue[c] = (categoryRevenue[c] || 0) + rev;
      if (!isNaN(qty)) categoryCount[c] = (categoryCount[c] || 0) + qty;
    }

    // Customer
    if (custRaw && String(custRaw).trim() && String(custRaw).trim() !== '-' && !isNaN(rev)) {
      const c = String(custRaw).trim();
      customerRevenue[c] = (customerRevenue[c] || 0) + rev;
    }

    // Day/Date revenue
    if (!isNaN(rev)) {
      if (reportType === 'bulanan') {
        // Try dateIdx first, then any column with date-like data
        const dayNum = extractDayOfMonth(dateRaw) ?? extractDayOfMonth(timeRaw);
        if (dayNum) dayRevenue[dayNum] = (dayRevenue[dayNum] || 0) + rev;
      } else if (reportType === 'tahunan') {
        const monthName = extractMonthName(dateRaw) ?? extractMonthName(timeRaw);
        if (monthName) dayRevenue[monthName] = (dayRevenue[monthName] || 0) + rev;
      } else {
        // harian - day of week
        const dayName = extractDayName(dayNameRaw) ?? extractDayName(dateRaw);
        if (dayName) dayRevenue[dayName] = (dayRevenue[dayName] || 0) + rev;
      }
    }
  }

  // Peak hour calculation
  let peakHourStr = "Data tidak tersedia";
  let peakHourCount = 0;
  const hourKeys = Object.keys(hourCount).map(Number).sort((a, b) => hourCount[b] - hourCount[a]);
  if (hourKeys.length > 0) {
    const peak = hourKeys[0];
    peakHourCount = hourCount[peak];
    peakHourStr = `${String(peak).padStart(2, '0')}:00 - ${String(peak + 1).padStart(2, '0')}:00`;
  }

  const avgPerNota = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  return {
    totalRevenue, totalItemsSold, totalTransactions,
    menuCount, menuRevenue, hourCount, hourRevenue,
    categoryRevenue, categoryCount, customerRevenue, dayRevenue,
    peakHourStr, peakHourCount, avgPerNota,
  };
}
