"""
Generate JS for browser console to bulk upload employees from CSV.
Output: a javascript snippet to paste into the browser console.
"""
import csv, json, re

def clean(v):
    if v is None: return ""
    v = str(v).strip()
    if re.match(r'^\d+\.\d+E\+\d+$', v, re.I):
        try: v = str(int(float(v)))
        except: pass
    return v

def safe_date(v):
    v = clean(v)
    if not v or len(v) < 6: return ""
    return v[:10]

ENCODING = 'cp1252'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\ASIL_Employee_Master_27MarUpdate.csv'

employees = []
with open(CSV_PATH, encoding=ENCODING) as f:
    reader = csv.DictReader(f)
    for row in reader:
        salary_raw = clean(row.get('Salary (Last/After Increment)') or row.get('Salary') or '0').replace(',', '')
        try: salary = float(salary_raw) if salary_raw else 0
        except: salary = 0

        emp = {
            "id":                  clean(row.get('ASIL Employee Code')),
            "bu":                  clean(row.get('ASIL BU')),
            "active":              clean(row.get('Active')) or 'Yes',
            "client":              clean(row.get('CLIENT NAME')),
            "contractName":        clean(row.get('Contract Name')),
            "clientBU":            clean(row.get('Client Business Unit')),
            "dept":                clean(row.get('Department')),
            "designation":         clean(row.get('Designation')),
            "location":            clean(row.get('Client Location')),
            "province":            clean(row.get('Province')),
            "region":              clean(row.get('Province')),
            "name":                clean(row.get('Employee Name')),
            "fatherName":          clean(row.get("Father's Name")),
            "salary":              salary,
            "cnic":                clean(row.get('CNIC Number')),
            "cnicIssue":           safe_date(row.get('CNIC Issue')),
            "cnicExpiry":          safe_date(row.get('CNIC Expiry')),
            "eobiNo":              clean(row.get('EOBI No')),
            "religion":            clean(row.get('Religion')),
            "maritalStatus":       clean(row.get('Marital Status')),
            "primaryContact":      clean(row.get('Primary Contact')),
            "emergencyContact":    clean(row.get('Emergency Contact')),
            "email":               clean(row.get('Email Address')),
            "dob":                 safe_date(row.get('Date of Birth')),
            "doj":                 safe_date(row.get('Date of Joining')),
            "spouseName":          clean(row.get('Spouse Name')),
            "child1Name":          clean(row.get('Child 1 Name')),
            "child2Name":          clean(row.get('Child 2 Name')),
            "bankName":            clean(row.get('Bank Name')),
            "bankAccount":         clean(row.get('Bank Account')),
            "accountTitle":        clean(row.get('Account Title')),
            "nokName":             clean(row.get('NEXT OF KIN NAME')),
            "nokRelation":         clean(row.get('NEXT OF KIN RELATION')),
            "nokContact":          clean(row.get('NEXT OF KIN CONTACT')),
            "totalMedicalCoverage": clean(row.get('Total Medical Coverage (Self & Family)')),
        }
        if emp["id"]:
            employees.append(emp)

print(f"Total employees: {len(employees)}")

# Split into batches of 50 and write JS
BATCH = 50
batches = [employees[i:i+BATCH] for i in range(0, len(employees), BATCH)]

js_lines = [
    "const token = localStorage.getItem('asil_hcm_token');",
    "const API = 'https://asilhcm.onrender.com';",
    "let totalOK = 0, totalFail = 0;",
    f"const batches = {json.dumps(batches, ensure_ascii=False)};",
    """
for (let i = 0; i < batches.length; i++) {
  try {
    const r = await fetch(`${API}/api/employees/bulk`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ employees: batches[i] })
    });
    const d = await r.json();
    if (r.ok) { 
      totalOK += batches[i].length;
      console.log(`Batch ${i+1}/${batches.length}: created=${d.created||0} updated=${d.updated||0} ok=${totalOK}`);
    } else {
      totalFail += batches[i].length;
      console.error(`Batch ${i+1} FAILED:`, r.status, d);
    }
  } catch(e) { totalFail += batches[i].length; console.error(`Batch ${i+1} ERROR:`, e.message); }
}
console.log(`DONE: ${totalOK} OK, ${totalFail} failed`);
"""
]

js = '\n'.join(js_lines)
out_path = r'G:\My Drive\Experiments\BPOFMSystem\upload_employees.js'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(js)
print(f"Written to {out_path}")
print(f"JS file size: {len(js):,} bytes")
