# Contributing

Thanks for improving Toopa's BFMR Tracking.

## Local Setup

1. Install Python 3.11+.
2. Install Node.js if you plan to run scraper/workbook scripts outside Codex.
3. From the project folder, start the local server:

```powershell
python server.py --host 0.0.0.0 --port 8765
```

4. Open `http://127.0.0.1:8765/`.

## Data Safety

Never commit private order data, scrape output, uploaded workbooks, generated Excel files, or logs. The `.gitignore` file is intentionally strict about these paths.

Safe files to change normally include:

- `bfmr_data.py`
- `server.py`
- `scripts/*.mjs`
- `web/*`
- `README.md`
- `AGENTS.md`
- `CONTRIBUTING.md`

## Feature Work

When adding features:

- Add or update Settings controls for assumptions or profile behavior.
- Keep existing import formats working.
- Keep the table editable where possible.
- Update `README.md` when user-facing behavior changes.
- Run the checks listed in `AGENTS.md`.

## Scraping Behavior

The scraper opens visible Chrome windows and uses configured Chrome profile directories. Contributors should avoid adding hidden scraping flows for account-sensitive work because users need to see login, MFA, and account switching states.
