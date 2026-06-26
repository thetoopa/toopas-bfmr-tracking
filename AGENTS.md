# Codex Project Instructions

This project is a local-first BFMR/Amazon tracking dashboard. Keep it useful for non-technical users who want to import tracker exports, scrape their own logged-in Chrome profiles, and inspect profit/account status without exposing private order data.

## Preserve These Invariants

- Do not commit real user data from `data/*.json`, `uploads/`, `outputs/`, `logs/`, or `data/live_extract/`.
- Keep the app runnable locally with no private seed files. A fresh clone should start and allow imports.
- Keep Chrome profiles configurable through the Settings tab. Do not hard-code one person's profile names.
- Keep cashback/account assumptions editable in Settings.
- Keep both scrape modes:
  - Normal update scrapes all orders not yet in paid status and updates relevant information.
  - One-time all refresh includes paid orders and all non-cancelled BFMR orders.
- Keep cancelled BFMR rows hidden by default from normal views.
- Keep the BFMR-style table as the main view.
- Keep PWA/mobile support working.
- When useful improvements are made, remind the user to commit and push them to GitHub so the community version stays current.

## Development Checks

Run these before handing work back:

```powershell
python -m py_compile bfmr_data.py server.py
$node="$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node --check web/app.js
& $node --check web/sw.js
& $node --check scripts/live_extract.mjs
& $node --check scripts/build_workbook.mjs
```

If the bundled Codex Node path is unavailable, use a local Node.js installation that can run the existing scripts.

## UI Guidance

- Prefer dense, practical dashboard controls over marketing-style pages.
- Keep wide-monitor table usability strong.
- Keep mobile card views functional.
- Any new setting should have a visible control in Settings and a documented default.

## Data Model Notes

`bfmr_data.py` is the normalization and enrichment layer. `server.py` is the local API and static file server. `scripts/live_extract.mjs` owns visible Chrome/Playwright extraction. `web/app.js` owns client-side filtering, charts, settings, and table editing.

## Community Loop

This project is meant to improve through real BFMR/Amazon edge cases. If Codex adds a feature, fixes scraping, improves accounting logic, or updates UI behavior, it should remind the user to push those changes to GitHub after checks pass. Do not push private data; only code, docs, examples, and safe templates belong in the public repository.
