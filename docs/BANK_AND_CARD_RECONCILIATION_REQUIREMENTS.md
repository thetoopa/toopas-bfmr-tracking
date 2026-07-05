# Bank and Card Reconciliation Requirements

This document defines the financial reconciliation behavior expected from the Mac Mini financial intake system.

## Goal

The financial system must compare BFMR/Amazon operational data against actual bank, credit card, and rewards data.

It should answer:

- Did every BFMR/Amazon purchase appear on the correct card?
- Did every Amazon card charge map back to BFMR or another known order system?
- Did every BFMR expected payout appear in Chase checking or another payout account?
- How much profit is still pending because charges, refunds, rewards, or payouts have not fully posted?
- How much extra money was earned from points/cashback?
- Which returns have been refunded and which are still open?
- Which transactions are unrelated, suspicious, duplicated, or unclassified?

## Required Financial Sources

Minimum supported sources:

- Chase Prime Visa credit card transactions.
- Chase Prime Visa rewards/points/cashback data.
- Chase checking account transactions.
- BFMR tracker `/api/data`.
- Amazon orders scraped by the BFMR tracker.
- BFMR export/all tracker data via the BFMR tracker.

Additional supported sources:

- Other credit cards.
- Other checking/savings accounts.
- Loans and bills.
- Pokemon/ordertracker.app orders.
- Any other known order or business workflow.

The Mac Mini system owns financial ingestion. The Windows BFMR tracker owns BFMR/Amazon operational enrichment.

## Canonical BFMR Input

Pull:

```text
GET http://WINDOWS_PC_HOSTNAME_OR_IP:8765/api/data
```

Use `accounting_*` fields for all financial totals:

- `accounting_quantity`
- `accounting_purchase_total`
- `accounting_payout_total`
- `accounting_amount_paid`
- `accounting_profit`
- `accounting_excluded`
- `accounting_reason`

Do not use raw BFMR fields for totals unless producing an audit comparison.

## Required Financial Transaction Model

Normalize every bank/card/rewards item into a common model.

Suggested transaction fields:

| Field | Meaning |
| --- | --- |
| `source_system` | Chase, Amazon, ordertracker.app, manual import, etc. |
| `source_account_name` | Human-readable account name, for example Chase Prime Visa or Chase Checking. |
| `source_account_type` | `credit_card`, `checking`, `savings`, `loan`, `bill`, `reward`, etc. |
| `transaction_id` | Stable source id when available; otherwise generated fingerprint. |
| `posted_date` | Posted date. |
| `authorized_date` | Authorization/pending date when available. |
| `status` | `pending`, `posted`, `reversed`, `refunded`, `unknown`. |
| `description` | Raw transaction description. |
| `merchant` | Normalized merchant when available. |
| `amount` | Signed amount. Use one consistent convention. |
| `currency` | Usually USD. |
| `card_last4` | Last 4 digits when available. |
| `reward_points` | Points earned or redeemed when available. |
| `reward_cash_value` | Cash-equivalent value when available or computed. |
| `raw_payload` | Original source record for audit. |

## Amount Sign Convention

Use one convention everywhere:

- Purchases/charges are positive expenses.
- Refunds/credits are negative expenses.
- Deposits/income are positive income.
- Payments to credit cards are transfers, not profit or expense.

If a source exports opposite signs, normalize during import and preserve the raw value in `raw_payload`.

## Expected Event Model

Generate expected events from BFMR records.

### Amazon purchase expected event

For each BFMR record where:

```text
status != Cancelled
accounting_purchase_total > 0
accounting_excluded != true
```

Create:

| Field | Value |
| --- | --- |
| `event_type` | `amazon_purchase_expected` |
| `expected_amount` | `accounting_purchase_total` |
| `expected_date` | `date` or Amazon order date when available |
| `order_number` | `order_number` |
| `account` | `account` |
| `source_record_id` | BFMR record id |
| `source_item_name` | BFMR item name |
| `confidence` | Based on Amazon match and order number quality |

### Cashback expected event

For each purchase event:

```text
expected_cashback = accounting_purchase_total * cashback_rate
```

Create:

| Field | Value |
| --- | --- |
| `event_type` | `cashback_expected` |
| `expected_amount` | computed cashback cash value |
| `expected_points` | computed if card uses points |
| `cashback_rate` | BFMR tracker `cashback_rate` |
| `cashback_rate_source` | BFMR tracker `cashback_rate_source` |
| `order_number` | Amazon order number |

The Chase Prime Visa should verify both rate and posted value. If Chase exports points instead of dollars, convert using the Chase point value configured in the financial system.

### BFMR payout expected event

For each BFMR record where:

```text
accounting_payout_total > 0
accounting_excluded != true
```

Create:

| Field | Value |
| --- | --- |
| `event_type` | `bfmr_payout_expected` |
| `expected_amount` | `accounting_payout_total` |
| `amount_marked_paid_by_bfmr` | `accounting_amount_paid` |
| `expected_date` | `date_paid`, `date_processed`, or `date` |
| `status` | BFMR status |
| `source_record_id` | BFMR record id |

BFMR marked paid is not proof that Chase checking received money. The Chase checking data confirms receipt.

### Refund expected event

For return/split rows, infer refund expectations from accounting deltas:

- Raw purchase total minus accounting purchase total indicates purchase amount that should not remain as final card spend.
- Raw payout total minus accounting payout total indicates BFMR payout that should not be expected.
- Rows with `accounting_excluded == true` are raw BFMR history rows, not new financial events.

Create refund review events for groups where:

```text
return_context exists OR accounting_reason references return/split OR split_review_needed == true
```

The system should search card transactions for matching refunds/credits from Amazon.

## Matching Rules

### Match BFMR purchase to Chase Prime Visa charge

Primary match inputs:

- Amazon order number, if transaction details expose it.
- Amount equal to `accounting_purchase_total`.
- Merchant is Amazon or Amazon Marketplace.
- Transaction date within expected window.
- Account/card matches expected Amazon profile/payment method when available.

Secondary match inputs:

- Same amount and date but no order number.
- Item/order metadata from Amazon scrape.
- Multiple BFMR rows belonging to the same Amazon order.

If one card charge covers multiple BFMR rows, support many-to-one matching:

```text
sum(accounting_purchase_total for candidate BFMR rows) == card_charge_amount
```

### Match Chase Prime Visa charge to BFMR or known order source

Every Amazon/retail charge on the Chase Prime Visa should be classified as one of:

- BFMR order.
- Pokemon/ordertracker.app order.
- Personal purchase.
- Business/non-BFMR purchase.
- Unknown/unmatched.

Create an exception when:

```text
card transaction merchant is Amazon-like
AND transaction is not matched to BFMR, Pokemon/ordertracker.app, or an allowed personal/business category
```

This answers: "Do we have purchases on the card not found on BFMR?"

### Match BFMR expected purchase without card charge

Create an exception when:

```text
BFMR accounting_purchase_total > 0
AND no matching posted or pending card transaction exists
AND status is Purchased/Shipped/Package Received/Processed/Paid
```

This answers: "Do we have BFMR purchases not found on the card?"

If the matching card transaction is pending, show it as pending confirmation, not missing.

### Match BFMR payout to Chase checking

Match against Chase checking deposits using:

- Amount equal to `accounting_amount_paid` or `accounting_payout_total`.
- Description containing BFMR or known payout processor text.
- Date around `date_paid` or expected payout window.

If BFMR says paid but Chase checking has no matching deposit, create:

```text
exception_type = bfmr_paid_not_found_in_checking
```

If Chase checking has a BFMR-like deposit not linked to BFMR records, create:

```text
exception_type = checking_deposit_not_linked_to_bfmr
```

### Match cashback/points

For each Chase Prime Visa purchase match:

1. Compute expected cashback from BFMR tracker.
1. Pull actual Chase points/rewards earned.
1. Convert points to cash value.
1. Compare expected vs actual.

Create an exception when:

```text
abs(expected_cashback - actual_cashback_value) > configured_tolerance
```

The dashboard should separate:

- Expected cashback pending.
- Cashback posted.
- Cashback mismatch.
- Cashback rate assumed rather than verified.

## Pending Profit Calculation

The system should report these separate values:

| Metric | Formula |
| --- | --- |
| Expected product profit | Sum of `accounting_profit` from BFMR records. |
| Posted purchase spend | Sum of matched posted card charges. |
| Pending purchase spend | Sum of matched pending card charges. |
| Expected cashback | Sum of `accounting_purchase_total * cashback_rate`. |
| Posted cashback | Sum of confirmed Chase rewards cash value. |
| Pending cashback | Expected cashback minus posted cashback for matched/pending purchases. |
| Expected BFMR payout | Sum of `accounting_payout_total`. |
| BFMR marked paid | Sum of `accounting_amount_paid`. |
| Bank-confirmed BFMR payout | Sum of matched Chase checking deposits. |
| Pending BFMR payout | Expected BFMR payout minus bank-confirmed payout. |
| Realized profit | Bank-confirmed payout + posted cashback + confirmed add-ons - posted purchase spend. |
| Pending profit | Expected product profit + expected add-ons - realized profit, with pending/posted split shown. |

Do not collapse all pending values into one number. The user needs to know whether profit is pending because of card posting, rewards posting, BFMR processing, BFMR payment, or bank deposit timing.

## Return and Refund Detection

For return/split groups, the system should show:

- Original BFMR rows.
- Counted accounting rows.
- Excluded accounting rows.
- Expected refund amount if any.
- Card refund transaction matched or missing.
- BFMR payout reduced or missing as expected.
- Net realized profit after refund and accepted items.

Refund statuses:

| Status | Meaning |
| --- | --- |
| `not_expected` | No refund implied by BFMR/Amazon data. |
| `expected_pending` | Return/split implies refund should occur, but no refund found yet. |
| `pending_refund_found` | Pending card refund found. |
| `posted_refund_found` | Posted card refund found. |
| `partial_refund_found` | Refund found but amount does not fully match expected. |
| `refund_unlinked` | Amazon/card refund found but no BFMR return group linked. |
| `manual_review` | Multiple possible orders/items/refunds. |

Refund matching should support:

- Full order refund.
- Partial item refund.
- Multiple item refund credits for one Amazon order.
- Refund credit posted days/weeks after return.
- Replacement/no-refund scenarios that require manual review.

## Required Exception Types

The financial system should generate at least these exceptions:

- `bfmr_purchase_missing_card_charge`
- `card_charge_missing_bfmr_or_known_order`
- `bfmr_paid_not_found_in_checking`
- `checking_deposit_not_linked_to_bfmr`
- `cashback_missing_or_mismatch`
- `cashback_rate_assumed_not_verified`
- `return_refund_expected_not_found`
- `card_refund_not_linked_to_return`
- `partial_refund_amount_mismatch`
- `split_review_needed`
- `bfmr_order_number_missing`
- `amazon_order_not_scraped`
- `duplicate_possible_match`
- `manual_addon_not_confirmed`

Each exception should include:

- Severity.
- Source record ids.
- Candidate financial transaction ids.
- Expected amount.
- Actual matched amount.
- Difference.
- Reason.
- Suggested next action.

## Required Views

Minimum views:

- Reconciliation Overview.
- BFMR Purchases vs Card Charges.
- Chase Prime Visa Amazon Charges Not Found in BFMR.
- BFMR Orders Missing Card Charge.
- BFMR Payouts vs Chase Checking Deposits.
- Cashback/Points Verification.
- Returns and Refunds.
- Pending Profit.
- Manual Add-ons Verification.
- Exceptions Queue.

## Acceptance Criteria

The integration is working when it can:

1. Pull BFMR tracker `/api/data`.
1. Import Chase Prime Visa charges and rewards.
1. Import Chase checking transactions.
1. Generate expected purchase, payout, cashback, refund, and add-on events.
1. Match BFMR purchases to posted or pending card charges.
1. Flag card charges not found in BFMR or another known order source.
1. Flag BFMR purchases not found on the card.
1. Confirm BFMR paid rows against Chase checking deposits.
1. Verify expected Chase Prime Visa points/cashback.
1. Identify returns with posted refunds, pending refunds, partial refunds, or missing refunds.
1. Show realized profit and pending profit separated by cause.
1. Preserve raw data and matching evidence for audit.
