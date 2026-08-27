# Standalone Excel Tracker

`scripts/build_workbook.mjs` creates a standalone workbook for users who prefer Excel for daily entry. The local website remains available for imports, scraping, and browser-based analysis. The normal server download continues to write `outputs/Toopas_BFMR_Tracking.xlsx`.

## Workbook Tabs

| Tab | Purpose |
| --- | --- |
| `Dashboard` | Headline spend, payout, profit, pending profit, open payout, lifecycle, and reconciliation indicators. |
| `Add Orders` | Simple daily input. Enter blue cells only; spend, payout, cashback, profit, lifecycle, Amazon matching, month, and data-quality fields calculate automatically. |
| `Log Returns` | Simple return/refund input. Enter the return facts in blue; original-order context and refund follow-up calculate automatically. |
| `Tracking` | Detailed normalized BFMR accounting table and imported audit layer. It remains editable for corrections. |
| `Returns` | Detailed historical return, split-delivery, original-order, and refund audit. |
| `Amazon Audit` | Full Amazon order inventory with BFMR matching and manual purpose classification. |
| `Reconciliation` | Current Amazon-to-BFMR results, known ID corrections, and manually resolved gaps. |
| `Extra Profit` | Checking bonuses, automatically imported paid BFMR referrals, Amazon Young Adult cashback, and other income. |
| `Monthly` | Formula-driven monthly totals. |
| `Checks` | Source tie-outs and the overall PASS/FAIL control. |
| `Settings` | Assumptions, correction mappings, source totals, legend, and update instructions. |
| `BFMR Source` | Read-only copy of the imported BFMR export for audit. |

## Accounting Rules

- New BFMR orders should normally be entered on `Add Orders`; only the blue columns require input. Optional override columns can remain blank.
- `Tracking.Include = Yes` and `Add Orders.Include = Yes` control inclusion in financial totals.
- Imported rows retain `Source Row`. `Checks` deliberately tests only those imported rows, so new `Add Orders` rows update live totals without changing the source-snapshot tie-outs.
- Initialized Tracking inputs use `accounting_quantity`, `accounting_purchase_total`, `accounting_payout_total`, and `accounting_amount_paid` when available.
- Cancelled, deadline-only, superseded, and other accounting-excluded rows remain visible but initialize with `Include = No`.
- Profit is payout minus purchase plus cashback.
- Pending profit is profit on included rows whose status is not `Paid`.
- `Log Returns` is the preferred place for new return and refund entries. `Returns` preserves the richer historical return analysis produced by normalization.
- Return-log values do not change product profit automatically. Update the associated order only after a refund or accounting adjustment is confirmed.
- Paid BFMR `Referral Bonus` rows are automatically listed on Extra Profit and reclassified out of Product Profit. The all-in profit total does not change.
- Automatic referral matching uses date and amount to avoid duplicating an equivalent manual `BFMR Referral` entry.

## Simple Entry Workflow

1. On `Add Orders`, enter the reservation date, status, item, quantity, retail price per unit, and payout per unit.
2. Add the Amazon order number and tracking number as they become available. Account and cashback defaults are calculated from Amazon Audit and Settings; use the override columns only when needed.
3. On `Log Returns`, enter the order number, quantity returned, refund expected, and refund received. The workbook looks up the original quantity, spend, account, and Amazon status.
4. Paid BFMR referrals appear on `Extra Profit` automatically. Manually enter only bonuses and other income that are not already represented there.

## Refresh Inputs

The builder accepts optional environment variables while retaining existing defaults:

| Variable | Meaning |
| --- | --- |
| `BFMR_WORKBOOK_DATASET` | Normalized/enriched dataset JSON. |
| `BFMR_WORKBOOK_ADDONS` | Extra-profit JSON. |
| `BFMR_WORKBOOK_AMAZON` | Detailed Amazon enrichment JSON. |
| `BFMR_FULL_AMAZON_AUDIT_PATH` | Optional full Amazon history JSON for the Amazon Audit tab. |
| `BFMR_SOURCE_XLSX` | Optional raw BFMR export copied into BFMR Source. |
| `BFMR_WORKBOOK_OUTPUT` | Destination `.xlsx` path. |

Generated workbooks, previews, and private JSON remain under ignored directories and must not be committed.
