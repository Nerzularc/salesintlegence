# Sales Intelligence Command Centre — Validation Checklist

> **Purpose**: Functional and numerical validation checklist for QA, self-testing, and peer review.  
> Each item specifies the test, expected outcome, and verification method.

---

## Pre-Requisites

- Application running via local HTTP server (`python -m http.server 8000` or VS Code Live Server)
- Browser DevTools open (`F12`) with Console and Network tabs visible
- No active JavaScript errors in console before starting

---

## Section 1 — Data Loading

| # | Test | Expected | Verified |
|---|---|---|---|
| 1.1 | Open `http://localhost:8000` | Loading spinner appears, then dashboard renders without console errors | ☐ |
| 1.2 | Check Network tab | `data/sales.json` loads with HTTP 200 | ☐ |
| 1.3 | Record count bar | Shows "200 of 200 transactions" on initial load (no filters active) | ☐ |
| 1.4 | Data load timestamp | Header shows "Loaded HH:MM:SS (static JSON — not live data)" | ☐ |
| 1.5 | Synthetic data warning | Yellow ⚠ banner visible in record count bar | ☐ |

---

## Section 2 — Invalid JSON Handling

| # | Test | Expected | Verified |
|---|---|---|---|
| 2.1 | Temporarily rename `data/sales.json` to `data/sales.json.bak` and reload | Error overlay appears with a clear message. No uncaught exceptions. | ☐ |
| 2.2 | Restore the file and click "Refresh" in the command bar | Dashboard re-loads successfully. Load timestamp updates. | ☐ |
| 2.3 | Corrupt the JSON (e.g., remove opening `{`) and reload | Error overlay appears. Error message references the file path. | ☐ |

---

## Section 3 — Data Quality Observatory

| # | Test | Expected | Verified |
|---|---|---|---|
| 3.1 | Open Analytics Intelligence → Data Quality tab | Summary shows 200 records inspected | ☐ |
| 3.2 | DQ badge in header | "DQ clean" badge or warnings badge appears. No badge is hidden. | ☐ |
| 3.3 | Validation of discount field | All 200 rows have discount in [0, 1]. No discount error raised. | ☐ |
| 3.4 | Validation of sales_amount | All 200 rows have numeric, non-negative sales_amount | ☐ |
| 3.5 | Validation of sale_date | All 200 rows parse to valid 2023 dates | ☐ |

---

## Section 4 — KPI Numerical Reconciliation

Perform these calculations manually against `data/sales.json` to verify the dashboard values.

### 4.1 Total Revenue

Sum all `sales_amount` values across 200 records.

**Expected (approximate):** The application should display a total in the range **$1 000 000 – $1 200 000** based on 200 transactions with values averaging ~$5 500.

**Verification method:** Export → "CSV — KPI Summary", open in a spreadsheet, confirm `Total Revenue` matches `=SUM(sales_amount column)` from the filtered CSV export.

| Check | Result | Verified |
|---|---|---|
| KPI card "Total Revenue" visible and formatted | — | ☐ |
| KPI CSV export "Total Revenue" matches dashboard value | — | ☐ |
| Filtered CSV export: SUM of sales_amount = KPI card value | — | ☐ |

### 4.2 Total Transactions

**Expected:** 200 (full dataset, no filters)

| Check | Result | Verified |
|---|---|---|
| KPI card "Total Transactions" = 200 | ☐ | ☐ |

### 4.3 Average Discount

**Expected:** Simple average of all 200 discount values. Approximately 14–16%.

**Verification:** Sum all discount values / 200 = expected average.

| Check | Result | Verified |
|---|---|---|
| KPI "Average Discount" is between 10% and 25% | ☐ | ☐ |

### 4.4 Period Comparison

**Expected:** Two-period comparison splits the date range (Jan 2023 – Dec 2023) into two halves.  
Prior half ≈ Jan–Jun, Current half ≈ Jul–Dec.

| Check | Result | Verified |
|---|---|---|
| Delta arrows appear on Revenue and Transaction KPI cards | ☐ | ☐ |
| Comparison label mentions "prior half" | ☐ | ☐ |
| Delta percentage is non-zero (periods have different revenues) | ☐ | ☐ |

---

## Section 5 — Global Filters

### 5.1 Region Filter

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.1.1 | Select "North" in Region filter | Record count drops below 200. All charts update. | ☐ |
| 5.1.2 | Select "North" + "South" (multi-select) | Record count increases vs single region. | ☐ |
| 5.1.3 | Deselect all regions | Record count returns to 200 (all regions) | ☐ |

### 5.2 Product Category Filter

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.2.1 | Select "Electronics" | Revenue per Category chart shows only Electronics bar | ☐ |
| 5.2.2 | KPI Total Revenue matches Electronics transactions sum | Manual check via exported CSV | ☐ |

### 5.3 Customer Type Filter

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.3.1 | Select "New" | Customer Type doughnut shows only New | ☐ |
| 5.3.2 | Select "Returning" | Doughnut shows only Returning | ☐ |

### 5.4 Sales Channel Filter

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.4.1 | Select "Online" | All charts reflect online transactions only | ☐ |
| 5.4.2 | Select "Retail" | All charts reflect retail transactions only | ☐ |

### 5.5 Date Range Filter

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.5.1 | Set date-from and date-to to the same day | Record count = number of transactions on that day (may be 0) | ☐ |
| 5.5.2 | Set date range to Q1 2023 (Jan–Mar) | Record count reflects only Q1 transactions | ☐ |
| 5.5.3 | Set date-to before date-from | Record count = 0, empty states shown gracefully | ☐ |

### 5.6 Search Filter

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.6.1 | Type "Alice" in search box | Only Alice's transactions shown | ☐ |
| 5.6.2 | Type "North" in search box | Only North region transactions shown | ☐ |
| 5.6.3 | Type a nonsense string (e.g., "zzzzz") | Record count = 0, empty states shown | ☐ |

### 5.7 Combined Filters

| # | Test | Expected | Verified |
|---|---|---|---|
| 5.7.1 | Region = "East", Category = "Food", Channel = "Online" | All three filters applied simultaneously; record count < any single filter | ☐ |
| 5.7.2 | Active filter badge shows correct count (3) | Badge shows "3 filters active" | ☐ |
| 5.7.3 | Click "Reset Filters" | All filters cleared, record count = 200 | ☐ |

---

## Section 6 — Charts Respond to Filter Changes

| # | Test | Expected | Verified |
|---|---|---|---|
| 6.1 | Apply Region = North, check trend chart | Only North transactions plotted | ☐ |
| 6.2 | Apply Category = Food, check category bar | Only Food bar visible (or ranked first) | ☐ |
| 6.3 | All 10 charts re-render with updated data | No stale data visible after filter change | ☐ |
| 6.4 | KPI cards update on filter change | Values change to reflect filtered data | ☐ |

---

## Section 7 — Empty State Handling

| # | Test | Expected | Verified |
|---|---|---|---|
| 7.1 | Apply filters that produce 0 results | Charts show empty state (blank chart), no JS errors | ☐ |
| 7.2 | Top 10 table with 0 records | Table shows "0 transactions" note | ☐ |
| 7.3 | Insights panel with 0 records | Shows "No material insights" message | ☐ |
| 7.4 | Anomaly detection with < 4 periods | Shows "Insufficient history" note | ☐ |

---

## Section 8 — Chart Interactions

| # | Test | Expected | Verified |
|---|---|---|---|
| 8.1 | Click a Region bar | Drill-down panel opens with category and channel breakdown | ☐ |
| 8.2 | Click close on drill-down panel | Panel closes | ☐ |
| 8.3 | Click a Category bar | Category filter applies (cross-filter) | ☐ |
| 8.4 | Click a Rep bar | Rep filter applies | ☐ |
| 8.5 | Hover over scatter point | Tooltip shows product_id, rep, region, revenue, discount, date | ☐ |
| 8.6 | Enable trendline on scatter | OLS trendline appears with amber dashed line | ☐ |
| 8.7 | Toggle Volume overlay on trend | Second axis (Transactions) appears | ☐ |

---

## Section 9 — Duplicate Prevention

| # | Test | Expected | Verified |
|---|---|---|---|
| 9.1 | Click a metric button (e.g., Revenue → Transactions on Region chart) multiple times rapidly | Chart renders once, no duplicated canvases | ☐ |
| 9.2 | Change filter 10 times in rapid succession | Only one chart instance per chart ID in DOM | ☐ |
| 9.3 | Check `STATE.charts` in DevTools console | Each chart ID has exactly one Chart.js instance | ☐ |

---

## Section 10 — Top 10 Table

| # | Test | Expected | Verified |
|---|---|---|---|
| 10.1 | Sort by Revenue (default) | Highest sales_amount transaction at rank #1 | ☐ |
| 10.2 | Sort by Quantity | Highest quantity_sold at rank #1 | ☐ |
| 10.3 | Sort by Discount | Highest discount rate at rank #1 | ☐ |
| 10.4 | Apply filter leaving only 3 records | Table shows 3 rows, note says "3 transactions available" | ☐ |
| 10.5 | Note about product_id ≠ order ID | Footer note visible below table | ☐ |

---

## Section 11 — Scatter Plot Integrity

| # | Test | Expected | Verified |
|---|---|---|---|
| 11.1 | X-axis shows discount as percentage (0–30%) | Axis labels end in "%" | ☐ |
| 11.2 | Y-axis shows revenue in USD | Axis labels start with "$" or currency symbol | ☐ |
| 11.3 | 200 points visible with no filters | Each point = one transaction row | ☐ |
| 11.4 | Pearson r displayed in stats panel | Value is a number between -1 and 1 | ☐ |
| 11.5 | Causation disclaimer visible | "Correlation ≠ causation" text shown | ☐ |

---

## Section 12 — Scenario Simulator

| # | Test | Expected | Verified |
|---|---|---|---|
| 12.1 | All sliders at 0 | Scenario revenue = baseline revenue, difference = $0.00 | ☐ |
| 12.2 | Volume +10%, others at 0 | Scenario revenue ≈ baseline × 1.10 | ☐ |
| 12.3 | Price +10%, others at 0 | Scenario revenue ≈ baseline × 1.10 | ☐ |
| 12.4 | Volume +10%, Price +10% | Scenario revenue ≈ baseline × 1.21 (multiplicative) | ☐ |
| 12.5 | Discount +20pp (max) | Scenario revenue lower than baseline (higher discount reduces net) | ☐ |
| 12.6 | Discount -20pp (min) | Scenario revenue higher than baseline | ☐ |
| 12.7 | "Simulation — not a forecast" label visible | Caveat text visible in output | ☐ |

---

## Section 13 — Anomaly Detection

| # | Test | Expected | Verified |
|---|---|---|---|
| 13.1 | Full dataset, monthly aggregation | Number of anomalies reported (0 or more) is consistent with MAD method | ☐ |
| 13.2 | Apply filter to single month | "Insufficient history" note shown (< 4 periods) | ☐ |
| 13.3 | Anomaly markers on trend chart | If anomalies exist, tooltip mentions "Unusual observation" | ☐ |

---

## Section 14 — CSV Exports

| # | Test | Expected | Verified |
|---|---|---|---|
| 14.1 | Export filtered CSV with no filters | File contains 200 rows + 1 header | ☐ |
| 14.2 | Apply Region = East, export CSV | File contains only East region rows | ☐ |
| 14.3 | Export KPI CSV | File contains metric names, values, and definitions | ☐ |
| 14.4 | Export Insights Report | Plain text file with dated header and SYNTHETIC DATA notice | ☐ |
| 14.5 | CSV formula injection test | If any field starts with `=`, it is quoted with a `'` prefix | ☐ |

---

## Section 15 — Theme Switching

| # | Test | Expected | Verified |
|---|---|---|---|
| 15.1 | Click theme toggle (☀/☾) | Dashboard switches between dark and light modes | ☐ |
| 15.2 | All charts readable in light mode | Text colours and grid colours adapt | ☐ |
| 15.3 | Filter inputs visible in light mode | Backgrounds and borders have sufficient contrast | ☐ |
| 15.4 | KPI cards readable in both modes | Text meets minimum legibility | ☐ |

---

## Section 16 — Mobile Layout

| # | Test | Expected | Verified |
|---|---|---|---|
| 16.1 | Open Chrome DevTools → Mobile emulation (375px width) | No horizontal overflow | ☐ |
| 16.2 | KPI cards stack 2-column | Grid adapts to mobile | ☐ |
| 16.3 | Charts are readable at mobile size | Canvas containers do not overflow | ☐ |
| 16.4 | Command bar remains usable | Buttons wrap or remain accessible | ☐ |

---

## Section 17 — Console Errors

| # | Test | Expected | Verified |
|---|---|---|---|
| 17.1 | Open DevTools Console, reload, no filters | Zero errors in console | ☐ |
| 17.2 | Apply and remove all filters | Zero errors introduced | ☐ |
| 17.3 | Switch all intelligence tabs | Zero errors | ☐ |
| 17.4 | Toggle all metric buttons on all charts | Zero errors | ☐ |
| 17.5 | Run root cause analysis with valid periods | Zero errors | ☐ |

---

## Section 18 — Accessibility

| # | Test | Expected | Verified |
|---|---|---|---|
| 18.1 | Tab through all filter controls | Focus indicators visible on all interactive elements | ☐ |
| 18.2 | Tab through metric selector buttons | All buttons reachable and activatable with keyboard | ☐ |
| 18.3 | Screen reader: ARIA labels on charts | `aria-label` attributes present on all canvas elements | ☐ |
| 18.4 | Form controls have `<label>` elements | All filter inputs have associated labels | ☐ |

---

## Known Issues and Accepted Limitations

| Issue | Accepted? | Notes |
|---|---|---|
| No unique order ID — transaction count ≠ order count | Yes | Disclosed in UI, README, and tooltips |
| No gross margin calculation | Yes | Disclosed — insufficient cost model in source data |
| Period comparison uses equal-length halves (not calendar quarters) | Yes | Disclosed in KPI tooltip |
| Anomaly detection not meaningful with < 4 monthly periods | Yes | Handled gracefully with message |
| Pearson r may be unreliable for small n | Yes | n shown in stats panel |
| No persistent filter state (URL params) | Partial | URL param preservation not implemented in v1.0 |

---

*Validation checklist for Sales Intelligence Command Centre v1.0*  
*Data: synthetic | Run via HTTP server only*
