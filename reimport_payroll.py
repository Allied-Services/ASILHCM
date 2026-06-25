"""
Payroll Re-import & Recalculation Script — April 2026
Reads the import template and recalculates all payroll values from scratch.
Updates payroll_transactions with correct gross, net, OT, special allowances.
"""
import psycopg2, csv, sys, json
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
IMPORT_CSV = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\payroll_import_template April 2026.csv'

WORK_DAYS = 26   # April 2026 working days
MONTH, YEAR = 4, 2026
DRY_RUN = False   # set True to preview without writing

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

def calc_wht(annual):
    if annual <= 600000:    return 0
    if annual <= 1200000:   return round(((annual - 600000) * 0.01) / 12)
    if annual <= 2200000:   return round((6000 + (annual - 1200000) * 0.11) / 12)
    if annual <= 3200000:   return round((116000 + (annual - 2200000) * 0.23) / 12)
    if annual <= 4100000:   return round((346000 + (annual - 3200000) * 0.30) / 12)
    return round((616000 + (annual - 4100000) * 0.35) / 12)

def sales_tax_rate(province):
    p = (province or '').lower()
    if any(x in p for x in ['punjab','lahore','rawalpindi','islamabad','multan','faisalabad']): return 0.16
    if any(x in p for x in ['sindh','karachi','hyderabad']): return 0.15
    if any(x in p for x in ['kpk','khyber','peshawar']): return 0.15
    return 0.15

conn = psycopg2.connect(DB)
cur = conn.cursor()

# ── Step 1: Load employees ────────────────────────────────────────────────────
cur.execute("""
    SELECT id, salary, province, location, contract_name, client
    FROM employees
""")
emp_db = {}
for r in cur.fetchall():
    emp_db[r[0]] = {
        'salary':       float(r[1] or 0),
        'province':     r[2] or r[3] or 'Sindh',
        'contract_name':r[4] or '',
        'client':       r[5] or '',
    }


# ── Step 2: Load contracts ────────────────────────────────────────────────────
try:
    cur.execute("SELECT contract_name, financials, costs FROM contracts")
    contract_db = {}
    for r in cur.fetchall():
        fin  = r[1] or {}
        cost = r[2] or {}
        contract_db[r[0]] = {
            'svc_pct':    float(fin.get('service_charges_pct', 0)),
            'eosb_type':  cost.get('eosb_type','None'),
            'life_ins':   float(cost.get('life_insurance', 0)),
            'med_ee':     float(cost.get('medical_ee', 0)),
            'med_sp':     float(cost.get('medical_sp', 0)),
            'med_child':  float(cost.get('medical_child', 0)),
            'overhead':   float(cost.get('overhead_per_employee', 0)),
            'bonus_months': float(cost.get('bonus_months', 0)),
        }
except Exception as ex:
    print(f'Warning: could not load contracts: {ex}')
    conn.rollback()
    contract_db = {}

# ── Step 3: Load existing payroll_transactions (for medical, locked status) ───
cur.execute("""
    SELECT employee_id, net, medical_ee, medical_sp, medical_ch1, medical_ch2, locked
    FROM payroll_transactions
    WHERE month=4 AND year=2026
""")
pt_existing = {}
for r in cur.fetchall():
    pt_existing[r[0]] = {
        'net': float(r[1] or 0),
        'med_ee': r[2], 'med_sp': r[3], 'med_ch1': r[4], 'med_ch2': r[5],
        'locked': r[6],
    }

# ── Step 4: Read import template ──────────────────────────────────────────────
imp_rows = {}
with open(IMPORT_CSV, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        code = (row.get('ASIL Employee Code','') or row.get('Staff Code','')).strip()
        if not code: continue
        imp_rows[code] = {
            'pd':        min(pn(row.get('Present Days', WORK_DAYS)), WORK_DAYS),
            'ot2':       pn(row.get('OT Hrs @ 2X', 0)),
            'ot3':       pn(row.get('OT Hrs @ 3X', 0)),
            'opd':       pn(row.get('OPD', 0)),
            'reimb':     pn(row.get('Expense Reimbursement', 0)),
            'arrears':   pn(row.get('Arrears', 0)),
            'spl':       pn(row.get('Special Allowance', 0)),
            'fuel':      pn(row.get('Other Allowance Fuel | Mobile', 0)),
            'other_ded': pn(row.get('Other Deduction', 0)),
            'bonus':     pn(row.get('Bonus', 0)),
        }

print(f'Import template rows: {len(imp_rows)}')
print(f'Employees in DB: {len(emp_db)}')
print()

# ── Step 5: Calculate + Update ────────────────────────────────────────────────
updated, skipped = 0, 0
errors  = []
total_net, total_inv = 0.0, 0.0
diff_list = []

for code, imp in imp_rows.items():
    e = emp_db.get(code)
    if not e:
        skipped += 1
        continue

    salary = e['salary']
    if salary <= 0:
        skipped += 1
        continue

    # Skip if locked
    pt = pt_existing.get(code, {})
    if pt.get('locked'):
        skipped += 1
        continue

    # Contract config
    cname = e['contract_name']
    cfg   = contract_db.get(cname, {})
    svc_pct    = cfg.get('svc_pct', 0) / 100
    eosb_type  = cfg.get('eosb_type', 'None')
    life_ins   = cfg.get('life_ins', 0)
    med_ee_def = cfg.get('med_ee', 0)
    med_sp_def = cfg.get('med_sp', 0)
    med_ch_def = cfg.get('med_child', 0)
    overhead   = cfg.get('overhead', 0)
    bon_months = cfg.get('bonus_months', 0)

    pd       = imp['pd']
    ot2, ot3 = imp['ot2'], imp['ot3']
    opd      = imp['opd']
    reimb    = imp['reimb']
    arrears  = imp['arrears']
    spl      = imp['spl']
    fuel     = imp['fuel']
    other_d  = imp['other_ded']
    bonus_a  = imp['bonus']

    # Salary proration
    absent_days = max(0, WORK_DAYS - pd)
    absent_ded  = round(absent_days * salary / WORK_DAYS)

    # OT
    hourly  = salary / (WORK_DAYS * 8)
    ot_amt  = round(hourly * 2 * ot2) + round(hourly * 3 * ot3)

    # Gross
    gross = round(salary + ot_amt + opd + reimb + arrears + spl + fuel - absent_ded)

    # Tax
    taxable = gross - opd - reimb
    wht = calc_wht(taxable * 12)

    # EOBI
    eobi_ee = 400
    eobi_er = 2000

    # EOSB — must be before net
    gratuity = round(salary / 12) if eosb_type == 'Gratuity' else 0
    pf_ee    = round(salary / 24) if eosb_type == 'Provident Fund' else 0
    pf_er    = pf_ee  # employer matches employee contribution

    # Net (employee deductions: WHT + EOBI-EE + PF-EE + other_deduction)
    net = gross - wht - eobi_ee - pf_ee - round(other_d)

    # SESSI
    sessi = min(2400, round(gross * 0.06)) if gross < 45000 else 0

    # Medical (use existing if set, else contract default)
    med_ee  = float(pt.get('med_ee') or med_ee_def)
    med_sp  = float(pt.get('med_sp') or med_sp_def)
    med_ch1 = float(pt.get('med_ch1') or med_ch_def)
    med_ch2 = float(pt.get('med_ch2') or 0)
    total_med = med_ee + med_sp + med_ch1 + med_ch2

    # Total payroll cost
    bonus_accrual = round(bon_months * salary / 12) if bon_months > 0 else 0
    total_cost = gross + eobi_er + sessi + gratuity + pf_er + life_ins + total_med + overhead + bonus_accrual + round(bonus_a)

    # Invoice
    svc_chg  = round(total_cost * svc_pct)
    st_rate  = sales_tax_rate(e['province'])
    stax     = round((total_cost + svc_chg) * st_rate)
    total_inv_emp = total_cost + svc_chg + stax

    total_net += net
    total_inv += total_inv_emp

    old_net = pt.get('net', 0)
    diff    = round(net - old_net)
    diff_list.append((code, old_net, net, diff, total_inv_emp))

    if not DRY_RUN:
        try:
            cur.execute("""
                UPDATE payroll_transactions SET
                    paid_days=%s, ot2_hrs=%s, ot3_hrs=%s, ot=%s,
                    opd_claim=%s, reimbursement=%s, arrears=%s,
                    special_allowance=%s, fuel_mobile=%s, other_deduction=%s,
                    bonus_amount=%s,
                    gross=%s, net=%s, wht=%s,
                    service_charges=%s, sales_tax=%s, total_invoice=%s,
                    updated_at=NOW()
                WHERE employee_id=%s AND month=4 AND year=2026 AND locked=FALSE
            """, (
                pd, ot2, ot3, round(ot_amt),
                opd, reimb, arrears,
                spl, fuel, round(other_d),
                round(bonus_a),
                gross, net, wht,
                svc_chg, stax, round(total_inv_emp),
                code
            ))
            if cur.rowcount > 0:
                updated += 1
        except Exception as ex:
            conn.rollback()
            errors.append(f'{code}: {ex}')


if not DRY_RUN:
    conn.commit()

cur.close(); conn.close()

# ── Print results ─────────────────────────────────────────────────────────────
print(f'{"Code":<24} {"OldNet":>10} {"NewNet":>10} {"Diff":>9} {"NewInv":>12}')
print('─' * 72)
for code, old, new, diff, inv in sorted(diff_list, key=lambda x: abs(x[3]), reverse=True)[:40]:
    if abs(diff) > 500:
        print(f'{code:<24} {old:>10,.0f} {new:>10,.0f} {diff:>+9,.0f} {inv:>12,.0f}')

print()
print('=' * 72)
print(f'{"DRY RUN MODE" if DRY_RUN else "COMMITTED TO DB"}')
print(f'Updated : {updated}')
print(f'Skipped : {skipped}')
print(f'Errors  : {len(errors)}')
print(f'Total employees processed: {len(diff_list)}')
print()
print(f'  Projected Total Net Pay  : PKR {total_net:>14,.0f}')
print(f'  Target Net Pay           : PKR    29,420,275')
print(f'  Net Pay Gap              : PKR {total_net - 29_420_275:>+14,.0f}')
print()
print(f'  Projected Total Invoice  : PKR {total_inv:>14,.0f}')
print(f'  Target Invoice           : PKR    44,433,013')
print(f'  Invoice Gap              : PKR {total_inv - 44_433_013:>+14,.0f}')
if errors: print('ERRORS:', errors[:5])
print('=' * 72)
