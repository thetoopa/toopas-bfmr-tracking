# Credit Capacity Planner

The Credit tab combines the latest BFMR reservations with Amazon order totals and ETAs to forecast card utilization against a user-configured credit limit.

## Required Card Snapshot

The tracker cannot derive the live Chase balance from BFMR or Amazon. Enter:

- Credit limit
- Current posted plus pending card balance
- Balance snapshot date
- Planned card payments

The current balance is the starting point for the forecast. Already-shipped and delivered orders are assumed to be represented in that balance and are not added again.

## Charge Timing

Amazon generally charges an order when it ships. The planner schedules an unshipped placed order for its delivery ETA minus the configurable `charge_lead_days` setting, with a default of one day. If that estimated charge date has passed, the planner schedules the exposure for today.

The planner classifies BFMR rows as follows:

| BFMR/Amazon state | Credit treatment |
| --- | --- |
| Reservation without an Amazon order | Unscheduled future commitment |
| Placed/Purchased order with ETA | Scheduled future charge |
| Placed/Purchased order without ETA | Unscheduled future commitment |
| Shipped, delivered, package received, processed, or paid | Assumed already included in the entered card balance |
| Cancelled | Ignored |
| Return/Returned | Excluded from purchase/profit totals and retained for refund reconciliation |
| Closed | Excluded from purchase/profit totals and retained as an audit row |

Amazon order total is preferred for card exposure because it represents the amount charged by Amazon. BFMR accounting retail is used when Amazon total is unavailable.

For completed or return-affected orders, `amazon_purchase_gap` remains a reconciliation item until card records confirm a refund. The Credit tab does not add completed orders to future commitments because their posted or pending card effect belongs in the entered current balance.

## Forecast Outputs

- Available credit today
- Scheduled charges by estimated charge date
- Planned payments by date
- Projected balance, available credit, and utilization by day
- Peak projected balance
- Unscheduled commitments
- Worst-case balance, calculated as peak projected balance plus all unscheduled commitments
- Arrival totals by ETA day
- Personal and Business account exposure

The warning threshold is configurable. A limit breach is always shown as a danger state regardless of that threshold.

## Reconciliation Boundary

This is a capacity forecast, not a substitute for Chase transaction reconciliation. The linked financial system should continue to verify posted charges, pending charges, payments, refunds, and rewards. When Chase data is connected, its latest posted-plus-pending balance should populate the same card snapshot fields.
