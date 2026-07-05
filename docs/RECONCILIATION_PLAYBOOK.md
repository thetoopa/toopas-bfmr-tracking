# Financial Reconciliation Playbook

This playbook describes how the Mac Mini financial system should use BFMR tracker data to confirm expected purchases, payouts, cashback, and exceptions.

For implementation-level requirements covering Chase Prime Visa charges/rewards, Chase checking deposits, pending profit, unmatched card purchases, BFMR-only purchases, and return refund detection, read `BANK_AND_CARD_RECONCILIATION_REQUIREMENTS.md` alongside this playbook.

## Principle

Treat Toopa's BFMR Tracking as expected operational truth and the financial intake system as actual financial truth.

The BFMR tracker says:

- What was reserved, ordered, shipped, received, processed, returned, or paid.
- What Amazon order/account/cashback rate appears to apply.
- What payout/profit should be counted after return accounting.

The financial system confirms:

- Whether the Amazon/card charge actually happened.
- Whether cashback/points actually posted.
- Whether BFMR payout money actually arrived.
- Whether bank bonuses/referrals/extra profit were actually received.

## Required Import Data

Pull `GET /api/data` from the BFMR tracker and store:

- `records`
- `addons`
- `amazon_orders`
- `summary`
- `metadata`

Do not use raw `data/*.json` files directly for reconciliation. Use the API response because it applies enrichment, settings, and return accounting.

## Expected Event Generation

For each `record` where `status != "Cancelled"`:

### Amazon purchase event

Create an expected purchase event when `accounting_purchase_total > 0`.

Recommended fields:

- `event_type`: `amazon_purchase`
- `expected_amount`: `accounting_purchase_total`
- `expected_date`: `date`
- `amazon_order_number`: `order_number`
- `account`: `account`
- `item_name`: `item_name`
- `quantity`: `accounting_quantity`
- `source_record_id`: `id`
- `confidence`: high if `amazon_order_matched`, medium if no Amazon match but order number exists, low if no order number.

Match against card/bank charges using:

- Amazon order number when the financial system has it.
- Amount match within tolerance.
- Date window around the BFMR date and Amazon order date.
- Payment method/account when available.

### Expected cashback event

Create an expected cashback event when `accounting_purchase_total > 0` and `cashback_rate > 0`.

Formula:

```text
expected_cashback = accounting_purchase_total * cashback_rate
```

Recommended fields:

- `event_type`: `amazon_cashback`
- `expected_amount`: computed cashback
- `cashback_rate`: `cashback_rate`
- `cashback_rate_source`: `cashback_rate_source`
- `amazon_order_number`: `order_number`
- `account`: `account`
- `source_record_id`: `id`

Match against Chase/card reward data. If rewards post as points, convert points to cash-equivalent using the financial system's card-specific rule.

### BFMR payout event

Create an expected payout event when `accounting_payout_total > 0`.

Recommended fields:

- `event_type`: `bfmr_payout_expected`
- `expected_amount`: `accounting_payout_total`
- `actual_marked_paid_amount`: `accounting_amount_paid`
- `expected_date`: `date_processed` or `date_paid` when available, otherwise `date`
- `status`: `status`
- `source_record_id`: `id`

Match against BFMR payout deposits or payment transactions in bank data.

Important: BFMR `Paid` status is not the same thing as confirmed bank receipt. Treat it as an operational status and still reconcile it against actual bank transactions.

### Add-on profit event

For each object in `addons`, create an expected add-on event.

Categories:

- `checking_bonus`
- `bfmr_referral`
- `amazon_young_adult_cashback`
- `extra_profit`

Match against bank deposits, card reward postings, or manual confirmations depending on category.

BFMR referral bonus rows can also appear as BFMR records with item name `Referral Bonus`. The dashboard combines BFMR payment-history referral rows and manual referral add-ons for referral totals. The financial system should avoid double counting by preserving source type:

- `record.item_name == "Referral Bonus"` is a BFMR record.
- `addon.category == "bfmr_referral"` is a manual add-on.

## Return and Partial Delivery Rules

Use `accounting_*` fields for all totals.

The tracker keeps raw BFMR rows visible, but return accounting decides what counts financially:

- `accounting_excluded == true`: do not create expected financial events from the row.
- `accounting_reason == "Superseded by accepted split row in return group"`: raw BFMR history row only.
- `accounting_reason == "Accepted split row in return group"`: count the row normally.
- `accounting_reason == "Scaled to BFMR paid quantity in partial return group"`: count the scaled quantity, purchase, payout, and profit.

Rows with `split_review_needed == true` should become reconciliation exceptions, not silent matches.

## Exception Rules

Create a reconciliation exception when any of these are true:

### Missing Amazon match

Condition:

```text
order_number exists AND amazon_order_matched is false
```

Reason:

The tracker has a BFMR order number but no matching Amazon order details.

### Missing order number

Condition:

```text
order_number is blank AND accounting_purchase_total > 0
```

Reason:

Cannot reliably link to card charge, Amazon cashback, or Amazon account.

### Manual split review

Condition:

```text
split_review_needed is true
```

Reason:

Multiple same-item Amazon orders are plausible. Do not infer one automatically.

### Purchase mismatch

Condition:

```text
abs(expected_purchase - matched_financial_charge) > tolerance
```

Suggested tolerance:

- Exact match preferred.
- Small cents tolerance allowed for card-level rounding.
- Larger differences require manual review.

### Cashback mismatch

Condition:

```text
expected_cashback is materially different from posted rewards
```

This can happen when Amazon reward text was unavailable and the tracker used a default assumption.

### Payout mismatch

Condition:

```text
expected BFMR payout is not found in bank/payment data after expected clearing window
```

Use BFMR status and dates to determine urgency.

## Matching Strategy

Use tiered matching.

### Tier 1: Strong match

All available identifiers agree:

- Amazon order number.
- Account/profile.
- Amount.
- Date window.
- Payment method if available.

### Tier 2: Probable match

Amount and date align, but one identifier is missing.

Examples:

- Bank transaction does not expose Amazon order number.
- Amazon reward data exists but bank descriptor is generic.

### Tier 3: Manual review

Multiple candidates or missing critical identifiers.

Examples:

- Same item ordered multiple times near the same date.
- BFMR row lacks order number.
- Partial return created split rows.

## Suggested Tolerances

| Match Type | Default Tolerance |
| --- | --- |
| Amazon charge amount | `$0.01` |
| BFMR payout amount | `$0.01` |
| Cashback amount | `$0.05` or card-specific point rounding |
| Date window for Amazon purchase | 0 to 7 days after BFMR date |
| Date window for payout | Date paid through expected bank clearing window |

Tune these in the financial system settings.

## Status Interpretation

BFMR lifecycle order:

```text
Reserved -> Ordered/Purchased -> Shipped -> Package Received -> Processed -> Paid
```

Operational meaning:

- `Reserved`: expected future purchase, not necessarily ordered.
- `Purchased` / `Ordered`: Amazon order should exist or soon exist.
- `Shipped`: tracking/ETA should exist.
- `Package Received`: BFMR has received packages.
- `Processed`: BFMR processed the order; payout should be expected soon.
- `Paid`: BFMR marked paid; financial system should verify actual receipt.
- `Return` / `Deadline`: return/split accounting required.
- `Cancelled`: ignored for totals.

## Recommended Dashboards in the Financial System

Create these views:

- BFMR expected vs actual purchase charges.
- BFMR expected vs actual payouts.
- Expected vs posted cashback.
- Open BFMR payout by status.
- Return accounting exceptions.
- Manual add-ons awaiting confirmation.
- Orders with no Amazon match.
- Orders with no order number.
- Month-by-month BFMR profit, with raw vs accounting delta.

## Audit Columns to Preserve

Preserve these fields in the financial system even if not displayed by default:

- `purchase_total`
- `payout_total`
- `amount_paid`
- `profit`
- `accounting_purchase_total`
- `accounting_payout_total`
- `accounting_amount_paid`
- `accounting_profit`
- `accounting_reason`
- `return_context`
- `split_review_reason`
- `split_candidate_orders`
- `cashback_rate_source`
- `price_source`

These are required to explain why a total changed after a BFMR refresh or return correction.
