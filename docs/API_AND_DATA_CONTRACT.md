# API and Data Contract

This document describes the local API and payload fields another system should consume.

## Base URL

Default local URL:

```text
http://127.0.0.1:8765
```

When accessed from another machine on the same network:

```text
http://WINDOWS_PC_HOSTNAME_OR_IP:8765
```

Start the server with:

```powershell
python server.py --host 0.0.0.0 --port 8765
```

## Stable Read Endpoints

### `GET /api/health`

Returns:

```json
{ "ok": true }
```

Use this before running an import from the financial system.

### `GET /api/data`

Canonical integration endpoint.

Returns the enriched data model:

```json
{
  "records": [],
  "summary": {},
  "addons": [],
  "amazon_orders": [],
  "settings": {},
  "metadata": {}
}
```

The `records` array is the primary table for BFMR/Amazon reconciliation.

### `GET /api/amazon-orders`

Returns stored Amazon enrichment rows:

```json
{
  "ok": true,
  "amazon_orders": []
}
```

Usually the financial system should use `GET /api/data` instead because records in `/api/data` already have Amazon enrichment applied.

### `GET /api/settings`

Returns local assumptions, Chrome profile settings, and card-capacity settings. Useful for audit, but not required for normal reconciliation.

### `GET /download/workbook`

Downloads the generated standalone Excel workbook. Prefer `/api/data` for automated integration.

The workbook is designed to remain useful without the website:

- `Tracking` is the editable accounting source of truth. Its initialized quantity, spend, payout, and paid values come from the normalized `accounting_*` fields, not duplicated raw BFMR rows.
- `Dashboard`, `Monthly`, and `Checks` are formula-driven from `Tracking` and `Extra Profit`.
- `Returns` preserves return/split review context and provides manual refund-expected and refund-received inputs. Return-log values do not alter product profit unless the corresponding `Tracking` row is edited.
- `Amazon Audit` compares Amazon orders with `Tracking`, applies the visible correction map from `Settings`, and separates personal/household and cancelled purchases from BFMR inventory exceptions.
- `BFMR Source` preserves the imported export as an audit-only tab.

Cancelled rows and rows marked `Include = No` remain visible for audit but do not affect workbook spend, payout, profit, paid cash, or open payout. Product profit is `Payout Total - Subtotal + Cashback`, and pending profit is product profit on included rows whose status is not `Paid`.

## Mutation Endpoints

The financial system should normally avoid these unless intentionally controlling the tracker.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/rescrape-needed` | Run normal scrape: BFMR plus orders not yet paid. |
| `POST` | `/api/rescrape-all` | One-time full scrape including paid rows. |
| `POST` | `/api/site-sync` | Replace live BFMR rows from site extractor JSON while retaining deduplicated historical archive rows. |
| `POST` | `/api/import-bfmr-history` | Merge an older BFMR export without duplicating rows that migrated into the current tracker. |
| `POST` | `/api/amazon-orders` | Import Amazon order rows. |
| `POST` | `/api/addons` | Add manual profit item. |
| `PATCH` | `/api/addons/{id}` | Edit manual profit item. |
| `PATCH` | `/api/records/{id}` | Edit BFMR row fields. |
| `DELETE` | `/api/addons/{id}` | Remove manual profit item. |

BFMR workbook imports accept both the legacy headers (`Reserved`, `Order No.`, `Tracking`, `Subtotal`, `Received`, `Notes`) and the current all-data export headers (`Quantity`, `Order ID`, `Tracking ID`, `Sub Total`, `Quantity Received`, `Note`).

## BFMR Record Fields

Every object in `records` represents one BFMR line item after normalization and enrichment.

### Identity and source fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | number | Current local row id. Stable within the current dataset, not guaranteed forever. |
| `source_row` | number | Row position from BFMR/import source when available. |
| `item_name` | string | BFMR item/product name. |
| `status` | string | Normalized status such as `Purchased`, `Shipped`, `Return`, `Paid`, `Cancelled`, `Deadline`. |
| `status_raw` | string | Raw source status when available. |
| `date` | `YYYY-MM-DD` string | Date reserved/order date from BFMR. |
| `date_processed` | `YYYY-MM-DD` string | BFMR processed date when available. |
| `date_paid` | `YYYY-MM-DD` string | BFMR paid date when available. |
| `month_key` | `YYYY-MM` string | Month bucket derived from `date`. |
| `notes` | string | BFMR/import notes when available. |
| `historical_archive` | boolean | True when the row came from a historical export that the current BFMR tracker no longer exposes. |
| `historical_source` | string | Filename or source label for a historical archive row. |

Historical imports use order number, normalized item, quantity, reserved date, and payout total as a multiset identity. A migrated row already present in the live tracker wins; only additional missing occurrences are archived. Live site refreshes retain those archived rows so lifetime totals do not shrink when BFMR omits pre-launch history.

### Order and logistics fields

| Field | Type | Meaning |
| --- | --- | --- |
| `quantity` | number | Raw BFMR reserved quantity. |
| `received` | number | BFMR received quantity. |
| `order_number` | string | Amazon order number when known or inferred. |
| `order_number_inferred` | boolean | Present/true when the system inferred a missing order number. |
| `tracking` | string | Tracking number or BFMR tracking text. |
| `insurance` | string | BFMR insurance field. |
| `amazon_delivery_status` | string | Amazon delivery status from scrape. |
| `amazon_delivery_eta` | string | Human-readable ETA text when available. |
| `amazon_delivery_eta_date` | `YYYY-MM-DD` string | Parsed ETA date. |
| `amazon_delivery_scraped_at` | string | Timestamp from Amazon ETA scrape. |

### Raw money fields

These fields mirror BFMR/import row values and are useful for audit.

| Field | Type | Meaning |
| --- | --- | --- |
| `purchase_total` | number | Raw purchase/retail total for the BFMR row. |
| `payout_per_unit` | number | BFMR payout per unit. |
| `payout_total` | number | Raw BFMR subtotal/payout for the row. |
| `amount_paid` | number | Raw BFMR amount paid for the row. |
| `profit` | number | Raw row profit using `payout_total - purchase_total + purchase_total * cashback_rate`. |
| `purchase_is_estimate` | boolean | True when purchase value came from a fallback. |
| `price_source` | string | Source of purchase price, for example BFMR site retail price or payout fallback. |

### Accounting fields for financial totals

Use these fields for financial integration.

| Field | Type | Meaning |
| --- | --- | --- |
| `accounting_quantity` | number | Quantity counted in financial totals. |
| `accounting_purchase_total` | number | Purchase amount counted in financial totals. |
| `accounting_payout_total` | number | BFMR payout amount counted in financial totals. |
| `accounting_amount_paid` | number | Paid amount counted in financial totals. |
| `accounting_profit` | number | Profit counted in financial totals. |
| `accounting_excluded` | boolean | True when the row is raw history but excluded from totals. |
| `accounting_reason` | string | Explanation for the accounting treatment. |

Common accounting reasons:

- `Counted as BFMR row`
- `Accepted split row in return group`
- `Superseded by accepted split row in return group`
- `Scaled to BFMR paid quantity in partial return group`
- `Consolidated paid quantity from same-tracking BFMR split row`
- `Consolidated into paid row with the same tracking number`
- `BFMR returned row retained for refund review`
- `BFMR deadline row is not an active purchase`
- `BFMR closed row retained as a non-financial audit row`

`Return`/`Returned`, `Deadline`, and `Closed` rows retain raw BFMR values for audit and refund matching, while their `accounting_*` values are zero. When a paid split row shares the same order/item group, its accounting quantity and totals are scaled to the quantity BFMR actually paid. When BFMR puts the paid quantity on one row and leaves a zero-payout companion on the same order, tracking number, and item, the companion is consolidated into the paid row so the purchase is counted once.

BFMR referral rows can be marked `Paid` while their raw `amount_paid` remains zero. For a paid `Referral Bonus` row only, `accounting_amount_paid` equals its accounting payout so collected cash and open payout reconcile with BFMR payment history.

### Credit settings

`settings.credit` contains local card-capacity inputs.

| Field | Type | Meaning |
| --- | --- | --- |
| `limit` | number | Credit limit for the card used by the tracked orders. |
| `current_balance` | number | Current posted plus pending balance entered by the user or a financial integration. |
| `balance_as_of` | `YYYY-MM-DD` | Date of the balance snapshot. |
| `charge_lead_days` | integer | Days before Amazon ETA to model the expected charge. |
| `warning_utilization` | decimal | Utilization threshold for warning state. |
| `planned_payments` | array | Future card payments with `id`, `date`, `amount`, and optional `note`. |

### Amazon enrichment fields

| Field | Type | Meaning |
| --- | --- | --- |
| `account` | string | Personal, Business, BFMR Referral, Amazon unmatched, etc. |
| `account_source` | string | Why the account was assigned. |
| `amazon_order_matched` | boolean | True when order was found in imported/scraped Amazon history. |
| `amazon_profile` | string | Configured Chrome/Amazon profile label. |
| `amazon_payment_method` | string | Amazon-visible payment method text when captured. |
| `amazon_reward_text` | string | Amazon-visible cashback/reward text when captured. |
| `amazon_order_total` | number | Latest scraped Amazon order total for the matched order. |
| `amazon_counted_purchase_total` | number | Sum of BFMR accounting purchase amounts retained for this Amazon order. |
| `amazon_purchase_gap` | number | Amazon order total minus BFMR counted purchase total. Positive values require return, refund, or missing-item review. |
| `amazon_purchase_reconciliation` | string | `matched`, `allocated_down_to_amazon_total`, or `amazon_total_exceeds_bfmr_counted_rows`. |
| `accounting_purchase_original` | number | BFMR accounting purchase before an Amazon-total allocation, when adjusted. |
| `accounting_purchase_source` | string | Source of the adjusted purchase amount, such as `Amazon order total`. |
| `cashback_rate` | number | Decimal rate, for example `0.06` for 6%. |
| `cashback_rate_source` | string | Source or assumption used for the rate. |

An order that is present in BFMR but unmatched in the configured Amazon profiles keeps `amazon_order_matched == false` for review. Its account and cashback rate use the configurable no-order fallback instead of creating an `Unknown` or `Amazon unmatched` account bucket.

### Return/split review fields

| Field | Type | Meaning |
| --- | --- | --- |
| `return_group_key` | string | Group key, usually Amazon order number. |
| `return_context` | string | Why the row is considered return/split-related. |
| `split_review_needed` | boolean | True when the system refused to infer an original order. |
| `split_review_reason` | string | Explanation for manual review. |
| `split_candidate_orders` | array | Possible Amazon order numbers for review. |
| `accepted_quantity_inferred` | number | Present when paid amount implies accepted quantity. |

If BFMR repeats a full Amazon order retail total across multiple line items, the tracker allocates the Amazon order total across counted BFMR rows rather than counting it repeatedly. If Amazon is higher than the accepted BFMR rows, the tracker preserves the lower BFMR accounting spend and exposes the positive `amazon_purchase_gap`; it does not silently assume that the unmatched amount was refunded.

## Add-on Fields

Objects in `addons` represent manual profit items.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Local add-on id. |
| `category` | string | `checking_bonus`, `bfmr_referral`, `amazon_young_adult_cashback`, or `extra_profit`. |
| `description` | string | User-entered label. |
| `amount` | number | Profit amount. |
| `date` | `YYYY-MM-DD` string | Date to bucket the profit. |
| `notes` | string | Optional notes. |
| `created_at` | timestamp | Local creation timestamp. |

## Summary Fields

The `summary` object uses accounting fields. It should agree with dashboard totals.

Important fields:

| Field | Meaning |
| --- | --- |
| `orders` | Raw record count. |
| `active_orders` | Accounting rows excluding cancelled and accounting-excluded records. |
| `paid_orders` | Active accounting rows in `Paid` status. |
| `pending_orders` | Active accounting rows whose status is not `Paid`. |
| `units` | Sum of `accounting_quantity`. |
| `spend` | Sum of `accounting_purchase_total`. |
| `payout` | Sum of `accounting_payout_total`. |
| `profit` | Product accounting profit, not including manual add-ons in the backend summary. |
| `pending_profit` | Expected accounting profit from active rows whose status is not `Paid`. |
| `cash_paid` | Sum of `accounting_amount_paid`. |
| `open_payout` | Accounting payout minus accounting paid amount. |
| `estimated_purchase_rows` | Count of rows using purchase fallback estimates. |
| `monthly` | Accounting totals by month. |
| `accounts` | Accounting totals by account. |
| `top_items` | Accounting totals by item. |

Note: the browser dashboard adds manual add-ons to product profit for total displayed profit. If consuming `/api/data` directly, add `sum(addons.amount)` yourself when you want all-in profit.

## Suggested Import Snapshot Shape

The financial system should store each pull as a snapshot:

```json
{
  "source": "toopas-bfmr-tracking",
  "source_url": "http://WINDOWS_PC:8765/api/data",
  "imported_at": "2026-07-05T12:00:00-04:00",
  "metadata": {},
  "summary": {},
  "records": [],
  "addons": [],
  "amazon_orders": []
}
```

Do not mutate old snapshots. Create a new snapshot each time so changes in BFMR status, Amazon enrichment, and return accounting are auditable.
