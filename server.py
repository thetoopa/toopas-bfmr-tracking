from __future__ import annotations

import argparse
import json
import mimetypes
import re
import subprocess
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

from bfmr_data import (
    CASHBACK_RATE,
    DEFAULT_PRICE_WORKBOOK,
    DEFAULT_SETTINGS,
    DEFAULT_TRACKER_EXPORT,
    apply_amazon_enrichment,
    calculate_profit,
    display_status,
    merged_settings,
    normalize_amazon_orders,
    normalize_bfmr_export,
    normalize_bfmr_site_rows,
    normalize_gus_tracking_sheet,
    normalize_order_number,
    parse_date,
    parse_number,
    save_dataset,
)


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
DATA_PATH = ROOT / "data" / "bfmr_records.json"
ADDONS_PATH = ROOT / "data" / "profit_addons.json"
AMAZON_ORDERS_PATH = ROOT / "data" / "amazon_orders.json"
SETTINGS_PATH = ROOT / "data" / "settings.json"
UPLOAD_ROOT = ROOT / "uploads"
WORKBOOK_PATH = ROOT / "outputs" / "Toopas_BFMR_Tracking.xlsx"
NODE_EXE = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe"
WORKBOOK_BUILDER = ROOT / "scripts" / "build_workbook.mjs"
LIVE_EXTRACTOR = ROOT / "scripts" / "live_extract.mjs"
AUTOMATION_USER_DATA_DIR = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "BFMR_Automation_User_Data"
CHROME_CDP_PORT = "9222"
CHROME_USER_DATA_DIR = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data"

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/javascript; charset=utf-8", ".js")


def ensure_seed_data() -> None:
    if DATA_PATH.exists():
        return
    if DEFAULT_TRACKER_EXPORT.exists():
        dataset = normalize_bfmr_export(DEFAULT_TRACKER_EXPORT, DEFAULT_PRICE_WORKBOOK)
    else:
        dataset = {
            "records": [],
            "summary": {},
            "metadata": {
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "source": "empty",
                "message": "Import a BFMR export or Gus tracking sheet to get started.",
                "cashback_rate": CASHBACK_RATE,
            },
        }
    save_dataset(dataset, DATA_PATH)


def load_addons() -> list[dict]:
    if not ADDONS_PATH.exists():
        return []
    try:
        payload = json.loads(ADDONS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if isinstance(payload, list):
        return payload
    return []


def save_addons(addons: list[dict]) -> None:
    ADDONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ADDONS_PATH.write_text(json.dumps(addons, indent=2), encoding="utf-8")


def load_amazon_orders() -> list[dict]:
    if not AMAZON_ORDERS_PATH.exists():
        return []
    try:
        payload = json.loads(AMAZON_ORDERS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if isinstance(payload, list):
        return payload
    return []


def save_amazon_orders(orders: list[dict]) -> None:
    AMAZON_ORDERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    orders.sort(key=lambda row: (row.get("account", ""), row.get("order_number", "")))
    AMAZON_ORDERS_PATH.write_text(json.dumps(orders, indent=2), encoding="utf-8")


def normalize_settings_payload(payload: dict | None) -> dict:
    settings = merged_settings(payload if isinstance(payload, dict) else {})
    assumptions = settings.setdefault("assumptions", {})
    for key in ("default_cashback_rate", "no_order_cashback_rate", "business_default_cashback_rate"):
        parsed = parse_number(assumptions.get(key))
        assumptions[key] = round(float(parsed if parsed is not None else CASHBACK_RATE), 4)
    no_order_account = str(assumptions.get("no_order_account") or "Personal").strip().title()
    assumptions["no_order_account"] = no_order_account if no_order_account in {"Personal", "Business"} else "Personal"

    manual_rows = []
    for row in assumptions.get("manual_assumed_orders", []):
        if not isinstance(row, dict):
            continue
        order_number = normalize_order_number(row.get("order_number"))
        if not order_number:
            continue
        account = str(row.get("account") or "Personal").strip().title()
        rate = parse_number(row.get("cashback_rate"))
        manual_rows.append(
            {
                "order_number": order_number,
                "account": account if account in {"Personal", "Business"} else "Personal",
                "cashback_rate": round(float(rate if rate is not None else assumptions["default_cashback_rate"]), 4),
                "note": str(row.get("note") or "").strip(),
            }
        )
    assumptions["manual_assumed_orders"] = manual_rows

    chrome = settings.setdefault("chrome", {})
    chrome["bfmr_profile_directory"] = str(chrome.get("bfmr_profile_directory") or "Default").strip() or "Default"
    chrome["skip_paid_orders"] = bool(chrome.get("skip_paid_orders", True))
    profiles = []
    for index, profile in enumerate(chrome.get("profiles", [])):
        if not isinstance(profile, dict):
            continue
        profile_directory = str(profile.get("profile_directory") or "").strip()
        if not profile_directory:
            continue
        account_type = str(profile.get("account_type") or "personal").strip().lower()
        if account_type not in {"personal", "business"}:
            account_type = "personal"
        profile_id = str(profile.get("id") or f"{account_type}-{index + 1}").strip()
        profiles.append(
            {
                "id": profile_id,
                "name": str(profile.get("name") or f"{account_type.title()} Amazon").strip(),
                "profile_directory": profile_directory,
                "account_type": account_type,
                "enabled": bool(profile.get("enabled", True)),
            }
        )
    chrome["profiles"] = profiles
    return settings


def load_settings() -> dict:
    if not SETTINGS_PATH.exists():
        save_settings(DEFAULT_SETTINGS)
    try:
        payload = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = DEFAULT_SETTINGS
    return normalize_settings_payload(payload)


def save_settings(settings: dict) -> dict:
    normalized = normalize_settings_payload(settings)
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    return normalized


def load_chrome_profiles() -> list[dict]:
    profiles: dict[str, dict] = {}
    local_state = CHROME_USER_DATA_DIR / "Local State"
    if local_state.exists():
        try:
            payload = json.loads(local_state.read_text(encoding="utf-8"))
            info_cache = payload.get("profile", {}).get("info_cache", {})
            if isinstance(info_cache, dict):
                for directory, details in info_cache.items():
                    if not isinstance(details, dict):
                        continue
                    name = str(details.get("name") or directory).strip()
                    user_name = str(details.get("user_name") or "").strip()
                    profiles[directory] = {
                        "directory": directory,
                        "name": name,
                        "user_name": user_name,
                        "label": f"{name} ({directory})" + (f" - {user_name}" if user_name else ""),
                        "path": str(CHROME_USER_DATA_DIR / directory),
                    }
        except (OSError, json.JSONDecodeError):
            pass

    if CHROME_USER_DATA_DIR.exists():
        for child in CHROME_USER_DATA_DIR.iterdir():
            if not child.is_dir():
                continue
            if child.name != "Default" and not re.fullmatch(r"Profile \d+", child.name):
                continue
            profiles.setdefault(
                child.name,
                {
                    "directory": child.name,
                    "name": child.name,
                    "user_name": "",
                    "label": f"{child.name} ({child.name})",
                    "path": str(child),
                },
            )

    return sorted(profiles.values(), key=lambda row: (row["directory"] != "Default", row["label"].lower()))


def merge_amazon_orders(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged: dict[tuple[str, str], dict] = {}
    for order in existing + incoming:
        order_number = normalize_order_number(order.get("order_number"))
        if not order_number:
            continue
        key = (order_number, str(order.get("account", "")))
        merged[key] = {**order, "order_number": order_number}
    return list(merged.values())


def read_dataset() -> dict:
    ensure_seed_data()
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    amazon_orders = load_amazon_orders()
    settings = load_settings()
    dataset = apply_amazon_enrichment(dataset, amazon_orders, settings)
    dataset["addons"] = load_addons()
    dataset["amazon_orders"] = amazon_orders
    dataset["settings"] = settings
    return dataset


def parse_json_body(handler: SimpleHTTPRequestHandler) -> dict:
    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0:
        return {}
    body = handler.rfile.read(content_length)
    return json.loads(body.decode("utf-8"))


def normalize_addon(payload: dict) -> dict:
    category = str(payload.get("category", "")).strip()
    if category not in {"checking_bonus", "bfmr_referral", "amazon_young_adult_cashback", "extra_profit"}:
        raise ValueError("Choose a valid profit add-on category.")
    description = str(payload.get("description", "")).strip()
    if not description:
        raise ValueError("Add a short description.")
    try:
        amount = float(payload.get("amount", 0))
    except (TypeError, ValueError):
        raise ValueError("Amount must be a number.") from None
    if amount == 0:
        raise ValueError("Amount cannot be zero.")
    date = str(payload.get("date", "")).strip() or datetime.now().date().isoformat()
    notes = str(payload.get("notes", "")).strip()
    return {
        "id": datetime.now().strftime("%Y%m%d%H%M%S%f"),
        "category": category,
        "description": description,
        "amount": round(amount, 2),
        "date": date,
        "notes": notes,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }


def update_addon(addon_id: str, changes: dict) -> dict:
    addons = load_addons()
    addon = next((row for row in addons if str(row.get("id")) == addon_id), None)
    if not addon:
        raise ValueError("Profit add-on was not found.")
    allowed = {"date", "amount", "description", "notes", "category"}
    for field, value in changes.items():
        if field not in allowed:
            raise ValueError(f"{field} cannot be edited.")
        if field == "date":
            text = str(value or "").strip()
            addon["date"] = parse_date(text) if text else datetime.now().date().isoformat()
        elif field == "amount":
            amount = parse_number(value)
            if not amount:
                raise ValueError("Amount must be a non-zero number.")
            addon["amount"] = round(amount, 2)
        elif field == "category":
            category = str(value or "").strip()
            if category not in {"checking_bonus", "bfmr_referral", "amazon_young_adult_cashback", "extra_profit"}:
                raise ValueError("Choose a valid profit add-on category.")
            addon["category"] = category
        elif field == "description":
            description = str(value or "").strip()
            if not description:
                raise ValueError("Description cannot be blank.")
            addon["description"] = description
        else:
            addon[field] = str(value or "").strip()
    save_addons(addons)
    rebuild_workbook()
    return read_dataset()


def rebuild_workbook() -> None:
    if not NODE_EXE.exists() or not WORKBOOK_BUILDER.exists():
        return
    result = subprocess.run(
        [str(NODE_EXE), str(WORKBOOK_BUILDER)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Workbook rebuild failed.")


def refresh_enriched_dataset() -> None:
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    enriched = apply_amazon_enrichment(dataset, load_amazon_orders(), load_settings())
    save_dataset(enriched, DATA_PATH)


def stop_automation_chrome() -> None:
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            (
                "Get-CimInstance Win32_Process | "
                "Where-Object { $_.Name -like 'chrome*' -and $_.CommandLine -like '*remote-debugging-port=9222*' } | "
                "ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"
            ),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    for _ in range(20):
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    "Get-CimInstance Win32_Process | "
                    "Where-Object { $_.Name -like 'chrome*' -and $_.CommandLine -like '*remote-debugging-port=9222*' } | "
                    "Measure-Object | Select-Object -ExpandProperty Count"
                ),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if result.stdout.strip() in {"", "0"}:
            return
        subprocess.run(["powershell", "-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"], check=False)


def run_live_extract(
    stage: str,
    profile: str,
    account: str | None = None,
    reuse_existing: bool = False,
    skip_paid: bool = True,
    refresh_all: bool = False,
    manual_orders: list[str] | None = None,
) -> dict:
    if not NODE_EXE.exists() or not LIVE_EXTRACTOR.exists():
        raise RuntimeError("Live extractor runtime is missing.")
    args = [
        str(NODE_EXE),
        str(LIVE_EXTRACTOR),
        f"--stage={stage}",
        f"--profile={profile}",
        f"--port={CHROME_CDP_PORT}",
        f"--user-data-dir={AUTOMATION_USER_DATA_DIR}",
    ]
    if account:
        args.append(f"--account={account}")
        args.append(f"--skip-paid={'true' if skip_paid else 'false'}")
    if reuse_existing:
        args.append("--reuse-existing=true")
    if refresh_all:
        args.append("--refresh-all=true")
    if manual_orders:
        args.append(f"--manual-assumed-orders={','.join(manual_orders)}")
    result = subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=900,
        check=False,
    )
    log_dir = ROOT / "data" / "live_extract"
    log_dir.mkdir(parents=True, exist_ok=True)
    suffix = f"{stage}-{account or profile}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    (log_dir / f"site-rescrape-{suffix}.log").write_text(result.stdout, encoding="utf-8")
    (log_dir / f"site-rescrape-{suffix}.err").write_text(result.stderr, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{stage} scrape failed.")
    return {
        "stage": stage,
        "profile": profile,
        "account": account or "",
        "stdout_tail": result.stdout[-5000:],
    }


def rescrape_needed(skip_paid_orders: bool | None = None, refresh_all: bool = False) -> dict:
    settings = load_settings()
    chrome = settings.get("chrome", {})
    assumptions = settings.get("assumptions", {})
    manual_orders = [
        normalize_order_number(row.get("order_number"))
        for row in assumptions.get("manual_assumed_orders", [])
        if isinstance(row, dict) and normalize_order_number(row.get("order_number"))
    ]
    stop_automation_chrome()
    steps = [run_live_extract("bfmr", chrome.get("bfmr_profile_directory") or "Default", manual_orders=manual_orders)]
    profiles = [profile for profile in chrome.get("profiles", []) if profile.get("enabled", True)]
    for index, profile in enumerate(profiles):
        stop_automation_chrome()
        steps.append(
            run_live_extract(
                "amazon",
                profile.get("profile_directory") or "Default",
                profile.get("account_type") or "personal",
                reuse_existing=index == 0,
                skip_paid=bool(chrome.get("skip_paid_orders", True)) if skip_paid_orders is None else skip_paid_orders,
                refresh_all=refresh_all,
                manual_orders=manual_orders,
            )
        )
    refresh_enriched_dataset()
    rebuild_workbook()
    return {"steps": steps}


EDITABLE_RECORD_FIELDS = {
    "status",
    "item_name",
    "quantity",
    "order_number",
    "tracking",
    "insurance",
    "payout_per_unit",
    "payout_total",
    "received",
    "amount_paid",
    "date",
    "date_processed",
    "date_paid",
    "notes",
    "purchase_total",
    "cashback_rate",
}

NUMERIC_RECORD_FIELDS = {
    "quantity",
    "payout_per_unit",
    "payout_total",
    "received",
    "amount_paid",
    "purchase_total",
    "cashback_rate",
}

DATE_RECORD_FIELDS = {"date", "date_processed", "date_paid"}


def normalize_record_edit(field: str, value: object) -> object:
    if field in NUMERIC_RECORD_FIELDS:
        parsed = parse_number(value)
        return 0.0 if parsed is None else parsed
    if field in DATE_RECORD_FIELDS:
        text_value = str(value or "").strip()
        return parse_date(text_value) if text_value else None
    if field == "status":
        return display_status(value)
    if field == "order_number":
        return normalize_order_number(value)
    return str(value or "").strip()


def recalculate_record(record: dict, recompute_subtotal: bool = False) -> None:
    quantity = float(record.get("quantity") or 0)
    payout_per_unit = float(record.get("payout_per_unit") or 0)
    if recompute_subtotal and quantity and payout_per_unit:
        record["payout_total"] = round(quantity * payout_per_unit, 2)
    else:
        record["payout_total"] = round(float(record.get("payout_total") or 0), 2)
    record["month_key"] = str(record.get("date") or "Unknown")[:7] if record.get("date") else "Unknown"
    record["purchase_is_estimate"] = bool(record.get("purchase_is_estimate", False))
    record["price_source"] = record.get("price_source") or "Manual edit"
    record["cashback_rate"] = round(float(record.get("cashback_rate") or CASHBACK_RATE), 4)
    record["profit"] = round(
        calculate_profit(
            str(record.get("status") or ""),
            float(record.get("payout_total") or 0),
            float(record.get("purchase_total") or 0),
            float(record.get("cashback_rate") or CASHBACK_RATE),
        ),
        2,
    )


def update_record(record_id: int, changes: dict) -> dict:
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    records = dataset.get("records", [])
    record = next((row for row in records if int(row.get("id") or 0) == record_id), None)
    if not record:
        raise ValueError(f"Record {record_id} was not found.")
    for field, value in changes.items():
        if field not in EDITABLE_RECORD_FIELDS:
            raise ValueError(f"{field} cannot be edited.")
        record[field] = normalize_record_edit(field, value)
        if field == "purchase_total":
            record["purchase_is_estimate"] = False
            record["price_source"] = "Manual edit"
        if field == "cashback_rate":
            record["cashback_rate_source"] = "Manual edit"
    recalculate_record(record, recompute_subtotal=bool({"quantity", "payout_per_unit"} & set(changes)))
    enriched = apply_amazon_enrichment(dataset, load_amazon_orders(), load_settings())
    save_dataset(enriched, DATA_PATH)
    rebuild_workbook()
    return read_dataset()


def safe_upload_name(filename: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_. -]+", "_", Path(filename).name).strip(" .")
    if not stem:
        stem = "upload.xlsx"
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{stem}"


def parse_content_disposition(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for chunk in value.split(";"):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        key, raw = chunk.split("=", 1)
        result[key.lower()] = raw.strip().strip('"')
    return result


def parse_multipart_form(content_type: str, body: bytes) -> tuple[dict[str, tuple[str, bytes]], dict[str, str]]:
    match = re.search(r"boundary=(?P<boundary>[^;]+)", content_type)
    if not match:
        raise ValueError("Missing upload boundary.")
    boundary = match.group("boundary").strip().strip('"').encode("utf-8")
    marker = b"--" + boundary
    uploads: dict[str, tuple[str, bytes]] = {}
    fields: dict[str, str] = {}

    for part in body.split(marker):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].rstrip(b"\r\n")
        if b"\r\n\r\n" not in part:
            continue
        header_blob, content = part.split(b"\r\n\r\n", 1)
        headers = {}
        for line in header_blob.decode("utf-8", errors="replace").split("\r\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.lower()] = value.strip()
        disposition = parse_content_disposition(headers.get("content-disposition", ""))
        field_name = disposition.get("name", "")
        filename = disposition.get("filename", "")
        if field_name and filename and content:
            uploads[field_name] = (filename, content.rstrip(b"\r\n"))
        elif field_name:
            fields[field_name] = content.rstrip(b"\r\n").decode("utf-8", errors="replace").strip()
    return uploads, fields


def parse_multipart(content_type: str, body: bytes) -> dict[str, tuple[str, bytes]]:
    uploads, _ = parse_multipart_form(content_type, body)
    return uploads


def parse_json_upload(upload: tuple[str, bytes]) -> tuple[list[dict], str]:
    payload = json.loads(upload[1].decode("utf-8"))
    if isinstance(payload, list):
        return payload, ""
    if not isinstance(payload, dict):
        raise ValueError("JSON upload must be an object with rows or a raw row list.")
    rows = payload.get("rows", [])
    if not isinstance(rows, list) or not rows:
        raise ValueError("No rows were found in the JSON upload.")
    return rows, str(payload.get("source_url", ""))


class BfmrHandler(SimpleHTTPRequestHandler):
    server_version = "ToopasBFMR/1.0"

    def send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path: Path, download_name: str | None = None) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404, "File not found")
            return
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if path.suffix.lower() in {".html", ".js", ".css", ".webmanifest"}:
            self.send_header("Cache-Control", "no-store, max-age=0")
        if download_name:
            self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/data":
            self.send_json(read_dataset())
            return
        if path == "/api/addons":
            self.send_json({"ok": True, "addons": load_addons()})
            return
        if path == "/api/amazon-orders":
            self.send_json({"ok": True, "amazon_orders": load_amazon_orders()})
            return
        if path == "/api/settings":
            self.send_json({"ok": True, "settings": load_settings()})
            return
        if path == "/api/chrome-profiles":
            self.send_json({"ok": True, "profiles": load_chrome_profiles()})
            return
        if path == "/api/health":
            self.send_json({"ok": True})
            return
        if path == "/download/workbook":
            self.send_file(WORKBOOK_PATH, WORKBOOK_PATH.name)
            return
        if path in {"/", ""}:
            self.send_file(WEB_ROOT / "index.html")
            return

        static_path = (WEB_ROOT / path.lstrip("/")).resolve()
        try:
            static_path.relative_to(WEB_ROOT.resolve())
        except ValueError:
            self.send_error(403)
            return
        self.send_file(static_path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/addons":
            try:
                addons = load_addons()
                addons.append(normalize_addon(parse_json_body(self)))
                save_addons(addons)
                rebuild_workbook()
                self.send_json({"ok": True, **read_dataset()})
            except Exception as exc:  # noqa: BLE001 - local app should return readable validation errors.
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/amazon-orders":
            try:
                payload = parse_json_body(self)
                rows = payload.get("rows", [])
                if not isinstance(rows, list) or not rows:
                    raise ValueError("No Amazon order rows were provided.")
                account = str(payload.get("account", "")).strip()
                if account.lower() not in {"personal", "business"}:
                    raise ValueError("Amazon order rows must be marked Personal or Business.")
                incoming = normalize_amazon_orders(
                    rows,
                    account,
                    str(payload.get("profile", "")),
                    str(payload.get("source_url", "")),
                    load_settings(),
                )
                if not incoming:
                    raise ValueError("No valid Amazon order numbers were found in those rows.")
                save_amazon_orders(merge_amazon_orders(load_amazon_orders(), incoming))
                rebuild_workbook()
                self.send_json({"ok": True, "imported": len(incoming), **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/settings":
            try:
                payload = parse_json_body(self)
                settings = save_settings(payload.get("settings", payload))
                refresh_enriched_dataset()
                rebuild_workbook()
                self.send_json({"ok": True, "settings": settings, **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/amazon-sync":
            self.send_json(
                {
                    "ok": False,
                    "needs_chrome_extension": True,
                    "desired_profiles": [
                        {
                            "account": "Personal",
                            "profile": "cooperbheisler",
                            "url": "https://www.amazon.com/gp/css/order-history?ref_=nav_orders_first",
                        },
                        {
                            "account": "Business",
                            "profile": "cbheisle@asu.edu",
                            "url": "https://www.amazon.com/gp/css/order-history?ref_=nav_orders_first",
                        },
                    ],
                    "error": "Amazon sync needs the Codex Chrome Extension enabled before I can use your Chrome profiles.",
                },
                409,
            )
            return

        if parsed.path == "/api/site-sync":
            try:
                payload = parse_json_body(self)
                rows = payload.get("rows", [])
                if not isinstance(rows, list) or not rows:
                    raise ValueError("No BFMR site rows were provided.")
                dataset = normalize_bfmr_site_rows(rows, str(payload.get("source_url", "")))
                save_dataset(dataset, DATA_PATH)
                rebuild_workbook()
                self.send_json({"ok": True, **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/manual-bfmr-import":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                content_type = self.headers.get("Content-Type", "")
                uploads, _ = parse_multipart_form(content_type, self.rfile.read(content_length))
                bfmr_upload = uploads.get("bfmr_json_file")
                if not bfmr_upload:
                    raise ValueError("Upload a BFMR extractor JSON file first.")
                rows, source_url = parse_json_upload(bfmr_upload)
                dataset = normalize_bfmr_site_rows(rows, source_url)
                save_dataset(dataset, DATA_PATH)
                rebuild_workbook()
                self.send_json({"ok": True, **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/manual-amazon-import":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                content_type = self.headers.get("Content-Type", "")
                uploads, fields = parse_multipart_form(content_type, self.rfile.read(content_length))
                amazon_upload = uploads.get("amazon_json_file")
                if not amazon_upload:
                    raise ValueError("Upload an Amazon extractor JSON file first.")
                account = fields.get("account", "").strip()
                if account.lower() not in {"personal", "business"}:
                    raise ValueError("Choose Personal or Business for the Amazon import.")
                rows, source_url = parse_json_upload(amazon_upload)
                incoming = normalize_amazon_orders(rows, account, fields.get("profile", ""), source_url, load_settings())
                if not incoming:
                    raise ValueError("No valid Amazon order numbers were found in that JSON file.")
                save_amazon_orders(merge_amazon_orders(load_amazon_orders(), incoming))
                rebuild_workbook()
                self.send_json({"ok": True, "imported": len(incoming), **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/chrome-sync":
            self.send_json(
                {
                    "ok": False,
                    "needs_chrome_extension": True,
                    "error": "Chrome sync needs the Codex Chrome Extension enabled in your Chrome profile first.",
                },
                409,
            )
            return

        if parsed.path == "/api/rescrape-needed":
            try:
                details = rescrape_needed(skip_paid_orders=True, refresh_all=False)
                self.send_json({"ok": True, **details, **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/rescrape-all":
            try:
                details = rescrape_needed(skip_paid_orders=False, refresh_all=True)
                self.send_json({"ok": True, **details, **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path == "/api/import-gus":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                content_type = self.headers.get("Content-Type", "")
                uploads, _ = parse_multipart_form(content_type, self.rfile.read(content_length))
                gus_upload = uploads.get("gus_file")
                if not gus_upload:
                    raise ValueError("Upload a Gus tracking sheet first.")
                UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
                gus_path = UPLOAD_ROOT / safe_upload_name(gus_upload[0])
                gus_path.write_bytes(gus_upload[1])
                dataset = normalize_gus_tracking_sheet(gus_path)
                save_dataset(dataset, DATA_PATH)
                refresh_enriched_dataset()
                rebuild_workbook()
                self.send_json({"ok": True, **read_dataset()})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if parsed.path != "/api/upload":
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            content_type = self.headers.get("Content-Type", "")
            uploads = parse_multipart(content_type, self.rfile.read(content_length))
            tracker_upload = uploads.get("tracker_file")
            if not tracker_upload:
                self.send_json({"ok": False, "error": "Upload a BFMR tracker export first."}, 400)
                return

            UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
            tracker_path = UPLOAD_ROOT / safe_upload_name(tracker_upload[0])
            tracker_path.write_bytes(tracker_upload[1])

            price_path = DEFAULT_PRICE_WORKBOOK
            price_upload = uploads.get("price_file")
            if price_upload:
                price_path = UPLOAD_ROOT / safe_upload_name(price_upload[0])
                price_path.write_bytes(price_upload[1])

            dataset = normalize_bfmr_export(tracker_path, price_path)
            save_dataset(dataset, DATA_PATH)
            rebuild_workbook()
            self.send_json({"ok": True, **read_dataset()})
        except Exception as exc:  # noqa: BLE001 - local app should return readable parser errors.
            self.send_json({"ok": False, "error": str(exc)}, 400)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/addons/"):
            try:
                addon_id = unquote(parsed.path.rsplit("/", 1)[-1])
                payload = parse_json_body(self)
                changes = payload.get("changes", {})
                if not isinstance(changes, dict) or not changes:
                    raise ValueError("No add-on changes were provided.")
                self.send_json({"ok": True, **update_addon(addon_id, changes)})
            except Exception as exc:  # noqa: BLE001
                self.send_json({"ok": False, "error": str(exc)}, 400)
            return

        if not parsed.path.startswith("/api/records/"):
            self.send_error(404)
            return
        try:
            record_id = int(unquote(parsed.path.rsplit("/", 1)[-1]))
            payload = parse_json_body(self)
            changes = payload.get("changes", {})
            if not isinstance(changes, dict) or not changes:
                raise ValueError("No record changes were provided.")
            self.send_json({"ok": True, **update_record(record_id, changes)})
        except Exception as exc:  # noqa: BLE001
            self.send_json({"ok": False, "error": str(exc)}, 400)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/addons/"):
            self.send_error(404)
            return
        addon_id = unquote(parsed.path.rsplit("/", 1)[-1])
        addons = [addon for addon in load_addons() if str(addon.get("id")) != addon_id]
        save_addons(addons)
        rebuild_workbook()
        self.send_json({"ok": True, **read_dataset()})


def run(host: str = "127.0.0.1", port: int = 8765) -> None:
    ensure_seed_data()
    address = (host, port)
    httpd = ThreadingHTTPServer(address, BfmrHandler)
    shown_host = "127.0.0.1" if host in {"0.0.0.0", ""} else host
    print(f"Toopa's BFMR Tracking running at http://{shown_host}:{address[1]}/")
    httpd.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Toopa's BFMR Tracking locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    run(args.host, args.port)
