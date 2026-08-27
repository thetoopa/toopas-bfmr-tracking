# Standalone Excel Tracker

`scripts/build_workbook.mjs` creates a standalone workbook for users who prefer Excel over the local website. The normal server download continues to write `outputs/Toopas_BFMR_Tracking.xlsx`.

## Workbook Tabs

| Tab | Purpose |
| --- | --- |
| `Dashboard` | Headline spend, payout, profit, pending profit, open payout, lifecycle, and reconciliation indicators. |
| `Tracking` | Editable BFMR accounting table and the workbook's operational source of truth. |
| `Returns` | Return, split-delivery, original-order, and refund follow-up log. |
| `Amazon Audit` | Full Amazon order inventory with BFMR matching and manual purpose classification. |
| `Reconciliation` | Current Amazon-to-BFMR results, known ID corrections, and manually resolved gaps. |
| `Extra Profit` | Checking bonuses, BFMR referrals not already represented in Tracking, Amazon Young Adult cashback, and other income. |
| `Monthly` | Formula-driven monthly totals. |
| `Checks` | Source tie-outs and the overall PASS/FAIL control. |
| `Settings` | Assumptions, correction mappings, source totals, legend, and update instructions. |
| `BFMR Source` | Read-only copy of the imported BFMR export for audit. |

## Accounting Rules

- `Tracking.Include = Yes` controls inclusion in financial totals.
- Imported rows retain `Source Row`; manually added rows should leave it blank so snapshot tie-outs continue to test only the original import.
- Initialized Tracking inputs use `accounting_quantity`, `accounting_purchase_total`, `accounting_payout_total`, and `accounting_amount_paid` when available.
- Cancelled, deadline-only, superseded, and other accounting-excluded rows remain visible but initialize with `Include = No`.
- Profit is payout minus purchase plus cashback.
- Pending profit is profit on included rows whose status is not `Paid`.
- The Returns tab is an audit and refund workflow. Refund inputs do not change product profit automatically; update the corresponding Tracking row when an accounting adjustment is confirmed.
- BFMR `Referral Bonus` rows already in Tracking are product profit. Do not enter the same payment again on Extra Profit.

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
