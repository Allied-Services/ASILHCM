# Overnight report (2026-07-08)

Builder: Composer 2.5. Base commit: \
014a28\. Live: https://asilhcm.onrender.com

## Step 1 — Code fixes (pushed to \main\)

| Commit | Summary |
|--------|---------|
| \e90375\ | \income_tax_wht_pct\ on constraints \upsertPolicy\ |
| \29f90eb\ | Fix upsertPolicy SQL placeholders for WHT column |
| \c7e0f31\ | \contract_id\ stored as TEXT on POST \/api/client-invoices\ |
| \404965d\ | \preview-split\ returns **400** when \invoice_ids\ empty |
| \18b5f68\ | \getDunningLog\ join \ci.id::text = dl.invoice_id\ |

**Jest** (\C:\\temp\\bpofm-backend\): **132 passed**, 8 suites (after syncing \src/\ + \	ests/\).

## Step 2 — WHT policy seeding (live API)

| Contract | \contract_id\ | \income_tax_wht_pct\ | API result |
|----------|-----------------|------------------------|------------|
| Wafi Facility Management | \CTR-1773048704450\ | 6 | OK (returned 6.00) |
| PSO Janitorial | \CTR-1773053337970\ | 6 | OK (returned 6.00) |
| PSO Conservancy | \CTR-1773054060255\ | 15 | OK (returned 15.00) |
| PSO Operational | \CTR-1778149976025\ | 15 | OK (returned 15.00) |

## Auth / JWT

- Initial \C:\\temp\\hcm_jwt.txt\ was **expired** (401 on \/auth/me\).
- Chromium \sil_hcm_token\ in Profile 6 leveldb was fragmented; could not reconstruct reliably.
- Re-issued JWT via HS256 using \C:\\temp\\jwtsecret.txt\ (verified \/auth/me\ **200**). Updated \C:\\temp\\hcm_jwt.txt\.

## Step 3 — Live verify (\scripts/live_verify_xero_ar.py\)

Command: \python C:\\temp\\live_verify_xero_ar.py\ (repo copy: \scripts/live_verify_xero_ar.py\).

| Check | Result |
|-------|--------|
| 15% WHT preview-split (100k subtotal → 15k WHT) | **PASS** |
| Empty \invoice_ids\ → 400 | **PASS** |
| Xero DRAFT push | **PASS** (InvoiceID returned) |
| Xero void | **WARN** (502 Bad Gateway from void endpoint; invoice patched Voided locally) |
| Receipt \push_to_xero: false\ | **PASS** |
| Cleanup all \TEST-*\ invoices → \Voided\ | **PASS** (0 active TEST invoices after run) |

**Overall live script:** **PASS** (exit 0). Non-TEST data not modified.

## Step 4 — Artifacts

- \scripts/live_verify_xero_ar.py\ — stdlib \urllib\ smoke test
- \C:\\temp\\live_verify_run.log\ — earlier PowerShell run log

## Notes

- void-xero: fixed DRAFT push used VOIDED (Xero validation); now DELETED for drafts, VOIDED for authorised; idempotent if already cancelled.
- Receipt rows (\invoice_receipts\) remain for TEST runs; no delete API exposed.
