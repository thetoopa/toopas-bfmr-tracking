# BFMR Tracker to Financial System Integration

This document explains how Toopa's BFMR Tracking should connect to the larger financial intake system running on the Mac Mini.

## System Boundary

Toopa's BFMR Tracking is the source of truth for BFMR order lifecycle and BFMR/Amazon enrichment:

- BFMR reservation rows, statuses, quantities, payout values, dates, tracking, and paid amounts.
- Amazon order enrichment from configured Chrome profiles.
- Amazon account classification as Personal or Business.
- Cashback rate assumptions and visible Amazon reward evidence.
- Return and partial-delivery accounting adjustments.
- Manual profit add-ons such as checking bonuses, BFMR referrals, Amazon Young Adult Cashback, and extra profit.

The financial intake system is the source of truth for actual money movement:

- Bank deposits and withdrawals.
- Credit card charges and payments.
- Rewards/points/cashback actually posted.
- Loans, bills, and other non-BFMR financial accounts.
- Pokemon/ordertracker.app orders if those are separate business lines.

The integration should not make either system overwrite the other. The financial system should consume BFMR tracker output, reconcile it against actual financial activity, and report mismatches.

## Recommended Integration Pattern

Preferred pattern: pull from the BFMR tracker API.

1. Run the Windows BFMR tracker:

```powershell
python server.py --host 0.0.0.0 --port 8765
```

1. From the Mac Mini, fetch:

```bash
curl http://WINDOWS_PC_HOSTNAME_OR_IP:8765/api/data
```

1. Store the pulled payload as an immutable financial-system import snapshot.
1. Reconcile that snapshot against financial transactions.

If the Mac Mini is not on the same network, use a private VPN, Tailscale, or a temporary tunnel. Do not publish private financial endpoints broadly.

Fallback pattern: file bridge.

1. Open the BFMR tracker locally on Windows.
1. Download the workbook from `/download/workbook` or export `/api/data` JSON.
1. Move the file to the Mac Mini through a private synced folder or manual transfer.
1. Import it into the financial system as a dated snapshot.

Do not use GitHub for private data transfer. GitHub should receive code and docs only.

## Canonical Consumption Endpoint

Use:

```text
GET /api/data
```

The response includes:

- `records`: enriched BFMR line items.
- `summary`: accounting-correct dashboard totals.
- `addons`: manual profit add-ons.
- `amazon_orders`: captured Amazon order history details.
- `settings`: local assumptions used to enrich the data.
- `metadata`: generation and Amazon match metadata.

Use `/api/data` instead of reading `data/*.json` directly. The raw JSON files do not always contain the latest enrichment, return inference, settings, or accounting fields until they pass through `read_dataset()`.

## Raw Fields vs Accounting Fields

BFMR can retain multiple lifecycle rows for the same real-world order event. For example, a reservation can later appear as a deadline, return, and accepted paid split. Raw BFMR values are kept for audit, but financial totals must use accounting fields.

Use these fields for reconciliation totals:

- `accounting_quantity`
- `accounting_purchase_total`
- `accounting_payout_total`
- `accounting_amount_paid`
- `accounting_profit`
- `accounting_excluded`
- `accounting_reason`

Do not sum these raw fields for financial totals:

- `quantity`
- `purchase_total`
- `payout_total`
- `amount_paid`
- `profit`

Raw fields are still useful for debugging and for showing the exact BFMR table.

## Data Ownership

Use this ownership model:

| Data | Owner | Notes |
| --- | --- | --- |
| BFMR status/lifecycle | BFMR tracker | Use BFMR site/export data. |
| Amazon account classification | BFMR tracker | Derived from Amazon profile scraping, not order number prefix. |
| Cashback rate estimate | BFMR tracker | Uses Amazon visible reward text when available, otherwise settings assumptions. |
| Actual card charge | Financial system | Confirmed from Chase/card/bank data. |
| Actual cashback/points posted | Financial system | Confirmed from card rewards data. |
| Actual BFMR payout deposit | Financial system | Confirmed from bank/payment account data. |
| Manual bonuses | BFMR tracker initially, financial system confirms | Checking bonuses/referrals/cashback add-ons should reconcile to actual deposits or rewards. |

## Integration Workflow

1. Pull `/api/data` from the Windows tracker.
1. Validate `metadata.amazon_enriched_at` and `metadata.amazon_matched_orders`.
1. Load `records` into a staging table as a dated snapshot.
1. For each active record, create expected financial events:
   - Amazon purchase charge for `accounting_purchase_total`.
   - Expected card cashback of `accounting_purchase_total * cashback_rate`.
   - Expected BFMR payout of `accounting_payout_total`.
   - Actual BFMR paid amount of `accounting_amount_paid` when present.
1. Match expected events against bank/card/rewards transactions.
1. Flag unmatched or materially different values.
1. Preserve both raw and accounting values for audit.

## Important Rules

- Cancelled BFMR rows are ignored for financial totals.
- Referral bonus rows are BFMR income and do not get Amazon cashback.
- Business Amazon orders default to the configured business cashback rate unless stronger evidence exists.
- No-order rows default to the configured no-order account and cashback assumptions.
- Order number prefixes are not reliable account identifiers.
- Return and partial-delivery rows must use accounting fields, not raw BFMR fields.
- Paid status means BFMR marks the row as paid; the financial system should still confirm the actual deposit.

## Minimum Mac Mini Import Tables

The financial system should create or map to these logical tables:

- `bfmr_snapshot`
- `bfmr_order_line`
- `bfmr_profit_addon`
- `amazon_order_enrichment`
- `financial_transaction`
- `expected_financial_event`
- `reconciliation_match`
- `reconciliation_exception`

The most important table is `bfmr_order_line`, keyed by a stable snapshot id plus BFMR row id or source row.

## Recommended Reconciliation Outputs

The Mac Mini system should report:

- BFMR expected payout vs actual bank deposits.
- Amazon expected spend vs actual card charges.
- Expected cashback vs posted points/cashback.
- Orders with Amazon match missing.
- Orders with no tracking.
- Orders with return accounting adjustments.
- Orders where raw BFMR totals differ from accounting totals.
- Manual bonuses not found in bank/reward data.

## Private Data Handling

Keep private data local to your machines:

- Do not commit `data/`, `uploads/`, `outputs/`, `logs/`, exported workbooks, financial exports, or scraped JSON.
- Do not put bank/card/Amazon/BFMR account data into GitHub issues unless redacted.
- Push integration code and docs to GitHub, not live data.
