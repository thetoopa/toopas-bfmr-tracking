import unittest

from bfmr_data import (
    apply_amazon_enrichment,
    apply_amazon_purchase_reconciliation,
    apply_return_accounting,
    calculate_profit,
    infer_order_from_tracking,
    merge_historical_records,
    summarize,
)


def record(**overrides):
    base = {
        "status": "Paid",
        "item_name": "Example item",
        "order_number": "114-0000000-0000001",
        "quantity": 1.0,
        "purchase_total": 100.0,
        "payout_per_unit": 110.0,
        "payout_total": 110.0,
        "amount_paid": 110.0,
        "cashback_rate": 0.06,
        "profit": calculate_profit("Paid", 110.0, 100.0, 0.06),
        "tracking": "TBA-TEST",
        "month_key": "2026-08",
        "price_source": "BFMR site retail price",
        "purchase_is_estimate": False,
        "account": "Personal",
    }
    return {**base, **overrides}


class ReturnAccountingTests(unittest.TestCase):
    def test_historical_merge_skips_migrated_rows_and_keeps_missing_rows(self):
        migrated = record(
            date="2026-05-26",
            source_row=200,
            item_name="Migrated item",
            order_number="114-0000000-0000042",
            payout_total=100.0,
            amount_paid=100.0,
        )
        historical_copy = record(
            date="2026-05-26",
            source_row=2,
            item_name="Migrated item",
            order_number="114-0000000-0000042",
            payout_total=100.0,
            amount_paid=0.0,
        )
        historical_only = record(
            date="2026-05-14",
            source_row=3,
            item_name="Referral Bonus",
            order_number="",
            payout_total=75.0,
            amount_paid=0.0,
            purchase_total=0.0,
            profit=75.0,
        )

        merged, added = merge_historical_records(
            {"records": [migrated], "metadata": {}},
            {"records": [historical_copy, historical_only]},
            "historical.xlsx",
        )

        self.assertEqual(added, 1)
        self.assertEqual(len(merged["records"]), 2)
        archived = next(row for row in merged["records"] if row["item_name"] == "Referral Bonus")
        self.assertTrue(archived["historical_archive"])
        self.assertEqual(archived["historical_source"], "historical.xlsx")
        self.assertEqual(merged["metadata"]["historical_archive_rows"], 1)

    def test_returned_alias_excludes_duplicate_and_scales_paid_quantity(self):
        paid = record(
            item_name="Partial iPad delivery",
            quantity=3.0,
            purchase_total=1827.0,
            payout_per_unit=592.0,
            payout_total=1776.0,
            amount_paid=1184.0,
            profit=calculate_profit("Paid", 1776.0, 1827.0, 0.06),
        )
        returned = record(
            status="Returned",
            item_name="Partial iPad delivery",
            quantity=3.0,
            purchase_total=1827.0,
            payout_per_unit=592.0,
            payout_total=1776.0,
            amount_paid=0.0,
            profit=calculate_profit("Returned", 1776.0, 1827.0, 0.06),
        )

        apply_return_accounting([paid, returned])

        self.assertEqual(returned["status"], "Return")
        self.assertTrue(returned["accounting_excluded"])
        self.assertEqual(returned["accounting_purchase_total"], 0.0)
        self.assertEqual(paid["accounting_quantity"], 2.0)
        self.assertEqual(paid["accounting_purchase_total"], 1218.0)
        self.assertEqual(paid["accounting_payout_total"], 1184.0)
        self.assertEqual(paid["accounting_profit"], 39.08)

    def test_closed_row_is_a_non_financial_audit_row(self):
        closed = record(
            status="Closed",
            order_number="",
            quantity=5.0,
            purchase_total=1908.25,
            payout_per_unit=64.99,
            payout_total=324.95,
            amount_paid=0.0,
        )

        apply_return_accounting([closed])

        self.assertTrue(closed["accounting_excluded"])
        self.assertEqual(closed["accounting_quantity"], 0.0)
        self.assertEqual(closed["accounting_purchase_total"], 0.0)
        self.assertEqual(closed["accounting_payout_total"], 0.0)
        self.assertEqual(closed["accounting_profit"], 0.0)

    def test_repeated_order_total_is_allocated_once_across_line_items(self):
        first = record(
            item_name="Main item",
            purchase_total=381.65,
            payout_per_unit=305.01,
            payout_total=305.01,
            amount_paid=305.01,
        )
        second = record(
            item_name="Bundled item",
            purchase_total=381.65,
            payout_per_unit=64.99,
            payout_total=64.99,
            amount_paid=64.99,
        )
        apply_return_accounting([first, second])

        apply_amazon_purchase_reconciliation(
            [first, second],
            {"114-0000000-0000001": {"order_total": 381.65}},
        )

        self.assertEqual(round(first["accounting_purchase_total"] + second["accounting_purchase_total"], 2), 381.65)
        self.assertEqual(first["amazon_purchase_reconciliation"], "allocated_down_to_amazon_total")
        self.assertEqual(second["amazon_purchase_gap"], 0.0)

    def test_amazon_total_above_bfmr_count_is_flagged_without_inflating(self):
        accepted = record(purchase_total=226.10, payout_total=222.0, amount_paid=222.0)
        apply_return_accounting([accepted])

        apply_amazon_purchase_reconciliation(
            [accepted],
            {"114-0000000-0000001": {"order_total": 565.25}},
        )

        self.assertEqual(accepted["accounting_purchase_total"], 226.10)
        self.assertEqual(accepted["amazon_purchase_gap"], 339.15)
        self.assertEqual(accepted["amazon_purchase_reconciliation"], "amazon_total_exceeds_bfmr_counted_rows")

    def test_missing_order_is_inferred_from_unique_tracking_match(self):
        known = record(tracking="TBA123")
        missing = record(order_number="", tracking="TBA123")

        infer_order_from_tracking([known, missing])

        self.assertEqual(missing["order_number"], known["order_number"])
        self.assertTrue(missing["order_number_inferred"])

    def test_same_tracking_split_row_is_consolidated_without_adding_a_purchase(self):
        zero_companion = record(
            quantity=1.0,
            purchase_total=113.05,
            payout_per_unit=0.0,
            payout_total=0.0,
            amount_paid=0.0,
            tracking="TBA-SPLIT",
        )
        paid = record(
            quantity=1.0,
            purchase_total=113.05,
            payout_per_unit=111.0,
            payout_total=111.0,
            amount_paid=222.0,
            tracking="TBA-SPLIT",
        )

        apply_return_accounting([zero_companion, paid])

        self.assertTrue(zero_companion["accounting_excluded"])
        self.assertEqual(zero_companion["accounting_purchase_total"], 0.0)
        self.assertEqual(paid["accounting_quantity"], 2.0)
        self.assertEqual(paid["accounting_purchase_total"], 226.10)
        self.assertEqual(paid["accounting_payout_total"], 222.0)
        self.assertEqual(paid["accounting_amount_paid"], 222.0)

    def test_open_payout_is_clamped_per_row(self):
        paid_overage = record(payout_total=111.0, amount_paid=222.0)
        unpaid = record(status="Purchased", payout_total=500.0, amount_paid=0.0)
        apply_return_accounting([paid_overage, unpaid])

        summary = summarize([paid_overage, unpaid])

        self.assertEqual(summary["open_payout"], 500.0)

    def test_paid_referral_counts_as_collected_cash(self):
        referral = record(
            item_name="Referral Bonus",
            order_number="",
            purchase_total=0.0,
            payout_per_unit=100.0,
            payout_total=100.0,
            amount_paid=0.0,
            cashback_rate=0.0,
            profit=100.0,
        )
        apply_return_accounting([referral])

        summary = summarize([referral])

        self.assertEqual(referral["accounting_amount_paid"], 100.0)
        self.assertEqual(summary["cash_paid"], 100.0)
        self.assertEqual(summary["open_payout"], 0.0)

    def test_unmatched_amazon_order_uses_configured_personal_fallback(self):
        unmatched = record(order_number="114-0000000-0000002")
        dataset = {"records": [unmatched], "metadata": {}}
        settings = {
            "assumptions": {
                "default_cashback_rate": 0.05,
                "no_order_account": "Personal",
                "no_order_cashback_rate": 0.06,
                "business_default_cashback_rate": 0.06,
                "manual_assumed_orders": [],
            }
        }

        enriched = apply_amazon_enrichment(dataset, [], settings)
        result = enriched["records"][0]

        self.assertEqual(result["account"], "Personal")
        self.assertEqual(result["cashback_rate"], 0.06)
        self.assertEqual(result["cashback_rate_source"], "Unmatched-order default 6%")
        self.assertFalse(result["amazon_order_matched"])


if __name__ == "__main__":
    unittest.main()
