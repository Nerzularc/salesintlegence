/**
 * ================================================================
 * SALES INTELLIGENCE COMMAND CENTRE — script.js
 * Version: 1.0.0 | Data source: data/sales.json (synthetic)
 *
 * Architecture:
 *  1. Constants & configuration
 *  2. Data loading & validation
 *  3. State management
 *  4. Filtering engine
 *  5. Calculation engine (KPIs, aggregations)
 *  6. Analytics (insights, anomalies, root-cause, pareto)
 *  7. Chart rendering
 *  8. UI / interaction
 *  9. Export
 * 10. Initialisation
 * ================================================================
 */

'use strict';

// ================================================================
// 1. CONSTANTS & CONFIGURATION
// ================================================================

const CONFIG = {
  DATA_PATH: 'data/sales.json',
  CURRENCY: 'USD',
  LOCALE: 'en-US',
  DEBOUNCE_MS: 250,
  TOP_N: 10,
  ANOMALY_THRESHOLD: 2.5,           // MAD-based z-score multiplier
  ANOMALY_MIN_PERIODS: 4,           // Minimum periods for anomaly detection
  PARETO_WARNING_THRESHOLD: 0.8,    // Flag if top-20% entities hold ≥80% revenue
  CONCENTRATION_TOP_SHARE_WARNING: 0.5,  // Flag if top entity holds ≥50% revenue
  INSIGHT_MAX: 8,
};

const CHART_PALETTE = [
  '#3b82f6', '#06b6d4', '#8b5cf6', '#f59e0b',
  '#22c55e', '#ef4444', '#f97316', '#ec4899',
  '#14b8a6', '#a78bfa',
];

const REQUIRED_FIELDS = [
  'product_id', 'sale_date', 'sales_rep', 'region',
  'sales_amount', 'quantity_sold', 'product_category',
  'unit_cost', 'unit_price', 'customer_type',
  'discount', 'payment_method', 'sales_channel',
];

// ================================================================
// 2. GLOBAL STATE
// ================================================================

const STATE = {
  raw: [],                  // Original, immutable records
  filtered: [],             // Current filtered dataset (source of truth for all charts/KPIs)
  meta: {},                 // JSON _meta object
  filters: {
    search: '',
    dateFrom: null,
    dateTo: null,
    region: [],
    category: [],
    customerType: [],
    channel: [],
    rep: [],
    payment: [],
  },
  charts: {},               // Chart.js instances keyed by chart id
  sparklines: {},           // Sparkline canvas instances
  theme: 'dark',
  trendAgg: 'monthly',
  trendShowVolume: false,
  trendShowPrev: false,
  regionMetric: 'revenue',
  categoryMetric: 'revenue',
  repMetric: 'revenue',
  custMetric: 'revenue',
  payMetric: 'transactions',
  chanMetric: 'revenue',
  topSort: 'revenue',
  paretoDim: 'rep',
  scatterShowTrendline: false,
  intelTab: 'insights',
  loadTimestamp: null,
  validationResults: null,
  periodOptions: [],
};

// ================================================================
// 3. UTILITIES
// ================================================================

/**
 * Format a number as currency.
 * @param {number} val
 * @param {boolean} compact - use compact notation for large values
 */
function formatCurrency(val, compact = false) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const opts = { style: 'currency', currency: CONFIG.CURRENCY };
  if (compact && Math.abs(val) >= 1000) {
    opts.notation = 'compact';
    opts.maximumFractionDigits = 1;
  } else {
    opts.minimumFractionDigits = 2;
    opts.maximumFractionDigits = 2;
  }
  return new Intl.NumberFormat(CONFIG.LOCALE, opts).format(val);
}

function formatNumber(val, decimals = 0) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return new Intl.NumberFormat(CONFIG.LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val);
}

function formatPct(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return `${(val * 100).toFixed(decimals)}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(CONFIG.LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Prevent CSV formula injection */
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function safeDiv(num, den) {
  if (!den || isNaN(den) || den === 0) return null;
  return num / den;
}

function pctChange(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Parse a YYYY-MM-DD string to a Date at local midnight */
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7) };
}

function weekLabel(date) {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function monthLabel(date) {
  return date.toLocaleDateString(CONFIG.LOCALE, { year: 'numeric', month: 'short' });
}

function dayLabel(date) {
  return date.toISOString().slice(0, 10);
}

/** Pearson correlation coefficient */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? null : num / den;
}

/** Simple linear regression: returns { slope, intercept } */
function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

/** Median of an array */
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation */
function mad(arr) {
  const med = median(arr);
  if (med === null) return null;
  return median(arr.map(v => Math.abs(v - med)));
}

// ================================================================
// 4. DATA LOADING & VALIDATION
// ================================================================

async function loadSalesData() {
  const res = await fetch(CONFIG.DATA_PATH);
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch ${CONFIG.DATA_PATH}`);
  const json = await res.json();
  if (!json.transactions || !Array.isArray(json.transactions)) {
    throw new Error('JSON structure invalid: missing "transactions" array.');
  }
  return json;
}

function validateSalesData(records) {
  const results = {
    total: records.length,
    valid: 0,
    issues: [],
    excluded: [],
  };

  const VALID_CHANNELS = ['Online', 'Retail'];
  const VALID_CUST_TYPES = ['New', 'Returning'];

  records.forEach((r, i) => {
    const rowIssues = [];

    // Missing required fields
    REQUIRED_FIELDS.forEach(f => {
      if (r[f] === null || r[f] === undefined || r[f] === '') {
        rowIssues.push({ field: f, type: 'missing', severity: 'error', msg: `Missing required field: ${f}` });
      }
    });

    // Date validity
    if (r.sale_date) {
      const d = parseDate(r.sale_date);
      if (!d) rowIssues.push({ field: 'sale_date', type: 'invalid_date', severity: 'error', msg: `Invalid date: ${r.sale_date}` });
    }

    // Numeric checks
    if (typeof r.sales_amount !== 'number' || isNaN(r.sales_amount)) {
      rowIssues.push({ field: 'sales_amount', type: 'non_numeric', severity: 'error', msg: 'sales_amount is not a valid number' });
    } else if (r.sales_amount < 0) {
      rowIssues.push({ field: 'sales_amount', type: 'negative', severity: 'warning', msg: `Negative sales_amount: ${r.sales_amount}` });
    }

    if (typeof r.quantity_sold !== 'number' || r.quantity_sold < 0) {
      rowIssues.push({ field: 'quantity_sold', type: 'negative_qty', severity: 'warning', msg: `Invalid quantity_sold: ${r.quantity_sold}` });
    }

    if (typeof r.discount !== 'number' || r.discount < 0 || r.discount > 1) {
      rowIssues.push({ field: 'discount', type: 'invalid_discount', severity: 'warning', msg: `Discount out of [0,1] range: ${r.discount}` });
    }

    if (typeof r.unit_price !== 'number' || r.unit_price < 0) {
      rowIssues.push({ field: 'unit_price', type: 'negative_price', severity: 'warning', msg: `Invalid unit_price: ${r.unit_price}` });
    }

    // Categorical checks
    if (r.sales_channel && !VALID_CHANNELS.includes(r.sales_channel)) {
      rowIssues.push({ field: 'sales_channel', type: 'unrecognised', severity: 'warning', msg: `Unrecognised sales_channel: ${r.sales_channel}` });
    }

    if (r.customer_type && !VALID_CUST_TYPES.includes(r.customer_type)) {
      rowIssues.push({ field: 'customer_type', type: 'unrecognised', severity: 'warning', msg: `Unrecognised customer_type: ${r.customer_type}` });
    }

    if (rowIssues.length) {
      results.issues.push({ row: i + 1, product_id: r.product_id, issues: rowIssues });
      const hasError = rowIssues.some(x => x.severity === 'error');
      if (hasError) results.excluded.push(i);
    } else {
      results.valid++;
    }
  });

  return results;
}

function normaliseSalesRecords(records, validationResults) {
  // Exclude records with schema errors
  const excludedSet = new Set(validationResults.excluded);
  return records
    .filter((_, i) => !excludedSet.has(i))
    .map((r, i) => ({
      _idx: i,
      product_id: String(r.product_id),
      sale_date: r.sale_date,
      _date: parseDate(r.sale_date),
      sales_rep: String(r.sales_rep || ''),
      region: String(r.region || ''),
      sales_amount: Number(r.sales_amount),
      quantity_sold: Number(r.quantity_sold),
      product_category: String(r.product_category || ''),
      unit_cost: Number(r.unit_cost),
      unit_price: Number(r.unit_price),
      customer_type: String(r.customer_type || ''),
      discount: Number(r.discount),
      payment_method: String(r.payment_method || ''),
      sales_channel: String(r.sales_channel || ''),
    }));
}

// ================================================================
// 5. FILTERING ENGINE
// ================================================================

function applyGlobalFilters(records, filters) {
  return records.filter(r => {
    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = [r.sales_rep, r.region, r.product_category, r.product_id, r.customer_type, r.payment_method, r.sales_channel].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }

    // Date range
    if (filters.dateFrom && r._date && r._date < filters.dateFrom) return false;
    if (filters.dateTo) {
      const endOfDay = new Date(filters.dateTo.getTime());
      endOfDay.setHours(23, 59, 59, 999);
      if (r._date && r._date > endOfDay) return false;
    }

    // Multi-selects
    if (filters.region.length && !filters.region.includes(r.region)) return false;
    if (filters.category.length && !filters.category.includes(r.product_category)) return false;
    if (filters.customerType.length && !filters.customerType.includes(r.customer_type)) return false;
    if (filters.channel.length && !filters.channel.includes(r.sales_channel)) return false;
    if (filters.rep.length && !filters.rep.includes(r.sales_rep)) return false;
    if (filters.payment.length && !filters.payment.includes(r.payment_method)) return false;

    return true;
  });
}

function countActiveFilters(filters) {
  let count = 0;
  if (filters.search) count++;
  if (filters.dateFrom || filters.dateTo) count++;
  if (filters.region.length) count++;
  if (filters.category.length) count++;
  if (filters.customerType.length) count++;
  if (filters.channel.length) count++;
  if (filters.rep.length) count++;
  if (filters.payment.length) count++;
  return count;
}

// ================================================================
// 6. CALCULATION ENGINE
// ================================================================

/**
 * calculateKPIs — compute all KPIs from the filtered dataset.
 * Revenue definition: sum of sales_amount (net revenue per row).
 * Transaction count: total rows in the filtered set (no unique order id in source).
 */
function calculateKPIs(records) {
  if (!records.length) {
    return {
      totalRevenue: 0, totalTransactions: 0, totalQuantity: 0,
      avgDiscount: null, avgOrderValue: null, avgUnitPrice: null,
      revenuePerRep: null, discountedSharePct: null,
      uniqueReps: 0, revenueConcentrationTop1: null,
    };
  }

  const totalRevenue = records.reduce((s, r) => s + r.sales_amount, 0);
  const totalTransactions = records.length;
  const totalQuantity = records.reduce((s, r) => s + r.quantity_sold, 0);
  const avgDiscount = records.reduce((s, r) => s + r.discount, 0) / totalTransactions;
  const avgOrderValue = safeDiv(totalRevenue, totalTransactions);
  const avgUnitPrice = records.reduce((s, r) => s + r.unit_price, 0) / totalTransactions;

  const discounted = records.filter(r => r.discount > 0).length;
  const discountedSharePct = discounted / totalTransactions;

  const reps = [...new Set(records.map(r => r.sales_rep))];
  const uniqueReps = reps.length;
  const revenuePerRep = safeDiv(totalRevenue, uniqueReps);

  // Revenue concentration — top single rep share
  const repRevMap = aggregateRevenueByDimension(records, 'sales_rep');
  const sorted = Object.values(repRevMap).sort((a, b) => b - a);
  const revenueConcentrationTop1 = sorted.length ? sorted[0] / totalRevenue : null;

  return {
    totalRevenue, totalTransactions, totalQuantity,
    avgDiscount, avgOrderValue, avgUnitPrice,
    revenuePerRep, discountedSharePct, uniqueReps,
    revenueConcentrationTop1,
  };
}

function aggregateRevenueByDimension(records, dimension) {
  const map = {};
  records.forEach(r => {
    const key = r[dimension] || '(Unknown)';
    map[key] = (map[key] || 0) + r.sales_amount;
  });
  return map;
}

function aggregateByDimension(records, dimension) {
  const map = {};
  records.forEach(r => {
    const key = r[dimension] || '(Unknown)';
    if (!map[key]) {
      map[key] = { revenue: 0, transactions: 0, quantity: 0, discountSum: 0, unitPriceSum: 0 };
    }
    map[key].revenue += r.sales_amount;
    map[key].transactions += 1;
    map[key].quantity += r.quantity_sold;
    map[key].discountSum += r.discount;
    map[key].unitPriceSum += r.unit_price;
  });
  // Compute averages
  Object.values(map).forEach(v => {
    v.avgDiscount = safeDiv(v.discountSum, v.transactions);
    v.avgOrderValue = safeDiv(v.revenue, v.transactions);
    v.avgUnitPrice = safeDiv(v.unitPriceSum, v.transactions);
  });
  return map;
}

function aggregateSalesByDate(records, aggregation) {
  const map = {};
  records.forEach(r => {
    if (!r._date) return;
    let key;
    if (aggregation === 'daily')   key = dayLabel(r._date);
    else if (aggregation === 'weekly')  key = weekLabel(r._date);
    else                                key = monthLabel(r._date);
    if (!map[key]) map[key] = { revenue: 0, transactions: 0, quantity: 0 };
    map[key].revenue += r.sales_amount;
    map[key].transactions += 1;
    map[key].quantity += r.quantity_sold;
  });
  // Sort keys
  const keys = Object.keys(map).sort();
  return { keys, data: keys.map(k => map[k]) };
}

function calculatePeriodComparison(records, agg = 'monthly') {
  const { keys, data } = aggregateSalesByDate(records, agg);
  if (keys.length < 2) return null;
  const mid = Math.floor(keys.length / 2);
  const prevRevenue = data.slice(0, mid).reduce((s, d) => s + d.revenue, 0);
  const currRevenue = data.slice(mid).reduce((s, d) => s + d.revenue, 0);
  const prevTxn = data.slice(0, mid).reduce((s, d) => s + d.transactions, 0);
  const currTxn = data.slice(mid).reduce((s, d) => s + d.transactions, 0);
  return {
    prevRevenue, currRevenue,
    revenueChange: pctChange(currRevenue, prevRevenue),
    prevTxn, currTxn,
    txnChange: pctChange(currTxn, prevTxn),
    prevLabel: `${keys[0]} – ${keys[mid - 1]}`,
    currLabel: `${keys[mid]} – ${keys[keys.length - 1]}`,
    note: 'Comparison splits the available date range into two equal halves. Periods are not seasonally adjusted.',
  };
}

function calculateRevenueConcentration(records, dimension) {
  const map = aggregateRevenueByDimension(records, dimension);
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  let cum = 0;
  const curve = sorted.map(([key, rev]) => {
    cum += rev;
    return { key, revenue: rev, cumulative: cum / total, share: rev / total };
  });
  return { curve, total, topShare: curve[0]?.share || 0 };
}

// ================================================================
// 7. ANALYTICS — INSIGHTS, ANOMALIES, ROOT CAUSE
// ================================================================

function generateInsights(records) {
  const insights = [];

  if (records.length < 5) return insights;

  const total = records.reduce((s, r) => s + r.sales_amount, 0);
  if (total === 0) return insights;

  // 1. Revenue concentration by region
  const regionData = aggregateByDimension(records, 'region');
  const regions = Object.entries(regionData).sort((a, b) => b[1].revenue - a[1].revenue);
  if (regions.length >= 2) {
    const [topName, topData] = regions[0];
    const share = topData.revenue / total;
    if (share >= 0.30) {
      insights.push({
        headline: `${topName} region accounts for ${formatPct(share)} of total revenue`,
        observed: formatCurrency(topData.revenue),
        benchmark: `${formatPct(share)} revenue share`,
        evidence: `${topName}: ${formatCurrency(topData.revenue)} | Total: ${formatCurrency(total)}`,
        confidence: share >= 0.50 ? 'high' : 'medium',
        recommendation: `Investigate whether this concentration represents a strategic strength or a dependency risk. Consider whether under-performing regions have addressable growth opportunities.`,
        caveat: `High regional revenue does not imply higher margins without cost data.`,
        priority: share,
      });
    }
  }

  // 2. Category revenue concentration
  const catData = aggregateByDimension(records, 'product_category');
  const cats = Object.entries(catData).sort((a, b) => b[1].revenue - a[1].revenue);
  if (cats.length >= 2) {
    const [topCat, topCatData] = cats[0];
    const share = topCatData.revenue / total;
    if (share >= 0.35) {
      insights.push({
        headline: `"${topCat}" is the highest-revenue category at ${formatPct(share)} share`,
        observed: formatCurrency(topCatData.revenue),
        benchmark: `${formatPct(share)} of total revenue`,
        evidence: `Top category: ${topCat} | Transactions: ${topCatData.transactions}`,
        confidence: 'medium',
        recommendation: `Review whether other categories are being actively developed or whether the portfolio is naturally concentrated in ${topCat}.`,
        caveat: `Revenue share ≠ profitability share without cost data.`,
        priority: share * 0.9,
      });
    }
  }

  // 3. Discount vs order size observation
  const avgDiscount = records.reduce((s, r) => s + r.discount, 0) / records.length;
  const highDiscount = records.filter(r => r.discount > avgDiscount * 1.5);
  const lowDiscount  = records.filter(r => r.discount <= avgDiscount * 0.5);
  if (highDiscount.length >= 5 && lowDiscount.length >= 5) {
    const avgRevHigh = highDiscount.reduce((s, r) => s + r.sales_amount, 0) / highDiscount.length;
    const avgRevLow  = lowDiscount.reduce((s, r) => s + r.sales_amount, 0) / lowDiscount.length;
    const diff = avgRevHigh - avgRevLow;
    if (Math.abs(diff) > 500) {
      insights.push({
        headline: `Higher-discount transactions have ${diff > 0 ? 'higher' : 'lower'} average revenue (${formatCurrency(Math.abs(diff))} difference)`,
        observed: `Avg revenue @ high discount: ${formatCurrency(avgRevHigh)}`,
        benchmark: `Avg revenue @ low discount: ${formatCurrency(avgRevLow)}`,
        evidence: `High-discount group (n=${highDiscount.length}): avg discount ${formatPct(highDiscount.reduce((s,r) => s+r.discount,0)/highDiscount.length)}`,
        confidence: 'low',
        recommendation: `Analyse whether large orders are associated with larger discounts as a negotiation practice, or whether discounts are driving volume uplift. Both hypotheses require additional investigation.`,
        caveat: `This is a descriptive association only. Discount ≠ cause of revenue difference. Confounders include order size, channel, and customer segment.`,
        priority: 0.4,
      });
    }
  }

  // 4. Channel average order value
  const chanData = aggregateByDimension(records, 'sales_channel');
  const chans = Object.entries(chanData);
  if (chans.length >= 2) {
    const [c1, c2] = chans.sort((a, b) => (b[1].avgOrderValue || 0) - (a[1].avgOrderValue || 0));
    const ratio = safeDiv(c1[1].avgOrderValue, c2[1].avgOrderValue);
    if (ratio && ratio >= 1.2) {
      insights.push({
        headline: `"${c1[0]}" channel has ${formatPct((ratio-1))} higher average order value than "${c2[0]}"`,
        observed: `${c1[0]}: ${formatCurrency(c1[1].avgOrderValue)}`,
        benchmark: `${c2[0]}: ${formatCurrency(c2[1].avgOrderValue)}`,
        evidence: `Based on ${c1[1].transactions} vs ${c2[1].transactions} transactions`,
        confidence: 'medium',
        recommendation: `Investigate whether order composition (product mix, quantity) differs by channel, which could explain the value gap.`,
        caveat: `Higher order value ≠ higher profitability. Cost-to-serve differs across channels.`,
        priority: (ratio - 1) * 0.5,
      });
    }
  }

  // 5. Rep discount outlier
  const repData = aggregateByDimension(records, 'sales_rep');
  const avgDiscOverall = records.reduce((s, r) => s + r.discount, 0) / records.length;
  const repEntries = Object.entries(repData);
  repEntries.forEach(([rep, d]) => {
    if (d.transactions < 3) return;
    const repAvgDisc = d.discountSum / d.transactions;
    const deviation = Math.abs(repAvgDisc - avgDiscOverall);
    if (deviation >= 0.07) {
      insights.push({
        headline: `${rep}'s discount rate (${formatPct(repAvgDisc)}) deviates ${formatPct(deviation)} from the overall average (${formatPct(avgDiscOverall)})`,
        observed: `${rep} avg discount: ${formatPct(repAvgDisc)}`,
        benchmark: `Overall avg discount: ${formatPct(avgDiscOverall)}`,
        evidence: `${rep}: ${d.transactions} transactions, ${formatCurrency(d.revenue)} total revenue`,
        confidence: d.transactions >= 10 ? 'medium' : 'low',
        recommendation: `Review whether this rep's discount usage reflects authorised pricing strategy, customer segment differences, or a need for pricing training.`,
        caveat: `Discount rate alone does not determine profitability or performance.`,
        priority: deviation * 0.8,
      });
    }
  });

  // 6. Few transactions driving large revenue share (Pareto-style)
  const sortedTxn = [...records].sort((a, b) => b.sales_amount - a.sales_amount);
  const top10Pct = Math.ceil(records.length * 0.1);
  const top10Rev = sortedTxn.slice(0, top10Pct).reduce((s, r) => s + r.sales_amount, 0);
  const top10Share = top10Rev / total;
  if (top10Share >= 0.40) {
    insights.push({
      headline: `Top 10% of transactions (${top10Pct} rows) generate ${formatPct(top10Share)} of revenue`,
      observed: formatCurrency(top10Rev),
      benchmark: `${formatPct(top10Share)} of total revenue (${formatCurrency(total)})`,
      evidence: `Top-${top10Pct} transactions by revenue`,
      confidence: 'high',
      recommendation: `Protect relationships and order conditions associated with high-value transactions. Identify whether the pattern is sustainable and what it means for revenue predictability.`,
      caveat: `Revenue concentration is a risk indicator. It does not confirm fragility unless combined with customer churn and pipeline data.`,
      priority: top10Share,
    });
  }

  // 7. Month-over-month trend
  const { keys, data: dateData } = aggregateSalesByDate(records, 'monthly');
  if (keys.length >= 3) {
    const lastThree = dateData.slice(-3).map(d => d.revenue);
    const trend = lastThree[2] - lastThree[0];
    const trendPct = safeDiv(trend, lastThree[0]);
    if (trendPct && Math.abs(trendPct) >= 0.15) {
      insights.push({
        headline: `Revenue ${trend > 0 ? 'increased' : 'decreased'} by ${formatPct(Math.abs(trendPct))} over the last 3 available months`,
        observed: `${keys[keys.length - 1]}: ${formatCurrency(lastThree[2])}`,
        benchmark: `${keys[keys.length - 3]}: ${formatCurrency(lastThree[0])}`,
        evidence: `3-month window: ${keys.slice(-3).join(', ')}`,
        confidence: keys.length >= 6 ? 'medium' : 'low',
        recommendation: `${trend > 0 ? 'Identify which segments drove the increase and whether momentum is sustainable.' : 'Decompose by region, category, and channel to identify the primary source of the decline.'}`,
        caveat: `Short windows (< 6 months) limit the reliability of trend observations. Seasonal effects cannot be separated from structural changes.`,
        priority: Math.abs(trendPct) * 0.7,
      });
    }
  }

  // De-duplicate and rank by priority
  return insights
    .sort((a, b) => b.priority - a.priority)
    .slice(0, CONFIG.INSIGHT_MAX);
}

function detectSalesAnomalies(records) {
  const { keys, data } = aggregateSalesByDate(records, 'monthly');
  if (keys.length < CONFIG.ANOMALY_MIN_PERIODS) {
    return { anomalies: [], note: `Insufficient history for anomaly detection (${keys.length} periods; need ≥ ${CONFIG.ANOMALY_MIN_PERIODS}).` };
  }

  const revenues = data.map(d => d.revenue);
  const med = median(revenues);
  const madVal = mad(revenues);

  if (!madVal || madVal === 0) {
    return { anomalies: [], note: 'Zero dispersion in monthly revenue — anomaly detection not applicable.' };
  }

  const anomalies = [];
  revenues.forEach((rev, i) => {
    const modifiedZ = (0.6745 * Math.abs(rev - med)) / madVal;
    if (modifiedZ > CONFIG.ANOMALY_THRESHOLD) {
      anomalies.push({
        period: keys[i],
        revenue: rev,
        median: med,
        modifiedZ: modifiedZ.toFixed(2),
        direction: rev > med ? 'above' : 'below',
        label: `${keys[i]}: ${formatCurrency(rev)} (modified z-score: ${modifiedZ.toFixed(2)})`,
      });
    }
  });

  return {
    anomalies,
    note: anomalies.length
      ? `${anomalies.length} unusual period(s) detected using Median Absolute Deviation (threshold: ${CONFIG.ANOMALY_THRESHOLD}× modified z-score). These are observations requiring investigation, not confirmed errors or fraud.`
      : 'No statistically unusual monthly periods detected at the current sensitivity threshold.',
  };
}

function runRootCauseAnalysis(records, metric, periodA, periodB) {
  if (!periodA || !periodB) return [];

  const { keys, data } = aggregateSalesByDate(records, 'monthly');
  const idxA = keys.indexOf(periodA);
  const idxB = keys.indexOf(periodB);
  if (idxA < 0 || idxB < 0) return [];

  const getVal = (d) => {
    if (metric === 'revenue') return d.revenue;
    if (metric === 'transactions') return d.transactions;
    return d.quantity;
  };

  const totalA = getVal(data[idxA]);
  const totalB = getVal(data[idxB]);
  const totalChange = totalB - totalA;

  // Get records for each period
  const label = (r) => monthLabel(r._date);
  const recA = records.filter(r => r._date && label(r) === periodA);
  const recB = records.filter(r => r._date && label(r) === periodB);

  if (!recA.length || !recB.length) return [];

  const dims = ['region', 'product_category', 'sales_channel', 'sales_rep'];
  const results = [];

  dims.forEach(dim => {
    const mapA = aggregateByDimension(recA, dim);
    const mapB = aggregateByDimension(recB, dim);
    const allKeys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);

    const contributions = [];
    allKeys.forEach(k => {
      const vA = mapA[k] ? getVal(mapA[k]) : 0;
      const vB = mapB[k] ? getVal(mapB[k]) : 0;
      const change = vB - vA;
      contributions.push({ key: k, valueA: vA, valueB: vB, change, shareOfChange: totalChange !== 0 ? change / Math.abs(totalChange) : null });
    });

    contributions.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    results.push({ dimension: dim, totalA, totalB, totalChange, contributions: contributions.slice(0, 5) });
  });

  return results;
}

function calculateScenario(records, volChangePct, priceChangePct, discountChangePp) {
  if (!records.length) return null;

  const baseRevenue = records.reduce((s, r) => s + r.sales_amount, 0);
  const baseQty = records.reduce((s, r) => s + r.quantity_sold, 0);
  const baseAvgUnitPrice = records.reduce((s, r) => s + r.unit_price, 0) / records.length;
  const baseAvgDiscount = records.reduce((s, r) => s + r.discount, 0) / records.length;

  // Apply volume change to quantity
  const scenarioQty = baseQty * (1 + volChangePct / 100);
  // Apply price change to avg unit price
  const scenarioUnitPrice = baseAvgUnitPrice * (1 + priceChangePct / 100);
  // Apply discount change (percentage point shift)
  const scenarioDiscount = Math.max(0, Math.min(1, baseAvgDiscount + discountChangePp / 100));

  // Estimated revenue = qty × unit_price × (1 − discount)
  // This is an approximation; the baseline revenue is treated as net.
  // We scale proportionally: if volume +10%, price +5%, discount unchanged → revenue ≈ +15.5%
  const volFactor  = scenarioQty / Math.max(baseQty, 1);
  const priceFactor = scenarioUnitPrice / Math.max(baseAvgUnitPrice, 1);
  const discFactor  = (1 - scenarioDiscount) / Math.max((1 - baseAvgDiscount), 0.001);

  const estimatedRevenue = baseRevenue * volFactor * priceFactor * discFactor;
  const revenueDiff = estimatedRevenue - baseRevenue;
  const revenuePctChange = safeDiv(revenueDiff, baseRevenue);

  return {
    baseRevenue,
    estimatedRevenue,
    revenueDiff,
    revenuePctChange,
    assumptions: [
      `Volume: ${volChangePct >= 0 ? '+' : ''}${volChangePct}% (from ${formatNumber(baseQty)} to ${formatNumber(Math.round(scenarioQty))} units)`,
      `Avg unit price: ${priceChangePct >= 0 ? '+' : ''}${priceChangePct}% (from ${formatCurrency(baseAvgUnitPrice)} to ${formatCurrency(scenarioUnitPrice)})`,
      `Discount rate: ${discountChangePp >= 0 ? '+' : ''}${discountChangePp}pp (from ${formatPct(baseAvgDiscount)} to ${formatPct(scenarioDiscount)})`,
      `Method: Proportional scaling — volume × price × (1−discount) factors applied to baseline net revenue.`,
      `Caveats: Does not model cost changes, mix effects, or non-linear price elasticity. Do not treat as a forecast.`,
    ],
  };
}

// ================================================================
// 8. CHART RENDERING
// ================================================================

/** Destroy and recreate a chart to prevent canvas duplication */
function upsertChart(id, config) {
  if (STATE.charts[id]) {
    STATE.charts[id].destroy();
    delete STATE.charts[id];
  }
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  STATE.charts[id] = new Chart(ctx, config);
  return STATE.charts[id];
}

function getChartTheme() {
  const isDark = STATE.theme === 'dark';
  return {
    gridColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    textColor: isDark ? '#94a3b8' : '#64748b',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipBorder: isDark ? '#334155' : '#e2e8f0',
  };
}

function baseScaleOptions(label = '') {
  const t = getChartTheme();
  return {
    border: { color: t.gridColor },
    grid: { color: t.gridColor },
    ticks: { color: t.textColor, font: { size: 10 } },
    title: label ? { display: true, text: label, color: t.textColor, font: { size: 11 } } : { display: false },
  };
}

function baseTooltipOptions() {
  const t = getChartTheme();
  return {
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    titleColor: STATE.theme === 'dark' ? '#f1f5f9' : '#0f172a',
    bodyColor: STATE.theme === 'dark' ? '#94a3b8' : '#475569',
    padding: 10,
    cornerRadius: 6,
    displayColors: true,
  };
}

// A — Sales Trend
function renderTrendChart(records) {
  const { keys, data } = aggregateSalesByDate(records, STATE.trendAgg);
  const t = getChartTheme();

  const datasets = [{
    label: 'Revenue',
    data: data.map(d => d.revenue),
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.08)',
    tension: 0.4,
    fill: true,
    pointRadius: keys.length > 30 ? 2 : 4,
    pointBackgroundColor: '#3b82f6',
    yAxisID: 'y',
  }];

  if (STATE.trendShowVolume) {
    datasets.push({
      label: 'Transactions',
      data: data.map(d => d.transactions),
      borderColor: '#06b6d4',
      backgroundColor: 'rgba(6,182,212,0.05)',
      tension: 0.3,
      fill: false,
      pointRadius: keys.length > 30 ? 1 : 3,
      borderDash: [5, 3],
      yAxisID: 'y2',
    });
  }

  // Previous period overlay
  if (STATE.trendShowPrev && keys.length >= 2) {
    const half = Math.floor(keys.length / 2);
    const prevData = [...data.slice(0, half), ...Array(keys.length - half).fill(null)];
    datasets.push({
      label: 'Prior period (offset)',
      data: prevData.map(d => d ? d.revenue : null),
      borderColor: 'rgba(139,92,246,0.5)',
      borderDash: [4, 4],
      fill: false,
      pointRadius: 2,
      yAxisID: 'y',
      spanGaps: false,
    });
  }

  // Anomaly markers
  const { anomalies } = detectSalesAnomalies(records);
  const anomalyIndices = new Set(anomalies.map(a => keys.indexOf(a.period)));

  const chart = upsertChart('chart-trend', {
    type: 'line',
    data: { labels: keys, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: t.textColor, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label === 'Revenue' || ctx.dataset.label === 'Prior period (offset)') {
                return ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`;
              }
              return ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)}`;
            },
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (anomalyIndices.has(idx)) return ['⚠ Unusual observation — investigate'];
              return [];
            },
          },
        },
      },
      scales: {
        x: { ...baseScaleOptions(), ticks: { ...baseScaleOptions().ticks, maxTicksLimit: 12 } },
        y: { ...baseScaleOptions('Revenue ($)'), ticks: { ...baseScaleOptions().ticks, callback: v => formatCurrency(v, true) } },
        ...(STATE.trendShowVolume ? {
          y2: { ...baseScaleOptions('Transactions'), position: 'right', grid: { drawOnChartArea: false }, ticks: { color: t.textColor, font: { size: 10 } } }
        } : {}),
      },
    },
  });

  // Anomaly overlay on chart
  const anomalyEl = document.getElementById('trend-anomalies');
  if (anomalies.length) {
    anomalyEl.classList.remove('hidden');
    anomalyEl.innerHTML = `⚠ ${anomalies.length} unusual period(s): ${anomalies.map(a => escapeHtml(a.label)).join(' | ')}`;
  } else {
    anomalyEl.classList.add('hidden');
  }

  // Summary
  const summaryEl = document.getElementById('trend-summary');
  if (keys.length) {
    const maxIdx = data.reduce((mi, d, i) => d.revenue > data[mi].revenue ? i : mi, 0);
    const minIdx = data.reduce((mi, d, i) => d.revenue < data[mi].revenue ? i : mi, 0);
    summaryEl.textContent = `Highest: ${keys[maxIdx]} (${formatCurrency(data[maxIdx].revenue)}) | Lowest: ${keys[minIdx]} (${formatCurrency(data[minIdx].revenue)}) | ${keys.length} periods shown`;
  }

  return chart;
}

// B — Revenue per Region
function renderRegionChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'region');
  const total = Object.values(dim).reduce((s, v) => s + v.revenue, 0);

  const sorted = Object.entries(dim).sort((a, b) => b[1].revenue - a[1].revenue);
  const labels = sorted.map(([k]) => k);
  const getMetricVal = (v) => {
    if (STATE.regionMetric === 'transactions') return v.transactions;
    if (STATE.regionMetric === 'quantity') return v.quantity;
    return v.revenue;
  };
  const values = sorted.map(([, v]) => getMetricVal(v));

  const chart = upsertChart('chart-region', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: STATE.regionMetric === 'revenue' ? 'Revenue' : STATE.regionMetric === 'transactions' ? 'Transactions' : 'Quantity',
        data: values,
        backgroundColor: CHART_PALETTE.slice(0, labels.length),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const [, v] = sorted[ctx.dataIndex];
              const rev = formatCurrency(v.revenue, true);
              const share = formatPct(v.revenue / total);
              return [`Revenue: ${rev} (${share})`, `Transactions: ${formatNumber(v.transactions)}`, `Avg Order: ${formatCurrency(v.avgOrderValue, true)}`];
            },
          },
        },
      },
      scales: {
        x: {
          ...baseScaleOptions(),
          ticks: {
            ...baseScaleOptions().ticks,
            callback: v => STATE.regionMetric === 'revenue' ? formatCurrency(v, true) : formatNumber(v),
          },
        },
        y: baseScaleOptions(),
      },
      onClick: (event, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const regionName = labels[idx];
        showRegionDrilldown(records, regionName, dim[regionName], total);
      },
    },
  });

  return chart;
}

function showRegionDrilldown(records, regionName, regionData, total) {
  const regionRecs = records.filter(r => r.region === regionName);
  const catData = aggregateByDimension(regionRecs, 'product_category');
  const chanData = aggregateByDimension(regionRecs, 'sales_channel');
  const panel = document.getElementById('region-drilldown-panel');
  const title = document.getElementById('region-drilldown-title');
  const content = document.getElementById('region-drilldown-content');

  title.textContent = `${regionName} Region — Breakdown`;

  const catRows = Object.entries(catData).sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([k, v]) => `<tr><td class="py-1 pr-4">${escapeHtml(k)}</td><td class="py-1 pr-4 num">${formatCurrency(v.revenue, true)}</td><td class="py-1 text-slate-500">${formatPct(v.revenue / regionData.revenue)}</td></tr>`).join('');

  const chanRows = Object.entries(chanData)
    .map(([k, v]) => `<tr><td class="py-1 pr-4">${escapeHtml(k)}</td><td class="py-1 pr-4 num">${formatCurrency(v.revenue, true)}</td><td class="py-1 text-slate-500">${formatPct(v.revenue / regionData.revenue)}</td></tr>`).join('');

  content.innerHTML = `
    <p class="text-slate-400 mb-1">Total revenue: <strong>${formatCurrency(regionData.revenue)}</strong> (${formatPct(regionData.revenue / total)} of all regions)</p>
    <div class="grid grid-cols-2 gap-4 mt-2">
      <div>
        <p class="font-medium text-slate-400 mb-1">By Category</p>
        <table>${catRows}</table>
      </div>
      <div>
        <p class="font-medium text-slate-400 mb-1">By Channel</p>
        <table>${chanRows}</table>
      </div>
    </div>
  `;
  panel.classList.remove('hidden');
}

// C — Revenue per Category
function renderCategoryChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'product_category');
  const total = Object.values(dim).reduce((s, v) => s + v.revenue, 0);

  const getVal = (v) => {
    if (STATE.categoryMetric === 'quantity') return v.quantity;
    if (STATE.categoryMetric === 'discount') return v.avgDiscount || 0;
    return v.revenue;
  };
  const sorted = Object.entries(dim).sort((a, b) => getVal(b[1]) - getVal(a[1]));
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => getVal(v));

  upsertChart('chart-category', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: STATE.categoryMetric,
        data: values,
        backgroundColor: CHART_PALETTE.slice(0, labels.length),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const [, v] = sorted[ctx.dataIndex];
              return [
                `Revenue: ${formatCurrency(v.revenue, true)} (${formatPct(v.revenue / total)})`,
                `Qty: ${formatNumber(v.quantity)} | Avg price: ${formatCurrency(v.avgUnitPrice, true)}`,
                `Avg discount: ${formatPct(v.avgDiscount)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ...baseScaleOptions(),
          ticks: {
            ...baseScaleOptions().ticks,
            callback: v => STATE.categoryMetric === 'revenue' ? formatCurrency(v, true) : STATE.categoryMetric === 'discount' ? formatPct(v) : formatNumber(v),
          },
        },
        y: baseScaleOptions(),
      },
      onClick: (_, elements) => {
        if (!elements.length) return;
        const cat = labels[elements[0].index];
        applyQuickFilter('category', cat);
      },
    },
  });
}

// D — Sales per Representative
function renderRepChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'sales_rep');

  const getVal = (v) => {
    if (STATE.repMetric === 'transactions') return v.transactions;
    if (STATE.repMetric === 'avg_order') return v.avgOrderValue || 0;
    if (STATE.repMetric === 'discount') return v.avgDiscount || 0;
    return v.revenue;
  };
  const sorted = Object.entries(dim).sort((a, b) => getVal(b[1]) - getVal(a[1]));
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => getVal(v));

  upsertChart('chart-rep', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: STATE.repMetric,
        data: values,
        backgroundColor: CHART_PALETTE.slice(0, labels.length),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const [, v] = sorted[ctx.dataIndex];
              return [
                `Revenue: ${formatCurrency(v.revenue, true)}`,
                `Transactions: ${v.transactions}`,
                `Avg order: ${formatCurrency(v.avgOrderValue, true)}`,
                `Avg discount: ${formatPct(v.avgDiscount)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ...baseScaleOptions(),
          ticks: {
            ...baseScaleOptions().ticks,
            callback: v => STATE.repMetric === 'revenue' ? formatCurrency(v, true)
              : STATE.repMetric === 'discount' ? formatPct(v)
              : STATE.repMetric === 'avg_order' ? formatCurrency(v, true)
              : formatNumber(v),
          },
        },
        y: baseScaleOptions(),
      },
      onClick: (_, elements) => {
        if (!elements.length) return;
        const rep = labels[elements[0].index];
        applyQuickFilter('rep', rep);
      },
    },
  });
}

// E — Customer Type Distribution
function renderCustomerTypeChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'customer_type');

  const getVal = (v) => {
    if (STATE.custMetric === 'transactions') return v.transactions;
    if (STATE.custMetric === 'quantity') return v.quantity;
    return v.revenue;
  };

  const labels = Object.keys(dim);
  const values = labels.map(k => getVal(dim[k]));
  const total = values.reduce((s, v) => s + v, 0);

  upsertChart('chart-customer-type', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ['#3b82f6', '#06b6d4'],
        borderWidth: 2,
        borderColor: STATE.theme === 'dark' ? '#0f172a' : '#ffffff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: t.textColor, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const val = ctx.raw;
              const pct = formatPct(val / total);
              const label = STATE.custMetric === 'revenue' ? formatCurrency(val, true)
                : formatNumber(val);
              return ` ${ctx.label}: ${label} (${pct})`;
            },
          },
        },
      },
    },
  });

  // Supplementary table
  const tableEl = document.getElementById('cust-type-table');
  const rows = labels.map((k, i) => {
    const val = values[i];
    const pct = formatPct(val / total);
    const display = STATE.custMetric === 'revenue' ? formatCurrency(val) : formatNumber(val);
    return `<div class="flex justify-between items-center py-1 border-b border-slate-800 text-xs">
      <span class="text-slate-300">${escapeHtml(k)}</span>
      <span class="num">${display}</span>
      <span class="text-slate-500">${pct}</span>
    </div>`;
  }).join('');
  tableEl.innerHTML = `<p class="text-xs text-slate-500 mb-1">Denominator: all ${formatNumber(total)} ${STATE.custMetric} in filtered set.</p>${rows}`;
}

// F — Payment Method
function renderPaymentChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'payment_method');

  const getVal = (v) => {
    if (STATE.payMetric === 'revenue') return v.revenue;
    if (STATE.payMetric === 'quantity') return v.quantity;
    return v.transactions;
  };

  const sorted = Object.entries(dim).sort((a, b) => getVal(b[1]) - getVal(a[1]));
  const labels = sorted.map(([k]) => k || '(Unknown)');
  const values = sorted.map(([, v]) => getVal(v));
  const total = values.reduce((s, v) => s + v, 0);

  upsertChart('chart-payment', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: STATE.payMetric,
        data: values,
        backgroundColor: CHART_PALETTE.slice(0, labels.length),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const val = ctx.raw;
              const pct = formatPct(val / total);
              const display = STATE.payMetric === 'revenue' ? formatCurrency(val, true) : formatNumber(val);
              return ` ${ctx.label}: ${display} (${pct})`;
            },
          },
        },
      },
      scales: {
        x: {
          ...baseScaleOptions(),
          ticks: {
            ...baseScaleOptions().ticks,
            callback: v => STATE.payMetric === 'revenue' ? formatCurrency(v, true) : formatNumber(v),
          },
        },
        y: baseScaleOptions(),
      },
    },
  });
}

// G — Sales Channel
function renderChannelChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'sales_channel');
  const totalRev = Object.values(dim).reduce((s, v) => s + v.revenue, 0);

  const labels = Object.keys(dim);
  const revenueData = labels.map(k => dim[k].revenue);
  const txnData = labels.map(k => dim[k].transactions);

  upsertChart('chart-channel', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: STATE.chanMetric === 'revenue' ? revenueData : txnData,
          backgroundColor: CHART_PALETTE.slice(0, labels.length),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const k = labels[ctx.dataIndex];
              const v = dim[k];
              return [
                `Revenue: ${formatCurrency(v.revenue, true)} (${formatPct(v.revenue / totalRev)})`,
                `Transactions: ${v.transactions}`,
                `Avg order: ${formatCurrency(v.avgOrderValue, true)}`,
                `Avg discount: ${formatPct(v.avgDiscount)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: baseScaleOptions(),
        y: {
          ...baseScaleOptions(),
          ticks: {
            ...baseScaleOptions().ticks,
            callback: v => STATE.chanMetric === 'revenue' ? formatCurrency(v, true) : formatNumber(v),
          },
        },
      },
    },
  });

  // Channel table
  const tableEl = document.getElementById('channel-table');
  const rows = labels.map(k => {
    const v = dim[k];
    return `<div class="flex justify-between text-xs py-1 border-b border-slate-800">
      <span class="text-slate-300">${escapeHtml(k)}</span>
      <span class="num">${formatCurrency(v.revenue, true)}</span>
      <span class="text-slate-500">AOV ${formatCurrency(v.avgOrderValue, true)}</span>
      <span class="text-slate-500">${formatPct(v.avgDiscount)} disc.</span>
    </div>`;
  }).join('');
  tableEl.innerHTML = rows;
}

// H — Scatter Plot
function renderScatterChart(records) {
  const t = getChartTheme();

  const points = records.map((r, i) => ({
    x: r.discount * 100,
    y: r.sales_amount,
    _r: r,
    _i: i,
  }));

  const datasets = [{
    label: 'Transactions',
    data: points,
    backgroundColor: 'rgba(59,130,246,0.5)',
    pointRadius: 4,
    pointHoverRadius: 6,
  }];

  // Trendline
  let trendlineNote = '';
  if (STATE.scatterShowTrendline && points.length >= 3) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const reg = linearRegression(xs, ys);
    if (reg) {
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      datasets.push({
        label: 'Linear trendline (OLS)',
        data: [
          { x: minX, y: reg.slope * minX + reg.intercept },
          { x: maxX, y: reg.slope * maxX + reg.intercept },
        ],
        type: 'line',
        borderColor: 'rgba(245,158,11,0.8)',
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
      });
      trendlineNote = `OLS trendline: slope = ${reg.slope.toFixed(2)}, intercept = ${formatCurrency(reg.intercept, true)}. Method: Ordinary Least Squares. Correlation ≠ causation.`;
    }
  }

  // Correlation stats
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const r = pearson(xs, ys);

  const statsEl = document.getElementById('scatter-stats');
  if (r !== null) {
    const strength = Math.abs(r) < 0.2 ? 'negligible' : Math.abs(r) < 0.4 ? 'weak' : Math.abs(r) < 0.6 ? 'moderate' : 'strong';
    statsEl.innerHTML = `Pearson r = <strong>${r.toFixed(3)}</strong> (${strength} ${r >= 0 ? 'positive' : 'negative'} correlation, n=${points.length}).
      <span class="text-amber-400">Correlation does not establish causation.</span>
      ${trendlineNote ? `<br><em>${escapeHtml(trendlineNote)}</em>` : ''}`;
  } else {
    statsEl.textContent = 'Insufficient data for correlation analysis.';
  }

  upsertChart('chart-scatter', {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: t.textColor, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              if (!ctx.raw._r) return `(${ctx.raw.x.toFixed(1)}%, ${formatCurrency(ctx.raw.y)})`;
              const r = ctx.raw._r;
              return [
                `Product: ${r.product_id} | ${r.product_category}`,
                `Rep: ${r.sales_rep} | ${r.region}`,
                `Channel: ${r.sales_channel} | Date: ${r.sale_date}`,
                `Revenue: ${formatCurrency(r.sales_amount)}`,
                `Discount: ${formatPct(r.discount)}`,
                `Qty: ${formatNumber(r.quantity_sold)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { ...baseScaleOptions('Discount (%)'), min: -1, ticks: { ...baseScaleOptions().ticks, callback: v => `${v}%` } },
        y: { ...baseScaleOptions('Revenue ($)'), ticks: { ...baseScaleOptions().ticks, callback: v => formatCurrency(v, true) } },
      },
    },
  });
}

// I — Top 10
function renderTop10Table(records) {
  const getSort = (r) => {
    if (STATE.topSort === 'quantity') return r.quantity_sold;
    if (STATE.topSort === 'discount') return r.discount;
    return r.sales_amount;
  };

  const sorted = [...records].sort((a, b) => getSort(b) - getSort(a)).slice(0, CONFIG.TOP_N);
  const actualCount = sorted.length;

  const thead = document.getElementById('top10-thead');
  const tbody = document.getElementById('top10-tbody');
  const note = document.getElementById('top10-count-note');

  thead.innerHTML = `<tr>
    <th>Rank</th><th>Product ID</th><th>Date</th><th>Rep</th>
    <th>Region</th><th>Category</th><th>Channel</th>
    <th>Revenue</th><th>Qty</th><th>Discount</th>
  </tr>`;

  tbody.innerHTML = sorted.map((r, i) => `<tr>
    <td class="rank-cell">#${i + 1}</td>
    <td>${escapeHtml(r.product_id)}</td>
    <td class="whitespace-nowrap">${escapeHtml(r.sale_date)}</td>
    <td>${escapeHtml(r.sales_rep)}</td>
    <td>${escapeHtml(r.region)}</td>
    <td>${escapeHtml(r.product_category)}</td>
    <td>${escapeHtml(r.sales_channel)}</td>
    <td class="num font-medium">${formatCurrency(r.sales_amount)}</td>
    <td class="num">${formatNumber(r.quantity_sold)}</td>
    <td class="num">${formatPct(r.discount)}</td>
  </tr>`).join('');

  note.textContent = actualCount < CONFIG.TOP_N
    ? `Showing ${actualCount} transactions (fewer than 10 available in current filter).`
    : `Showing top ${actualCount} by ${STATE.topSort}. Ranked within current filter. Product_id identifies the product, not a unique order.`;
}

// J — Quantity per Category
function renderQtyCategoryChart(records) {
  const t = getChartTheme();
  const dim = aggregateByDimension(records, 'product_category');
  const totalRev = Object.values(dim).reduce((s, v) => s + v.revenue, 0);
  const totalQty = Object.values(dim).reduce((s, v) => s + v.quantity, 0);

  const sorted = Object.entries(dim).sort((a, b) => b[1].quantity - a[1].quantity);
  const labels = sorted.map(([k]) => k);

  upsertChart('chart-qty-category', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Quantity Sold',
        data: sorted.map(([, v]) => v.quantity),
        backgroundColor: CHART_PALETTE.slice(0, labels.length),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              const [, v] = sorted[ctx.dataIndex];
              return [
                `Qty: ${formatNumber(v.quantity)} (${formatPct(v.quantity / totalQty)} of total qty)`,
                `Revenue: ${formatCurrency(v.revenue, true)} (${formatPct(v.revenue / totalRev)} of total revenue)`,
                `Avg selling price: ${formatCurrency(v.avgUnitPrice, true)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: { ...baseScaleOptions('Quantity'), ticks: { ...baseScaleOptions().ticks, callback: v => formatNumber(v) } },
        y: baseScaleOptions(),
      },
    },
  });

  // Volume vs revenue mix note
  const mixEl = document.getElementById('qty-mix-note');
  const highVolLowRev = sorted.filter(([, v]) => {
    const qtyShare = v.quantity / totalQty;
    const revShare = v.revenue / totalRev;
    return qtyShare > 0.25 && revShare < qtyShare * 0.75;
  });
  if (highVolLowRev.length) {
    mixEl.classList.remove('hidden');
    mixEl.innerHTML = `Revenue-mix observation: ${highVolLowRev.map(([k]) => escapeHtml(k)).join(', ')} has high quantity share but proportionally lower revenue contribution. This may reflect lower average selling price — profitability cannot be assessed without cost data.`;
  } else {
    mixEl.classList.add('hidden');
  }
}

// Pareto Chart
function renderParetoChart(records) {
  const t = getChartTheme();
  const { curve } = calculateRevenueConcentration(records, STATE.paretoDim === 'rep' ? 'sales_rep' : STATE.paretoDim === 'category' ? 'product_category' : 'region');

  const labels = curve.map(c => c.key);
  const revenues = curve.map(c => c.revenue);
  const cumulative = curve.map(c => c.cumulative * 100);

  upsertChart('chart-pareto', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revenues,
          backgroundColor: CHART_PALETTE.slice(0, labels.length),
          borderRadius: 4,
          yAxisID: 'y',
          order: 2,
        },
        {
          label: 'Cumulative %',
          data: cumulative,
          type: 'line',
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'y2',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: t.textColor, boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          ...baseTooltipOptions(),
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label === 'Cumulative %') return ` Cumulative: ${ctx.raw.toFixed(1)}%`;
              const c = curve[ctx.dataIndex];
              return ` Revenue: ${formatCurrency(c.revenue, true)} (${formatPct(c.share)})`;
            },
          },
        },
      },
      scales: {
        x: baseScaleOptions(),
        y: { ...baseScaleOptions('Revenue'), ticks: { ...baseScaleOptions().ticks, callback: v => formatCurrency(v, true) } },
        y2: {
          position: 'right',
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { color: t.textColor, font: { size: 10 }, callback: v => `${v}%` },
        },
      },
    },
  });

  // Summary
  const summaryEl = document.getElementById('pareto-summary');
  const top1 = curve[0];
  const pareto20pct = Math.ceil(curve.length * 0.2);
  const top20Revenue = curve.slice(0, pareto20pct).reduce((s, c) => s + c.revenue, 0);
  const top20Share = top20Revenue / curve.reduce((s, c) => s + c.revenue, 0);

  summaryEl.innerHTML = `Top entity: <strong>${escapeHtml(top1?.key || '—')}</strong> = ${formatPct(top1?.share || 0)} of revenue.
    Top 20% of ${STATE.paretoDim === 'rep' ? 'reps' : STATE.paretoDim}s (${pareto20pct}) = ${formatPct(top20Share)} of revenue.
    ${top20Share >= CONFIG.PARETO_WARNING_THRESHOLD ? '<span class="text-amber-400">⚠ High concentration — top 20% hold ≥80% of revenue.</span>' : ''}
    Concentration is a risk indicator only; it does not confirm fragility.`;
}

// ================================================================
// 9. KPI RENDERING
// ================================================================

function renderKPICards(records) {
  const kpis = calculateKPIs(records);
  const comparison = calculatePeriodComparison(records, 'monthly');

  const primary = [
    {
      label: 'Total Revenue',
      value: formatCurrency(kpis.totalRevenue),
      tooltip: 'Sum of sales_amount across all filtered transactions. Represents net revenue as defined in the data schema (post-discount).',
      delta: comparison ? { value: comparison.revenueChange, label: comparison.revenueChange !== null ? `vs prior half (${comparison.prevLabel})` : null } : null,
    },
    {
      label: 'Total Transactions',
      value: formatNumber(kpis.totalTransactions),
      tooltip: 'Count of rows in the filtered dataset. Each row is one transaction line. No unique order ID exists in the source; this is not a distinct-order count.',
      delta: comparison ? { value: comparison.txnChange, label: comparison.txnChange !== null ? `vs prior half` : null } : null,
    },
    {
      label: 'Total Quantity Sold',
      value: formatNumber(kpis.totalQuantity),
      tooltip: 'Sum of quantity_sold across all filtered transactions.',
      delta: null,
    },
    {
      label: 'Average Discount',
      value: formatPct(kpis.avgDiscount),
      tooltip: 'Simple average of discount rate (0–1 field) across all filtered transactions. This is an unweighted average of rates, not a revenue-weighted effective discount rate.',
      delta: null,
    },
  ];

  const secondary = [
    {
      label: 'Avg Order Value',
      value: formatCurrency(kpis.avgOrderValue),
      tooltip: 'Total revenue ÷ number of transactions.',
    },
    {
      label: 'Discounted Txn Share',
      value: formatPct(kpis.discountedSharePct),
      tooltip: 'Percentage of transactions where discount > 0.',
    },
    {
      label: 'Revenue per Rep',
      value: formatCurrency(kpis.revenuePerRep, true),
      tooltip: 'Total revenue ÷ number of unique sales representatives in the filtered set. Not adjusted for territory size, lead volume, or time in role.',
    },
    {
      label: 'Unique Reps',
      value: formatNumber(kpis.uniqueReps),
      tooltip: 'Count of distinct sales_rep values in the filtered dataset.',
    },
  ];

  const renderCard = (kpi, isSecondary = false) => {
    const deltaHtml = (() => {
      if (!kpi.delta || kpi.delta.value === null) return '';
      const v = kpi.delta.value;
      const cls = v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral';
      const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '—';
      return `<div class="kpi-delta ${cls}">${arrow} ${formatPct(Math.abs(v))} <span class="font-normal opacity-70">${escapeHtml(kpi.delta.label || '')}</span></div>`;
    })();

    return `<div class="kpi-card" role="region" aria-label="${escapeHtml(kpi.label)}">
      <div class="kpi-label">
        ${escapeHtml(kpi.label)}
        <span class="kpi-tooltip" role="tooltip" aria-label="${escapeHtml(kpi.tooltip)}">?</span>
      </div>
      <div class="kpi-value ${isSecondary ? '' : 'large'} num-bold">${kpi.value}</div>
      ${deltaHtml}
      ${isSecondary ? '' : `<div class="kpi-description">${escapeHtml(kpi.tooltip.slice(0, 80))}…</div>`}
    </div>`;
  };

  document.getElementById('kpi-primary-grid').innerHTML = primary.map(k => renderCard(k)).join('');
  document.getElementById('kpi-secondary-grid').innerHTML = secondary.map(k => renderCard(k, true)).join('');
}

// ================================================================
// 10. INSIGHTS & INTELLIGENCE PANEL RENDERING
// ================================================================

function renderInsightsPanel(records) {
  const insights = generateInsights(records);
  const el = document.getElementById('insights-list');
  if (!insights.length) {
    el.innerHTML = '<p class="text-slate-500 text-sm italic">No material insights detected at current filter level. Broaden filters or increase data volume for richer analysis.</p>';
    return;
  }
  el.innerHTML = insights.map((ins, i) => `
    <div class="insight-card">
      <span class="insight-badge ${ins.confidence}">${ins.confidence.toUpperCase()} MATERIALITY</span>
      <div class="insight-headline">${i + 1}. ${escapeHtml(ins.headline)}</div>
      <div class="insight-body">
        <span class="text-slate-400">Observed:</span> ${escapeHtml(ins.observed)}<br>
        <span class="text-slate-400">Benchmark:</span> ${escapeHtml(ins.benchmark)}<br>
        <span class="text-slate-400">Evidence:</span> ${escapeHtml(ins.evidence)}
      </div>
      <div class="insight-recommendation">→ ${escapeHtml(ins.recommendation)}</div>
      <div class="insight-caveat">⚠ ${escapeHtml(ins.caveat)}</div>
    </div>
  `).join('');
}

function renderAnomaliesPanel(records) {
  const { anomalies, note } = detectSalesAnomalies(records);
  const el = document.getElementById('anomalies-list');

  el.innerHTML = `<p class="text-xs text-slate-500 mb-3 p-2 bg-slate-800/40 rounded">${escapeHtml(note)}</p>`;

  if (anomalies.length) {
    el.innerHTML += anomalies.map(a => `
      <div class="anomaly-item">
        <div class="anomaly-dot"></div>
        <div>
          <strong class="text-slate-200">${escapeHtml(a.period)}</strong>
          <span class="text-slate-400 ml-2">${formatCurrency(a.revenue)}</span>
          <span class="text-amber-300 ml-2">${a.direction} median</span>
          <span class="text-slate-500 ml-2">Modified z = ${a.modifiedZ}</span>
          <p class="text-slate-500 mt-1">Median monthly revenue: ${formatCurrency(a.median)}. This is an unusual observation requiring investigation. It does not confirm an error or fraud.</p>
        </div>
      </div>
    `).join('');
  }
}

function renderRootCausePanel(records) {
  const { keys } = aggregateSalesByDate(records, 'monthly');
  STATE.periodOptions = keys;

  const selA = document.getElementById('rc-period-a');
  const selB = document.getElementById('rc-period-b');
  selA.innerHTML = keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
  selB.innerHTML = keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
  if (keys.length >= 2) {
    selA.value = keys[keys.length - 2];
    selB.value = keys[keys.length - 1];
  }
}

function runAndRenderRootCause(records) {
  const metric = document.getElementById('rc-metric').value;
  const periodA = document.getElementById('rc-period-a').value;
  const periodB = document.getElementById('rc-period-b').value;
  const results = runRootCauseAnalysis(records, metric, periodA, periodB);
  const out = document.getElementById('rootcause-output');

  if (!results.length) {
    out.innerHTML = '<p class="text-slate-500 italic">Insufficient data for the selected periods.</p>';
    return;
  }

  const metricLabel = metric === 'revenue' ? 'Revenue' : metric === 'transactions' ? 'Transactions' : 'Quantity';
  const totalChange = results[0].totalChange;
  const direction = totalChange >= 0 ? 'increased' : 'decreased';
  const metricFmt = metric === 'revenue' ? formatCurrency : formatNumber;

  out.innerHTML = `
    <div class="p-2 mb-3 bg-slate-800/50 rounded border border-slate-700 text-xs">
      <strong>${metricLabel} ${direction} by ${metric === 'revenue' ? formatCurrency(Math.abs(totalChange)) : formatNumber(Math.abs(totalChange))}</strong>
      from ${escapeHtml(periodA)} (${metricFmt(results[0].totalA)}) to ${escapeHtml(periodB)} (${metricFmt(results[0].totalB)}).
    </div>
    ${results.map(dim => {
      const contribs = dim.contributions.filter(c => Math.abs(c.change) > 0);
      if (!contribs.length) return '';
      return `<div class="mb-4">
        <p class="font-semibold text-slate-300 mb-2 text-xs">By ${dim.dimension.replace('_', ' ')}:</p>
        ${contribs.map(c => {
          const isPositive = c.change >= 0;
          const barWidth = Math.min(Math.abs((c.shareOfChange || 0) * 100), 100);
          const barColor = isPositive === (totalChange >= 0) ? '#3b82f6' : '#ef4444';
          return `<div class="rootcause-segment mb-1">
            <span class="text-slate-300 w-24 flex-shrink-0">${escapeHtml(c.key)}</span>
            <div class="flex-1"><div class="rootcause-bar" style="width:${barWidth}%;background:${barColor}"></div></div>
            <span class="w-28 text-right ${isPositive ? 'text-blue-400' : 'text-red-400'}">${isPositive ? '+' : ''}${metric === 'revenue' ? formatCurrency(c.change, true) : formatNumber(c.change)}</span>
            <span class="w-16 text-right text-slate-500">${c.shareOfChange !== null ? `${(c.shareOfChange * 100).toFixed(0)}% of Δ` : '—'}</span>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
    <p class="text-xs text-slate-600 italic mt-2">This decomposition identifies which segments account for the largest absolute change. These are descriptive contributions, not causal explanations. Additional context is needed to form hypotheses.</p>
  `;
}

function renderWhatIfPanel(records) {
  updateWhatIfOutput(records);
}

function updateWhatIfOutput(records) {
  const vol = parseInt(document.getElementById('wi-volume').value, 10);
  const price = parseInt(document.getElementById('wi-price').value, 10);
  const discount = parseInt(document.getElementById('wi-discount').value, 10);

  document.getElementById('wi-volume-val').textContent = `${vol >= 0 ? '+' : ''}${vol}%`;
  document.getElementById('wi-price-val').textContent = `${price >= 0 ? '+' : ''}${price}%`;
  document.getElementById('wi-discount-val').textContent = `${discount >= 0 ? '+' : ''}${discount}pp`;

  const result = calculateScenario(records, vol, price, discount);
  const out = document.getElementById('whatif-output');
  if (!result) { out.textContent = 'No data available.'; return; }

  const revClass = result.revenueDiff >= 0 ? 'text-green-400' : 'text-red-400';
  const revSign = result.revenueDiff >= 0 ? '+' : '';
  out.innerHTML = `
    <div class="grid grid-cols-3 gap-3 mb-3">
      <div class="text-center">
        <p class="text-xs text-slate-500 mb-1">Baseline Revenue</p>
        <p class="text-lg font-bold num-bold">${formatCurrency(result.baseRevenue, true)}</p>
      </div>
      <div class="text-center">
        <p class="text-xs text-slate-500 mb-1">Scenario Revenue</p>
        <p class="text-lg font-bold num-bold ${revClass}">${formatCurrency(result.estimatedRevenue, true)}</p>
      </div>
      <div class="text-center">
        <p class="text-xs text-slate-500 mb-1">Difference</p>
        <p class="text-lg font-bold num-bold ${revClass}">${revSign}${formatCurrency(result.revenueDiff, true)} (${revSign}${formatPct(result.revenuePctChange || 0)})</p>
      </div>
    </div>
    <div class="text-xs text-slate-500 space-y-1">
      <p class="font-semibold text-slate-400">Assumptions:</p>
      ${result.assumptions.map(a => `<p>• ${escapeHtml(a)}</p>`).join('')}
    </div>
  `;
}

function renderDataQualityPanel(validationResults) {
  const summaryEl = document.getElementById('dq-summary');
  const issueRate = validationResults.issues.length / validationResults.total;
  const hasErrors = validationResults.excluded.length > 0;

  summaryEl.innerHTML = `
    <div class="grid grid-cols-4 gap-3">
      <div><p class="text-slate-500">Inspected</p><p class="font-bold">${formatNumber(validationResults.total)}</p></div>
      <div><p class="text-slate-500">Valid</p><p class="font-bold text-green-400">${formatNumber(validationResults.valid)}</p></div>
      <div><p class="text-slate-500">With Issues</p><p class="font-bold ${validationResults.issues.length ? 'text-amber-400' : 'text-slate-300'}">${formatNumber(validationResults.issues.length)}</p></div>
      <div><p class="text-slate-500">Issue Rate</p><p class="font-bold ${issueRate > 0.05 ? 'text-red-400' : issueRate > 0 ? 'text-amber-400' : 'text-green-400'}">${formatPct(issueRate)}</p></div>
    </div>
    ${hasErrors ? `<p class="mt-2 text-red-400">⚠ ${validationResults.excluded.length} record(s) excluded from analysis due to schema errors.</p>` : ''}
    <p class="mt-2 text-slate-500">Records with warnings only are included in calculations. Records with errors are excluded and listed below.</p>
  `;

  // Update header badge
  const badge = document.getElementById('dq-badge');
  badge.classList.remove('hidden', 'good', 'warning', 'error');
  if (validationResults.excluded.length) {
    badge.classList.add('error');
    badge.textContent = `${validationResults.excluded.length} DQ errors`;
  } else if (validationResults.issues.length) {
    badge.classList.add('warning');
    badge.textContent = `${validationResults.issues.length} DQ warnings`;
  } else {
    badge.classList.add('good');
    badge.textContent = 'DQ clean';
  }
  badge.classList.remove('hidden');

  const issuesEl = document.getElementById('dq-issues-list');
  if (!validationResults.issues.length) {
    issuesEl.innerHTML = '<p class="text-green-400 text-xs">No data quality issues detected.</p>';
    return;
  }

  issuesEl.innerHTML = validationResults.issues.map(issue => {
    const worstSeverity = issue.issues.some(x => x.severity === 'error') ? 'error' : 'warning';
    return `<div class="dq-issue-row severity-${worstSeverity}">
      <div class="flex-1">
        <span class="font-medium text-slate-300">Row ${issue.row} (product_id: ${escapeHtml(String(issue.product_id))})</span>
        <ul class="mt-1 space-y-0.5">
          ${issue.issues.map(i => `<li class="${i.severity === 'error' ? 'text-red-400' : 'text-amber-400'}">
            [${i.severity.toUpperCase()}] ${escapeHtml(i.msg)}
          </li>`).join('')}
        </ul>
      </div>
    </div>`;
  }).join('');
}

// ================================================================
// 11. UI MANAGEMENT
// ================================================================

function populateFilterOptions(records) {
  const unique = (field) => [...new Set(records.map(r => r[field]))].sort();

  const setOpts = (id, values) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  };

  setOpts('filter-region', unique('region'));
  setOpts('filter-category', unique('product_category'));
  setOpts('filter-customer-type', unique('customer_type'));
  setOpts('filter-channel', unique('sales_channel'));
  setOpts('filter-rep', unique('sales_rep'));
  setOpts('filter-payment', unique('payment_method'));

  // Set date bounds
  const dates = records.map(r => r.sale_date).filter(Boolean).sort();
  if (dates.length) {
    document.getElementById('date-from').value = dates[0];
    document.getElementById('date-from').min = dates[0];
    document.getElementById('date-from').max = dates[dates.length - 1];
    document.getElementById('date-to').value = dates[dates.length - 1];
    document.getElementById('date-to').min = dates[0];
    document.getElementById('date-to').max = dates[dates.length - 1];
    STATE.filters.dateFrom = parseDate(dates[0]);
    STATE.filters.dateTo = parseDate(dates[dates.length - 1]);

    // Reporting period label
    document.getElementById('reporting-period').textContent = `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;
  }
}

function readFiltersFromUI() {
  const getSelected = (id) => {
    const el = document.getElementById(id);
    if (!el) return [];
    return [...el.selectedOptions].map(o => o.value);
  };

  STATE.filters.search = document.getElementById('search-input').value.trim();
  STATE.filters.region = getSelected('filter-region');
  STATE.filters.category = getSelected('filter-category');
  STATE.filters.customerType = getSelected('filter-customer-type');
  STATE.filters.channel = getSelected('filter-channel');
  STATE.filters.rep = getSelected('filter-rep');
  STATE.filters.payment = getSelected('filter-payment');

  const fromVal = document.getElementById('date-from').value;
  const toVal = document.getElementById('date-to').value;
  STATE.filters.dateFrom = fromVal ? parseDate(fromVal) : null;
  STATE.filters.dateTo = toVal ? parseDate(toVal) : null;
}

function applyQuickFilter(type, value) {
  const filterMap = {
    category: 'filter-category',
    rep: 'filter-rep',
    region: 'filter-region',
    channel: 'filter-channel',
  };
  const elId = filterMap[type];
  if (!elId) return;
  const el = document.getElementById(elId);
  if (!el) return;
  [...el.options].forEach(o => { o.selected = o.value === value; });
  onFilterChange();
}

function resetAllFilters() {
  document.getElementById('search-input').value = '';

  ['filter-region', 'filter-category', 'filter-customer-type', 'filter-channel', 'filter-rep', 'filter-payment'].forEach(id => {
    const el = document.getElementById(id);
    if (el) [...el.options].forEach(o => { o.selected = false; });
  });

  // Reset dates to full range
  const dates = STATE.raw.map(r => r.sale_date).filter(Boolean).sort();
  if (dates.length) {
    document.getElementById('date-from').value = dates[0];
    document.getElementById('date-to').value = dates[dates.length - 1];
  }

  onFilterChange();
}

function updateActiveFilterBadge() {
  const count = countActiveFilters(STATE.filters);
  const badge = document.getElementById('active-filter-badge');
  const resetBtn = document.getElementById('btn-reset-filters');

  if (count > 0) {
    badge.classList.remove('hidden');
    badge.textContent = `${count} filter${count > 1 ? 's' : ''} active`;
    resetBtn.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    resetBtn.classList.add('hidden');
  }

  // Active filters container
  const container = document.getElementById('active-filters-container');
  const chips = document.getElementById('active-filter-chips');
  const allActive = [];

  if (STATE.filters.search) allActive.push({ label: `Search: "${STATE.filters.search}"`, key: 'search' });
  if (STATE.filters.region.length) allActive.push({ label: `Region: ${STATE.filters.region.join(', ')}`, key: 'region' });
  if (STATE.filters.category.length) allActive.push({ label: `Category: ${STATE.filters.category.join(', ')}`, key: 'category' });
  if (STATE.filters.customerType.length) allActive.push({ label: `Cust. Type: ${STATE.filters.customerType.join(', ')}`, key: 'customerType' });
  if (STATE.filters.channel.length) allActive.push({ label: `Channel: ${STATE.filters.channel.join(', ')}`, key: 'channel' });
  if (STATE.filters.rep.length) allActive.push({ label: `Rep: ${STATE.filters.rep.join(', ')}`, key: 'rep' });
  if (STATE.filters.payment.length) allActive.push({ label: `Payment: ${STATE.filters.payment.join(', ')}`, key: 'payment' });

  if (allActive.length) {
    container.classList.remove('hidden');
    chips.innerHTML = allActive.map(f =>
      `<span class="filter-chip">${escapeHtml(f.label.slice(0, 40))}${f.label.length > 40 ? '…' : ''}
        <span class="chip-remove" data-filter-key="${escapeHtml(f.key)}" title="Remove filter" role="button" tabindex="0" aria-label="Remove ${escapeHtml(f.label)} filter">✕</span>
      </span>`
    ).join('');
  } else {
    container.classList.add('hidden');
  }
}

function updateRecordCountBar() {
  const el = document.getElementById('record-count-bar');
  el.textContent = `${formatNumber(STATE.filtered.length)} of ${formatNumber(STATE.raw.length)} transactions`;
}

function setActiveMetricBtn(containerSelector, activeValue) {
  document.querySelectorAll(`${containerSelector} .metric-btn`).forEach(btn => {
    const pressed = btn.dataset[Object.keys(btn.dataset)[0]] === activeValue;
    btn.classList.toggle('active', pressed);
    btn.setAttribute('aria-pressed', pressed.toString());
  });
}

function toggleTheme() {
  STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', STATE.theme);
  document.getElementById('app-body').className =
    STATE.theme === 'light'
      ? 'bg-slate-100 text-slate-900 min-h-screen font-sans antialiased transition-colors duration-300'
      : 'bg-slate-950 text-slate-100 min-h-screen font-sans antialiased transition-colors duration-300';
  document.getElementById('btn-theme').textContent = STATE.theme === 'dark' ? '☀' : '☾';
  // Re-render all charts to update colours
  renderAllCharts(STATE.filtered);
}

function switchIntelTab(tab) {
  STATE.intelTab = tab;
  ['insights', 'anomalies', 'rootcause', 'whatif', 'dq'].forEach(t => {
    const panel = document.getElementById(`intel-${t}`);
    if (panel) panel.classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('[data-intel-tab]').forEach(btn => {
    const active = btn.dataset.intelTab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active.toString());
  });
}

// ================================================================
// 12. MASTER RENDER
// ================================================================

function renderAllCharts(records) {
  renderTrendChart(records);
  renderRegionChart(records);
  renderCategoryChart(records);
  renderRepChart(records);
  renderCustomerTypeChart(records);
  renderPaymentChart(records);
  renderChannelChart(records);
  renderScatterChart(records);
  renderTop10Table(records);
  renderQtyCategoryChart(records);
  renderParetoChart(records);
}

function renderDashboard() {
  const records = STATE.filtered;

  renderKPICards(records);
  renderAllCharts(records);
  renderInsightsPanel(records);
  renderAnomaliesPanel(records);
  renderRootCausePanel(records);
  renderWhatIfPanel(records);
  renderDataQualityPanel(STATE.validationResults);
  updateRecordCountBar();
  updateActiveFilterBadge();

  // Close region drilldown on re-render
  document.getElementById('region-drilldown-panel').classList.add('hidden');
}

// ================================================================
// 13. EXPORT
// ================================================================

function arrayToCsv(headers, rows) {
  const headerRow = headers.map(escapeCsvCell).join(',');
  const dataRows = rows.map(row => row.map(escapeCsvCell).join(','));
  return [headerRow, ...dataRows].join('\r\n');
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportFilteredCsv() {
  const headers = ['product_id', 'sale_date', 'sales_rep', 'region', 'sales_amount', 'quantity_sold',
    'product_category', 'unit_cost', 'unit_price', 'customer_type', 'discount', 'payment_method', 'sales_channel'];
  const rows = STATE.filtered.map(r => headers.map(h => r[h]));
  const csv = arrayToCsv(headers, rows);
  downloadBlob(csv, `sales_filtered_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
}

function exportKpiCsv() {
  const kpis = calculateKPIs(STATE.filtered);
  const headers = ['Metric', 'Value', 'Definition'];
  const rows = [
    ['Total Revenue', kpis.totalRevenue.toFixed(2), 'Sum of sales_amount (net revenue)'],
    ['Total Transactions', kpis.totalTransactions, 'Row count in filtered set'],
    ['Total Quantity', kpis.totalQuantity, 'Sum of quantity_sold'],
    ['Average Discount', (kpis.avgDiscount * 100).toFixed(2) + '%', 'Unweighted average of discount rate'],
    ['Average Order Value', kpis.avgOrderValue?.toFixed(2) || '', 'Total revenue / transactions'],
    ['Discounted Txn Share', (kpis.discountedSharePct * 100).toFixed(2) + '%', 'Transactions with discount > 0 / total'],
    ['Revenue per Rep', kpis.revenuePerRep?.toFixed(2) || '', 'Total revenue / unique reps'],
    ['Unique Reps', kpis.uniqueReps, 'Distinct sales_rep values'],
    ['Export Timestamp', new Date().toISOString(), ''],
    ['Active Filters', countActiveFilters(STATE.filters), ''],
    ['NOTICE', 'SYNTHETIC DATA — NOT ACTUAL COMPANY PERFORMANCE', ''],
  ];
  downloadBlob(arrayToCsv(headers, rows), `sales_kpi_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
}

function exportInsightsReport() {
  const insights = generateInsights(STATE.filtered);
  const kpis = calculateKPIs(STATE.filtered);
  const lines = [
    '=== SALES INTELLIGENCE COMMAND CENTRE — INSIGHTS REPORT ===',
    `Generated: ${new Date().toISOString()}`,
    `Data source: data/sales.json (SYNTHETIC — not actual performance)`,
    `Active filters: ${countActiveFilters(STATE.filters)}`,
    `Records in scope: ${STATE.filtered.length} of ${STATE.raw.length}`,
    '',
    '--- KEY METRICS ---',
    `Total Revenue: ${formatCurrency(kpis.totalRevenue)}`,
    `Total Transactions: ${formatNumber(kpis.totalTransactions)}`,
    `Total Quantity: ${formatNumber(kpis.totalQuantity)}`,
    `Avg Discount: ${formatPct(kpis.avgDiscount)}`,
    '',
    '--- ANALYTICAL INSIGHTS ---',
    ...insights.map((ins, i) => [
      `${i+1}. ${ins.headline}`,
      `   Materiality: ${ins.confidence}`,
      `   Observed: ${ins.observed}`,
      `   Benchmark: ${ins.benchmark}`,
      `   Evidence: ${ins.evidence}`,
      `   Recommendation: ${ins.recommendation}`,
      `   Caveat: ${ins.caveat}`,
      '',
    ].join('\n')),
    '--- END REPORT ---',
  ];
  downloadBlob(lines.join('\n'), `sales_insights_${new Date().toISOString().slice(0,10)}.txt`, 'text/plain');
}

// ================================================================
// 14. EVENT WIRING
// ================================================================

function onFilterChange() {
  readFiltersFromUI();
  STATE.filtered = applyGlobalFilters(STATE.raw, STATE.filters);
  renderDashboard();
}

const debouncedSearch = debounce(onFilterChange, CONFIG.DEBOUNCE_MS);

function wireEvents() {
  // Theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Reset filters
  document.getElementById('btn-reset-filters').addEventListener('click', resetAllFilters);
  document.getElementById('btn-clear-all-filters').addEventListener('click', resetAllFilters);

  // Search (debounced)
  document.getElementById('search-input').addEventListener('input', debouncedSearch);

  // Date range
  document.getElementById('date-from').addEventListener('change', onFilterChange);
  document.getElementById('date-to').addEventListener('change', onFilterChange);

  // Multi-select filters
  ['filter-region', 'filter-category', 'filter-customer-type', 'filter-channel', 'filter-rep', 'filter-payment'].forEach(id => {
    document.getElementById(id).addEventListener('change', onFilterChange);
  });

  // Sidebar toggle (desktop)
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('filter-sidebar');
    const expand = document.getElementById('sidebar-expand');
    sidebar.classList.add('collapsed');
    expand.classList.remove('hidden');
    expand.classList.add('flex');
  });

  document.getElementById('sidebar-expand').addEventListener('click', () => {
    const sidebar = document.getElementById('filter-sidebar');
    const expand = document.getElementById('sidebar-expand');
    sidebar.classList.remove('collapsed');
    expand.classList.add('hidden');
    expand.classList.remove('flex');
  });

  // Remove filter chips
  document.getElementById('active-filter-chips').addEventListener('click', (e) => {
    const key = e.target.dataset.filterKey;
    if (!key) return;
    const filterElMap = {
      search: () => { document.getElementById('search-input').value = ''; },
      region: () => { [...document.getElementById('filter-region').options].forEach(o => o.selected = false); },
      category: () => { [...document.getElementById('filter-category').options].forEach(o => o.selected = false); },
      customerType: () => { [...document.getElementById('filter-customer-type').options].forEach(o => o.selected = false); },
      channel: () => { [...document.getElementById('filter-channel').options].forEach(o => o.selected = false); },
      rep: () => { [...document.getElementById('filter-rep').options].forEach(o => o.selected = false); },
      payment: () => { [...document.getElementById('filter-payment').options].forEach(o => o.selected = false); },
    };
    filterElMap[key]?.();
    onFilterChange();
  });

  // Export menu
  document.getElementById('btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('export-menu').classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    document.getElementById('export-menu').classList.add('hidden');
  });

  document.getElementById('export-menu').addEventListener('click', (e) => {
    const type = e.target.dataset.export;
    if (!type) return;
    document.getElementById('export-menu').classList.add('hidden');
    if (type === 'csv-filtered') exportFilteredCsv();
    else if (type === 'csv-kpis') exportKpiCsv();
    else if (type === 'insights') exportInsightsReport();
    else if (type === 'print') window.print();
  });

  // Refresh data
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.textContent = '↻ Refreshing…';
    btn.disabled = true;
    try {
      await initData();
      btn.textContent = '⟳ Refresh';
      document.getElementById('data-load-time').textContent = `Loaded ${new Date().toLocaleTimeString()} (static JSON — not live)`;
    } catch (err) {
      btn.textContent = '⟳ Refresh (failed)';
      console.error('Refresh failed:', err);
    } finally {
      btn.disabled = false;
    }
  });

  // Trend aggregation
  document.querySelectorAll('[data-agg]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.trendAgg = btn.dataset.agg;
      setActiveMetricBtn('[data-agg]', STATE.trendAgg);
      renderTrendChart(STATE.filtered);
    });
  });

  document.getElementById('trend-show-volume').addEventListener('change', (e) => {
    STATE.trendShowVolume = e.target.checked;
    renderTrendChart(STATE.filtered);
  });

  document.getElementById('trend-show-prev').addEventListener('change', (e) => {
    STATE.trendShowPrev = e.target.checked;
    renderTrendChart(STATE.filtered);
  });

  // Region metric
  document.querySelectorAll('[data-region-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.regionMetric = btn.dataset.regionMetric;
      renderRegionChart(STATE.filtered);
    });
  });

  // Category metric
  document.querySelectorAll('[data-cat-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.categoryMetric = btn.dataset.catMetric;
      renderCategoryChart(STATE.filtered);
    });
  });

  // Rep metric
  document.querySelectorAll('[data-rep-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.repMetric = btn.dataset.repMetric;
      renderRepChart(STATE.filtered);
    });
  });

  // Customer type metric
  document.querySelectorAll('[data-cust-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.custMetric = btn.dataset.custMetric;
      renderCustomerTypeChart(STATE.filtered);
    });
  });

  // Payment metric
  document.querySelectorAll('[data-pay-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.payMetric = btn.dataset.payMetric;
      renderPaymentChart(STATE.filtered);
    });
  });

  // Channel metric
  document.querySelectorAll('[data-chan-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.chanMetric = btn.dataset.chanMetric;
      renderChannelChart(STATE.filtered);
    });
  });

  // Top 10 sort
  document.querySelectorAll('[data-top-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.topSort = btn.dataset.topSort;
      renderTop10Table(STATE.filtered);
    });
  });

  // Pareto dimension
  document.querySelectorAll('[data-pareto-dim]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.paretoDim = btn.dataset.paretoDim;
      renderParetoChart(STATE.filtered);
    });
  });

  // Scatter trendline
  document.getElementById('scatter-show-trendline').addEventListener('change', (e) => {
    STATE.scatterShowTrendline = e.target.checked;
    renderScatterChart(STATE.filtered);
  });

  // Intelligence tabs
  document.querySelectorAll('[data-intel-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchIntelTab(btn.dataset.intelTab));
  });

  // Root cause run
  document.getElementById('btn-run-rootcause').addEventListener('click', () => {
    runAndRenderRootCause(STATE.filtered);
  });

  // What-if sliders
  ['wi-volume', 'wi-price', 'wi-discount'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => updateWhatIfOutput(STATE.filtered));
  });

  // Close region drilldown
  document.getElementById('btn-close-region-drilldown').addEventListener('click', () => {
    document.getElementById('region-drilldown-panel').classList.add('hidden');
  });

  // Keyboard accessibility for chip remove buttons
  document.getElementById('active-filter-chips').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const key = e.target.dataset.filterKey;
      if (key) e.target.click();
    }
  });
}

// ================================================================
// 15. INITIALISATION
// ================================================================

async function initData() {
  const json = await loadSalesData();
  STATE.meta = json._meta || {};

  const validationResults = validateSalesData(json.transactions);
  STATE.validationResults = validationResults;

  STATE.raw = normaliseSalesRecords(json.transactions, validationResults);
  STATE.filtered = [...STATE.raw];
  STATE.loadTimestamp = new Date();

  return json;
}

async function renderDashboard_init() {
  // Show app
  document.getElementById('loading-overlay').classList.add('hidden');
  document.getElementById('app-main').classList.remove('hidden');

  populateFilterOptions(STATE.raw);
  readFiltersFromUI();
  STATE.filtered = applyGlobalFilters(STATE.raw, STATE.filters);

  // Update header
  document.getElementById('data-status-dot').className = 'status-dot';
  document.getElementById('data-load-time').textContent = `Loaded ${STATE.loadTimestamp.toLocaleTimeString()} (static JSON — not live data)`;

  renderDashboard();
  wireEvents();
}

async function main() {
  document.getElementById('loading-message').textContent = 'Loading sales data…';

  try {
    await initData();
    await renderDashboard_init();
  } catch (err) {
    console.error('[Sales Intelligence] Init error:', err);
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('error-overlay').classList.remove('hidden');
    document.getElementById('error-message').textContent =
      `${err.message || 'Unknown error'}. Ensure you are running this via a local HTTP server (not file://).`;
  }
}

// Start the application
main();
