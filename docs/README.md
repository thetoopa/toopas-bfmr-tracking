# Integration Docs

Use these documents when connecting Toopa's BFMR Tracking to another financial intake system.

## Documents

- `FINANCIAL_SYSTEM_INTEGRATION.md`: high-level architecture and recommended Windows-to-Mac integration pattern.
- `API_AND_DATA_CONTRACT.md`: API endpoints and field-level data contract for `/api/data`.
- `RECONCILIATION_PLAYBOOK.md`: rules for matching BFMR/Amazon expected values against actual bank, card, cashback, and bonus data.
- `BANK_AND_CARD_RECONCILIATION_REQUIREMENTS.md`: detailed requirements for Chase Prime Visa, Chase checking, pending profit, unmatched purchases, points/cashback, and return refunds.
- `CREDIT_CAPACITY_PLANNER.md`: daily card-capacity forecast rules, inputs, lifecycle assumptions, and risk outputs.

## Main Integration Rule

For financial totals, consume accounting fields:

- `accounting_quantity`
- `accounting_purchase_total`
- `accounting_payout_total`
- `accounting_amount_paid`
- `accounting_profit`
- `accounting_excluded`
- `accounting_reason`

Do not use raw BFMR fields for financial totals unless you are intentionally auditing the source rows.

## Machine Boundary

This tracker currently runs on the Windows PC. The larger financial system runs on the Mac Mini.

Recommended data flow:

```text
Windows BFMR Tracker -> GET /api/data -> Mac Mini Financial System -> Reconciliation Reports
```

Keep private data out of GitHub. Push code and documentation improvements only.
