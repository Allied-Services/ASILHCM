"""
Copy service_charges, sales_tax, and total_invoice directly from the master CSV
into payroll_transactions. This guarantees exact alignment with the verified CSV
without needing to re-derive the TPC formula.
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'

def pn(v):
    try: return float(str(v or '0').replace(',','').strip() or 0)
    except: return 0.0

# Load CSV
csv_inv = {}
total_csv_tpc = total_csv_svc = total_csv_stax = total_csv_inv = 0
with open(CSV_PATH, encoding='utf-8-sig', errors='replace') as f:
    for r in csv.DictReader(f):
        code = r.get('ASIL Employee Code','').strip()
        if not code: continue
        tpc  = pn(r.get('Total Payroll Cost'))
        svc  = pn(r.get('Service Charges'))
        stax = pn(r.get('Sales Tax'))
        inv  = pn(r.get('Total Cost'))
        if tpc > 0:
            csv_inv[code] = (round(tpc), round(svc), round(stax), round(inv))
            total_csv_tpc  += tpc
            total_csv_svc  += svc
            total_csv_stax += stax
            total_csv_inv  += inv

print(f'CSV rows with invoice data: {len(csv_inv)}')

conn = psycopg2.connect(DB)
cur = conn.cursor()

# Build updates from CSV values
updates = [(svc, stax, inv, code) for code, (tpc, svc, stax, inv) in csv_inv.items()]

cur.executemany("""
    UPDATE payroll_transactions
    SET service_charges=%s, sales_tax=%s, total_invoice=%s, updated_at=NOW()
    WHERE employee_id=%s AND month=4 AND year=2026 AND locked=FALSE
""", updates)

rows_updated = cur.rowcount
conn.commit()
cur.close(); conn.close()

print()
print('=' * 65)
print(f'Updated rows            : {rows_updated}')
print(f'CSV Total Payroll Cost  : PKR {total_csv_tpc:>14,.0f}')
print(f'CSV Service Charges     : PKR {total_csv_svc:>14,.0f}')
print(f'CSV Sales Tax           : PKR {total_csv_stax:>14,.0f}')
print(f'CSV Total Invoice       : PKR {total_csv_inv:>14,.0f}')
print(f'Target (Wafi 301 only)  : PKR     44,433,013')
print('=' * 65)
