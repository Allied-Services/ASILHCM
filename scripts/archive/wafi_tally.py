"""
Focused WAFI tally:
- CSV source: 301 employees (excl. Shahzad Gul, Farman Ullah, Daud Khalid)
- Target: Net Pay = 29,420,275 | Total Invoice = 44,433,013
- HCM: exclude ASIL/SPL-388/21, ASIL/SPL-46/21, ASILFM/SPL/22/125
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'

# 3 extras in HCM not in CSV
EXCLUDE_HCM = {'ASIL/SPL-388/21', 'ASIL/SPL-46/21', 'ASILFM/SPL/22/125'}

TARGET_NET = 29_420_275
TARGET_INV = 44_433_013

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

# ── Load CSV (Wafi only) ─────────────────────────────────────────────────────
csv_rows = {}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        if row.get('Active','').strip().lower() != 'yes': continue
        client = row.get('Client','').strip()
        if 'wafi' not in client.lower(): continue
        code = row.get('ASIL Employee Code','').strip()
        if not code: continue
        csv_rows[code] = {
            'name':       row.get('Employee Name','').strip(),
            'bu':         row.get('Client BU','').strip(),
            'net':        pn(row.get('Net Pay for the Month',0)),
            'total_cost': pn(row.get('Total Payroll Cost',0)),
            'svc_chg':    pn(row.get('Service Charges',0)),
            'sales_tax':  pn(row.get('Sales Tax',0)),
            'total_inv':  pn(row.get('Total Cost',0)),
            'spl':        pn(row.get('Special Allowance',0)),
        }

# ── Load HCM (Wafi, excl. 3 extras) ─────────────────────────────────────────
conn = psycopg2.connect(DB)
cur = conn.cursor()
cur.execute("""
    SELECT e.id, e.name, e.client, e.client_bu,
           pt.net, pt.service_charges, pt.sales_tax, pt.total_invoice, pt.special_allowance
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month=4 AND pt.year=2026
      AND e.client ILIKE %s
""", ('%wafi%',))
hcm_rows = {}
for r in cur.fetchall():
    if r[0] in EXCLUDE_HCM: continue
    hcm_rows[r[0]] = {
        'name': r[1], 'client': r[2], 'bu': r[3],
        'net':   float(r[4] or 0),
        'svc':   float(r[5] or 0),
        'stax':  float(r[6] or 0),
        'tinv':  float(r[7] or 0),
        'spl':   float(r[8] or 0),
    }
cur.close(); conn.close()

# ── Totals ───────────────────────────────────────────────────────────────────
csv_net   = sum(v['net']       for v in csv_rows.values())
csv_inv   = sum(v['total_inv'] for v in csv_rows.values())
csv_svc   = sum(v['svc_chg']   for v in csv_rows.values())
csv_stax  = sum(v['sales_tax'] for v in csv_rows.values())

hcm_net   = sum(v['net']  for v in hcm_rows.values())
hcm_inv   = sum(v['tinv'] for v in hcm_rows.values())
hcm_svc   = sum(v['svc']  for v in hcm_rows.values())
hcm_stax  = sum(v['stax'] for v in hcm_rows.values())

print('=' * 75)
print('  WAFI APRIL 2026 — NET PAY & INVOICE TALLY')
print('=' * 75)
print(f'  {"Metric":<30} {"CSV":>13} {"HCM":>13} {"Diff":>10} {"Status":>8}')
print(f'  {"─"*30} {"─"*13} {"─"*13} {"─"*10} {"─"*8}')
def row(label, cv, hv):
    diff = hv - cv
    status = "✅" if abs(diff) < 500 else "❌"
    print(f'  {label:<30} {cv:>13,.0f} {hv:>13,.0f} {diff:>+10,.0f} {status:>8}')

row("Employee Count",          len(csv_rows),  len(hcm_rows))
row("Net Pay to Employees",    csv_net,        hcm_net)
row("Service Charges",         csv_svc,        hcm_svc)
row("Sales Tax",               csv_stax,       hcm_stax)
row("Total Invoice",           csv_inv,        hcm_inv)
print()
print(f'  Target Net Pay  : {TARGET_NET:>13,}   HCM: {hcm_net:>13,.0f}   Diff: {hcm_net-TARGET_NET:>+,.0f}')
print(f'  Target Invoice  : {TARGET_INV:>13,}   HCM: {hcm_inv:>13,.0f}   Diff: {hcm_inv-TARGET_INV:>+,.0f}')
print()

# ── Only in CSV / Only in HCM ────────────────────────────────────────────────
only_csv = set(csv_rows) - set(hcm_rows)
only_hcm = set(hcm_rows) - set(csv_rows)
print(f'  In CSV but NOT in HCM ({len(only_csv)}):')
for c in sorted(only_csv): print(f'    {c:<24} {csv_rows[c]["name"]}  Net={csv_rows[c]["net"]:,.0f}')
print(f'  In HCM but NOT in CSV ({len(only_hcm)}):')
for c in sorted(only_hcm): print(f'    {c:<24} {hcm_rows[c]["name"]}  Net={hcm_rows[c]["net"]:,.0f}')
print()

# ── Per-employee net diff > Rs 500 ───────────────────────────────────────────
common = set(csv_rows) & set(hcm_rows)
diffs = []
for code in common:
    d = round(hcm_rows[code]['net'] - csv_rows[code]['net'])
    di = round(hcm_rows[code]['tinv'] - csv_rows[code]['total_inv'])
    if abs(d) > 500:
        diffs.append((code, csv_rows[code]['name'], csv_rows[code]['bu'],
                      csv_rows[code]['net'], hcm_rows[code]['net'], d,
                      csv_rows[code]['total_inv'], hcm_rows[code]['tinv'], di))
diffs.sort(key=lambda x: abs(x[5]), reverse=True)

print(f'  Per-employee Net Pay diff > Rs.500: {len(diffs)} employees')
if diffs:
    print(f'  {"Code":<24} {"Name":<28} {"BU":<18} {"CSV_Net":>10} {"HCM_Net":>10} {"NDiff":>8} {"CSV_Inv":>12} {"HCM_Inv":>12} {"IDiff":>8}')
    print('  ' + '─' * 130)
    for r in diffs:
        print(f'  {r[0]:<24} {r[1]:<28} {r[2]:<18} {r[3]:>10,.0f} {r[4]:>10,.0f} {r[5]:>+8,.0f} {r[6]:>12,.0f} {r[7]:>12,.0f} {r[8]:>+8,.0f}')

print('=' * 75)
