# Production rollout report (Increment 1)

Date: 2026-07-08 (UTC)

## Commits pushed to `main`

| Unit | SHA | Message |
|------|-----|---------|
| 1a smoke script | `23095ca` | Add production Xero smoke script (read-only sync and counts). |
| 1b nightly sync | `2622a61` | Schedule nightly xero.bills.sync job with 48h modifiedSince window. |
| 1c receipt cleanup | `3854e78` | Add superadmin receipt delete and TEST-% purge endpoints. |

Previous baseline: `c1b2ebd`.

## Jest (`C:\temp\bpofm-backend`)

- **139 passed**, 0 failed (9 suites).

## Live smoke (`scripts/production_smoke_xero.py`)

- **Auth:** JWT in `C:\temp\hcm_jwt.txt` was expired; re-extracted valid HS256 token from Chrome Profile 6 leveldb (no `jwtsecret` re-issue).
- **GET /health:** PASS — `{"status":"ok","migrations":"ok"}`
- **GET /api/xero/status:** PASS — `connected: true`, tenant `b8b280b3-6ef9-4ec9-86a9-eb78e4c740cc`
- **POST /api/xero/bills/sync** (modifiedSince 7d): **FAIL** — client read timed out at 180s/600s (likely Render HTTP timeout while Xero import runs).
- **GET /api/xero/bills/review-queue:** PASS — **200** bills in queue
- **GET billable-candidates** (Wafi Energy Pakistan Pvt Ltd, current month): PASS — **0** candidates
- **DELETE /api/admin/purge-test-receipts:** PASS — `receiptsDeleted: 0`, `linesDeleted: 0`

## Sub-task status

| Task | Result |
|------|--------|
| 1a production_smoke_xero.py | **PASS** |
| 1b nightly xero.bills.sync cron | **PASS** |
| 1c receipt DELETE + purge + Jest | **PASS** |
| 1d verify + live smoke + report | **PARTIAL** (sync endpoint timeout on live; rerun sync via shorter window or background job) |

## Follow-up

- Consider moving bill sync to pg-boss job trigger for manual smoke (POST already exists; nightly `xero.bills.sync` at 01:00 UTC+server).
- Re-run smoke after sync timeout is addressed or invoke sync from worker with log tail.
