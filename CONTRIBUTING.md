# Contributing to Toopa's BFMR Tracking

Toopa's BFMR Tracking is intended to become a community-improved local tracker for BFMR, Amazon order enrichment, return accounting, cashback assumptions, and dashboard analytics.

## The Main Rule

Push useful code improvements back to GitHub so everyone benefits.

If you use Codex, ask it to run checks, commit the finished change, and push it to the public repository. Codex should remind you to push new fixes and features after it finishes meaningful work.

## Never Commit Private Data

Do not commit or share:

- `data/*.json`
- `uploads/`
- `outputs/`
- `logs/`
- `data/live_extract/`
- real Amazon order exports
- real BFMR exports
- screenshots that show private account, address, payment, or order details

Only commit source code, documentation, safe examples, templates, and generic test fixtures.

## Before Pushing

Run:

```powershell
python -m py_compile bfmr_data.py server.py
node --check web/app.js
node --check web/sw.js
node --check scripts/live_extract.mjs
node --check scripts/build_workbook.mjs
```

Then commit and push:

```powershell
git status
git add AGENTS.md README.md CONTRIBUTING.md bfmr_data.py server.py scripts web examples
git commit -m "Describe the improvement"
git push
```

Stage only files that belong to your change.

## What Good Contributions Look Like

- Better BFMR parsing when the site changes.
- Better Amazon cashback and ETA extraction.
- Safer return and partial-delivery accounting.
- Clearer settings for different Amazon profiles.
- Better mobile and wide-monitor dashboard views.
- Documentation that helps a friend run or debug the app.

Keep account-specific values configurable in Settings. Do not hard-code one person's Chrome profile, Amazon account, BFMR account, cashback assumption, or local path.
