import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bfmr_data import DEFAULT_PRICE_WORKBOOK, DEFAULT_TRACKER_EXPORT, normalize_bfmr_export, save_dataset


OUTPUT = Path("data/bfmr_records.json")


if __name__ == "__main__":
    dataset = normalize_bfmr_export(DEFAULT_TRACKER_EXPORT, DEFAULT_PRICE_WORKBOOK)
    save_dataset(dataset, OUTPUT)
    summary = dataset["summary"]
    print(f"Wrote {OUTPUT}")
    print(f"Records: {summary['orders']}")
    print(f"Spend: ${summary['spend']:,.2f}")
    print(f"Profit: ${summary['profit']:,.2f}")
    print(f"Estimated purchase rows: {summary['estimated_purchase_rows']}")
