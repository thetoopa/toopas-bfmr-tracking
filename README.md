# Toopa's BFMR Tracking

A local BFMR and Amazon tracking dashboard with Excel import, editable BFMR-style table views, profit add-ons, Chrome profile-based scraping, and mobile-friendly PWA behavior.

## Requirements

- Python 3.11+
- Google Chrome
- Node.js for Playwright scraping
- `openpyxl` for Excel imports
- `@oai/artifact-tool` for workbook generation inside Codex, or a compatible local replacement if running that script outside Codex

The app is local-first. Your private tracker data stays on your machine unless you choose to share it.

Install basics:

```powershell
pip install -r requirements.txt
npm install
```

## Start

```powershell
python server.py --host 0.0.0.0 --port 8765
```

Open `http://127.0.0.1:8765/`.

## Settings

Use the Settings tab to choose Chrome profiles from the detected local Chrome profile list. Each Amazon profile can be named, enabled, and marked as `Personal` or `Business`.

The assumptions in Settings control default cashback, no-order fallback account/cashback, business default cashback, and manual assumed orders.

The header has a light/dark mode toggle. The preference is saved in your browser.

An example settings file lives at `examples/settings.example.json`.

## Imports

- `Replace Data` imports a BFMR export workbook.
- `Import Gus Tracking Sheet` imports a Google Sheets-style tracker with columns like `ITEM NAME`, `QTY`, `ORDER #`, `PURCHASE $`, `PAYOUT $`, `DATE`, `CASHBACK %`, `ACCOUNT`, and `STATUS`.

## Scraping

- `Run Normal Update` refreshes BFMR, then checks Amazon orders that are not paid or need a fresh ETA.
- `Run One-Time All` refreshes BFMR, then re-checks every non-cancelled BFMR order, including paid orders.

Private local data such as `data/*.json`, scrape logs, uploads, and generated workbooks are ignored by git.

## Development

Read `AGENTS.md` before using Codex or another coding agent on this project. It documents the project invariants that should not be broken.

See `CONTRIBUTING.md` before pushing changes. The short version: keep private data out of git, run checks, and push useful improvements back to GitHub so the shared tracker keeps getting better.

Run checks:

```powershell
python -m py_compile bfmr_data.py server.py
node --check web/app.js
node --check web/sw.js
node --check scripts/live_extract.mjs
node --check scripts/build_workbook.mjs
```
