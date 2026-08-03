# July 2026 Payroll — Gap Report (Updated 3 Aug 2026)

## Summary

| Check | Result |
|-------|--------|
| July CSV month | **7** (confirmed after your fix) |
| CSV rows / total net pay | **305 rows · PKR 43,953,273** |
| HCM "NO CONTRACT" (Payroll Sheet) | **3 test accounts only** — real staff have contracts |
| Excel vs HCM `contract_id` mismatches | **246 employees** — master sheet not imported yet |
| PSO-104/25 (Aziz ullah) | **Still ACTIVE in both Excel (YES) and HCM (`active=true`)** |

---

## Gap 1 — Cannot import Excel file (FIXED in code, pending deploy)

**Problem:** Employee Information → Import was paste-only (Screenshot 1). No file picker.

**Fix shipped:** `Choose CSV File` button on Employee Information toolbar.
- Excel: **File → Save As → CSV UTF-8**
- Or use pre-built file: `audit/payroll_team_contract_sync_july.csv` (246 rows, Contract ID + Active only)

**Payroll team action:**
1. Open Employee Information
2. Click **Choose CSV File**
3. Select `payroll_team_contract_sync_july.csv` (or full master CSV)
4. Confirm import result shows `updated: 246` (approx)

---

## Gap 2 — Contract IDs not synced to HCM (246 employees)

Your master sheet has the **Contract ID** column filled correctly. HCM still has old/wrong IDs for many PSO staff (e.g. all mapped to `CTR-PSO-NORTH-ZONE` instead of site-specific contracts like `CTR-1773054204870` Conservancy KPK).

**This is why payroll can look wrong** — wrong contract = wrong rates, bonus, service charge.

**Sample mismatches:**

| Employee | Excel Contract ID | HCM Contract ID |
|----------|-------------------|-----------------|
| ASIL/PSO-031/25 | CTR-1773054204870 (KPK) | CTR-PSO-NORTH-ZONE |
| ASIL/PSO-390/25 | CTR-1785569435995 (CORO) | NULL |
| ASIL/SPL-* (WAFI) | CTR-1773046722553 | OK for most |

**Action:** Import `audit/payroll_team_contract_sync_july.csv` via Choose CSV File.

---

## Gap 3 — PSO-104/25 showing in Fixed Value / PSO July

| Source | Active status |
|--------|---------------|
| Your statement | INACTIVE |
| Master Excel | **YES** |
| HCM database | **`active = true`** |

**Root cause:** He is still marked active in both Excel and HCM. The system correctly includes active employees in July FV overrides.

**Action for payroll team:**
1. In master sheet, set `ASIL/PSO-104/25` → **Active = No** (and Last Working Day if applicable)
2. Re-import via Choose CSV File (partial row is enough)
3. Refresh Fixed Value / PSO — he should disappear

Code change: explicit `inactive` exclusion added to monthly hub + payroll run queries (deploy pending).

---

## Gap 4 — Payroll Sheet "NO CONTRACT" red rows

If you still see red rows for real employees (Aamir Ali, etc.) after import:

1. **Hard refresh** (Ctrl+Shift+R)
2. Verify `/api/contracts` loads (not empty)
3. After contract_id import, red rows should clear

Production DB check: Aamir Ali already has `CTR-1773046722553` — red rows are likely a **browser/contracts load issue**, not missing data.

---

## Gap 5 — July net pay reconciliation (pending import)

Cannot confirm 100% net pay match until contract_ids are imported and July attendance/overrides entered.

**After import, verify:**
| Contract | July check |
|----------|------------|
| Wafi BPO | Bonus disbursement in July (1× monthly salary) |
| PSO sites | Correct site contract rates |
| FM | Gratuity + medical invoice-only |

**Target:** Payroll Sheet Total Net Pay = **PKR 43,953,273** (per your July CSV)

---

## Files generated

| File | Purpose |
|------|---------|
| `audit/july_gap_report_final.json` | Machine-readable summary |
| `audit/payroll_team_contract_sync_july.csv` | Ready-to-import Contract ID fix (246 rows) |
| `audit/PAYROLL_TEAM_JULY_INSTRUCTIONS.md` | Step-by-step payroll team guide |

---

## Deploy status

Code changes ready:
- Employee Information **Choose CSV File** import
- Stricter inactive employee filter (FV/PSO + payroll run)

**Next:** Deploy to staging → payroll team runs contract sync import → re-run gap check.
