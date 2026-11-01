# Sales Intelligence Command Centre

> **⚠ SYNTHETIC DATA NOTICE**  
> The dataset (`data/sales.json`) is derived from the file `200_sales_data.csv` for **demonstration and testing purposes only**.  
> These figures do **not** represent actual company performance, real customers, or real transactions.

---

## Overview

A production-minded, browser-only Sales Analytics Platform that transforms raw transaction-level JSON data into an interactive, decision-oriented business intelligence application.

Built with: **HTML5 · Tailwind CSS (CDN) · Chart.js (CDN) · Vanilla JavaScript (ES6+)**  
No backend, no build step, no frameworks.

---

## Project Structure

```
sales-intelligence-command-centre/
├── index.html          ← Semantic application shell
├── style.css           ← Design tokens, themes, component styles
├── script.js           ← Complete application logic (~1 000 lines)
├── data/
│   └── sales.json      ← Transaction data (synthetic — see notice above)
├── README.md           ← This file
└── tests/
    └── validation-checklist.md ← Functional and numerical validation
```

---

## Local Execution (Required)

> **`fetch()` of a local file does NOT reliably work when `index.html` is opened via `file://`.**  
> You MUST serve the project through a local HTTP server.

### Option 1 — Python (recommended, zero dependencies)

```bash
cd sales-intelligence-command-centre
python -m http.server 8000
```

Then open: **http://localhost:8000**

### Option 2 — VS Code Live Server

1. Install the **Live Server** extension by Ritwick Dey.
2. Right-click `index.html` → **"Open with Live Server"**.

### Option 3 — Node.js / npx

```bash
npx serve .
```

---

## Data Schema

Each record in `data/sales.json` (`transactions` array) follows this structure:

| Field | Type | Description |
|---|---|---|
| `product_id` | string | Product identifier. **Reused across transactions** — not a unique order ID. |
| `sale_date` | string (YYYY-MM-DD) | Transaction date |
| `sales_rep` | string | Sales representative name |
| `region` | string | Geographic region: `North`, `South`, `East`, `West` |
| `sales_amount` | number | **Net revenue for this transaction (USD)**. Treated as post-discount. |
| `quantity_sold` | number | Units sold |
| `product_category` | string | Category: `Furniture`, `Clothing`, `Food`, `Electronics` |
| `unit_cost` | number | Cost per unit (USD) |
| `unit_price` | number | List price per unit before discount (USD) |
| `customer_type` | string | `New` or `Returning` |
| `discount` | number | Discount rate as decimal (0.00 – 1.00). Example: 0.15 = 15% |
| `payment_method` | string | `Cash`, `Credit Card`, `Bank Transfer` |
| `sales_channel` | string | `Online` or `Retail` |

### Important Revenue Definition

> **`sales_amount` is treated as net revenue (post-discount).**  
> Gross revenue can be estimated as `quantity_sold × unit_price`.  
> This application does NOT subtract the discount a second time.

### No Unique Order / Transaction ID

The source CSV has no `order_id` or unique transaction identifier.  
`product_id` identifies the **product**, not the order.  
All "transaction counts" in this application count **rows**, not distinct orders.  
This is explicitly noted throughout the UI.

---

## Analytical Assumptions

1. **Revenue** = `sales_amount` (net, post-discount, per row).
2. **Transaction count** = row count (no deduplication possible without a unique order ID).
3. **Gross revenue** = `quantity_sold × unit_price` (estimable but not displayed as a primary KPI to avoid confusion with `sales_amount`).
4. **Profitability**: Not calculated. `unit_cost` and `unit_price` are per-unit list figures. Gross margin would require consistent application of costs across all units in the row, which the source data does not clearly support for every record.
5. **Currency**: All values assumed to be USD. No multi-currency conversion is applied.
6. **Average Discount**: Unweighted average of discount rates. This is NOT a revenue-weighted effective discount rate.
7. **Period comparison**: Splits the filtered date range into two equal halves. Periods are not seasonally adjusted. Incomplete periods are not flagged separately.
8. **Anomaly detection**: Uses Median Absolute Deviation (MAD) with a modified z-score threshold of 2.5. Requires ≥ 4 monthly periods. Anomalies are labelled as unusual observations requiring investigation, not confirmed errors.
9. **Correlation**: Pearson r is reported for the discount-vs-revenue scatter. Sample size is noted. Correlation does not establish causation.
10. **What-If scenarios**: Proportional scaling of volume, price, and discount factors applied to baseline net revenue. Does not model cost changes, mix shifts, or non-linear elasticity. Outputs are labelled as simulations, not forecasts.

---

## Features

### Executive KPIs
- Total Revenue, Total Transactions, Total Quantity Sold, Average Discount
- Average Order Value, Discounted Transaction Share, Revenue per Rep, Unique Reps
- Period-over-period comparison (prior vs current half of date range)
- Tooltips with formula definitions

### Global Filters (update all components)
- Region, Product Category, Customer Type, Sales Channel (multi-select)
- Sales Representative, Payment Method (multi-select)
- Date range
- Full-text search (rep, region, product ID, category, channel, payment method)
- Active filter chips with individual removal

### Ten Analytical Charts
| # | Chart | Interaction |
|---|---|---|
| A | Sales Trend (line) | Daily/weekly/monthly · Volume overlay · Prior period |
| B | Revenue per Region (horizontal bar) | Click → category/channel drill-down |
| C | Revenue per Category (horizontal bar) | Click → cross-filter by category |
| D | Sales per Representative (horizontal bar) | Click → cross-filter by rep |
| E | Customer Type Distribution (doughnut) | Revenue/transaction/quantity switch |
| F | Payment Method Usage (horizontal bar) | Transaction/revenue/quantity switch |
| G | Sales Channel Distribution (bar) | Revenue/transaction switch |
| H | Discount vs Sales (scatter) | Trendline toggle · Pearson r |
| I | Top 10 Highest Sales (table) | Sort by revenue/qty/discount |
| J | Quantity Sold per Category (horizontal bar) | Revenue-mix observation note |

### Analytics Intelligence Panel
| Tab | Feature |
|---|---|
| Insights | Up to 8 auto-generated, ranked, evidenced observations with recommendations and caveats |
| Anomalies | MAD-based anomaly detection with sensitivity notes |
| Root Cause | Period-over-period contribution decomposition by region, category, channel, rep |
| What-If | Interactive revenue scenario simulator (volume / price / discount levers) |
| Data Quality | Schema validation report: missing fields, invalid dates, out-of-range values |

### Export Options
- CSV — Filtered Transactions (formula-injection-safe)
- CSV — KPI Summary (with calculation definitions)
- Insights Report (plain text)
- Print / Save as PDF (print-optimised stylesheet)

---

## Limitations

| Limitation | Detail |
|---|---|
| No unique transaction ID | Cannot deduplicate orders. Row count ≠ order count. |
| No customer ID | Customer concentration analysis is unavailable. Revenue per customer cannot be computed. |
| Single-currency | Multi-currency comparison not supported. |
| No gross margin | Profitability analysis unavailable without a consistent cost model. |
| Static JSON | Not connected to a live database. "Refresh" re-fetches the same file. |
| Seasonality | Dataset spans ~12 months (2023). Seasonal decomposition is not meaningful. |
| Small dataset | 200 rows. Some statistical analyses (e.g., correlation, anomaly detection) have limited power. |
| No line-item grouping | Cannot aggregate multiple rows into a single order without an order ID. |

### When to extend this architecture

For datasets with > 10 000 rows, consider:
- Web Workers for aggregation off the main thread
- Server-side pre-aggregation (Node.js/Python API)
- DuckDB-Wasm for in-browser SQL analytics
- IndexedDB or SQLite-Wasm for persistent local storage

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Blank page or "Data Load Failed" | Open via HTTP server, not `file://`. See Local Execution above. |
| Charts not rendering | Ensure `https://cdn.jsdelivr.net` is reachable. Check browser console for errors. |
| Tailwind styles not applying | Ensure `https://cdn.tailwindcss.com` is reachable. |
| Filters not updating | Click any filter control, then check the browser console for JavaScript errors. |
| Export downloads empty file | Ensure the filtered dataset has at least one record. |

---

## CDN Dependencies

| Library | Version | URL |
|---|---|---|
| Tailwind CSS | (latest) | `https://cdn.tailwindcss.com` |
| Chart.js | 4.4.4 | `https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js` |

No other external dependencies. All logic is in `script.js`.

---

## Security Notes

- No `eval()` used.
- User-controlled values are escaped with `escapeHtml()` before insertion into `innerHTML`.
- CSV exports use `escapeCsvCell()` to prevent formula injection.
- No external network requests beyond CDN libraries and the local JSON file.

---

*Generated for demonstration purposes. All data is synthetic.*
