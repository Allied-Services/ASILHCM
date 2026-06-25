"""
Fix service charges using TOTAL PAYROLL COST (not just gross).
TPC = gross + EOBI_er + SESSI + gratuity/PF_er + life_insurance + medical + overhead + bonus_accrual
Service Charges = TPC × rate
Sales Tax = (TPC + Service Charges) × province_rate

Rates:
  BPO (ASIL/SPL):                  18%
  FM Trading & Supply (ASILFM+T&S): 13.5%
  FM Other (ASILFM, other BU):      17.5%
"""
import psycopg2, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

def st_rate(province):
    p = (province or '').lower()
    if any(x in p for x in ['punjab','lahore','rawalpindi','islamabad','multan','faisalabad']): return 0.16
    return 0.15

def svc_rate(emp_code, bu):
    if emp_code.upper().startswith('ASILFM'):
        return 0.135 if ('trading' in (bu or '').lower() and 'supply' in (bu or '').lower()) else 0.175
    return 0.18

conn = psycopg2.connect(DB)
cur = conn.cursor()

# 1. Employees (salary, province, contract_name, client_bu)
cur.execute("SELECT id, salary, province, location, contract_name, client_bu FROM employees")
emp_db = {r[0]: {'salary': float(r[1] or 0), 'province': r[2] or r[3] or 'Sindh',
                  'contract_name': r[4] or '', 'bu': r[5] or ''} for r in cur.fetchall()}

# 2. Contracts (operational costs)
cur.execute("SELECT contract_name, costs FROM contracts")
contract_db = {}
for r in cur.fetchall():
    c = r[1] or {}
    contract_db[r[0]] = {
        'eosb_type':  c.get('eosb_type', 'None'),
        'life_ins':   float(c.get('life_insurance', 0)),
        'med_ee':     float(c.get('medical_ee', 0)),
        'med_sp':     float(c.get('medical_sp', 0)),
        'med_child':  float(c.get('medical_child', 0)),
        'overhead':   float(c.get('overhead_per_employee', 0)),
        'bon_months': float(c.get('bonus_months', 0)),
    }

# 3. Current payroll transactions (gross, net, medical overrides, locked)
cur.execute("""
    SELECT employee_id, gross, net, medical_ee, medical_sp, medical_ch1, medical_ch2, locked
    FROM payroll_transactions WHERE month=4 AND year=2026
""")
pt_db = {r[0]: {'gross': float(r[1] or 0), 'net': float(r[2] or 0),
                 'med_ee': r[3], 'med_sp': r[4], 'med_ch1': r[5], 'med_ch2': r[6],
                 'locked': r[7]} for r in cur.fetchall()}

# 4. Build updates
updates = []
total_tpc = total_svc = total_stax = total_inv = 0

for code, pt in pt_db.items():
    if pt['locked']: continue
    e   = emp_db.get(code, {})
    cfg = contract_db.get(e.get('contract_name', ''), {})
    gross = pt['gross']
    salary = e.get('salary', gross)

    eosb = cfg.get('eosb_type', 'None')
    gratuity = round(salary / 12) if eosb == 'Gratuity' else 0
    pf_er    = round(salary / 24) if eosb == 'Provident Fund' else 0
    sessi    = min(2400, round(gross * 0.06)) if gross < 45000 else 0
    life_ins = cfg.get('life_ins', 0)
    overhead = cfg.get('overhead', 0)
    bon_acc  = round(cfg.get('bon_months', 0) * salary / 12)

    # Medical: use stored override or contract default
    med_ee  = float(pt['med_ee'] or cfg.get('med_ee', 0))
    med_sp  = float(pt['med_sp'] or cfg.get('med_sp', 0))
    med_ch1 = float(pt['med_ch1'] or cfg.get('med_child', 0))
    med_ch2 = float(pt['med_ch2'] or 0)
    total_med = med_ee + med_sp + med_ch1 + med_ch2

    # Total Payroll Cost (employer billing base)
    tpc = gross + 2000 + sessi + gratuity + pf_er + life_ins + total_med + overhead + bon_acc

    bu  = e.get('bu', '')
    sr  = svc_rate(code, bu)
    str_ = st_rate(e.get('province', 'Sindh'))
    svc  = round(tpc * sr)
    stax = round((tpc + svc) * str_)
    tinv = tpc + svc + stax

    total_tpc  += tpc
    total_svc  += svc
    total_stax += stax
    total_inv  += tinv
    updates.append((svc, stax, tinv, code))

print(f"Prepared {len(updates)} updates")
cur.executemany("""
    UPDATE payroll_transactions
    SET service_charges=%s, sales_tax=%s, total_invoice=%s, updated_at=NOW()
    WHERE employee_id=%s AND month=4 AND year=2026 AND locked=FALSE
""", updates)
conn.commit()
cur.close(); conn.close()

print()
print('=' * 65)
print(f'Updated                  : {len(updates)} rows')
print(f'Total Payroll Cost (TPC) : PKR {total_tpc:>14,.0f}')
print(f'Service Charges          : PKR {total_svc:>14,.0f}')
print(f'Sales Tax                : PKR {total_stax:>14,.0f}')
print(f'Total Invoice (ALL)      : PKR {total_inv:>14,.0f}')
print()
# Wafi-only estimate (301 employees ≈ 60% of 516)
print(f'Target Invoice (Wafi 301): PKR     44,433,013')
print(f'  Note: above is ALL {len(updates)} employees. Run wafi_tally.py for Wafi-only.')
print('=' * 65)
