"""Patch server.js to add migration for contract_name, region, end_of_service, region_province"""
path = r'G:\My Drive\Experiments\BPOFMSystem\backend\server.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

search = "contract_date DATE;\n        `).catch(() => {});"
addition = """contract_date DATE;
        `).catch(() => {});

        // New cols: employees (contract_name + region); contracts (end_of_service + region_province)
        await pool.query(`
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_name TEXT;
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS region TEXT;
        `).catch(() => {});
        await pool.query(`
            ALTER TABLE contracts ADD COLUMN IF NOT EXISTS end_of_service TEXT DEFAULT 'Gratuity';
            ALTER TABLE contracts ADD COLUMN IF NOT EXISTS region_province TEXT;
        `).catch(() => {});
        console.log('Migration OK: contract_name/region on employees; end_of_service/region_province on contracts');"""

# Try both CRLF and LF
for nl in ['\r\n', '\n']:
    s = search.replace('\n', nl)
    a = addition.replace('\n', nl)
    if s in content:
        content = content.replace(s, a, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'PATCHED OK (nl={repr(nl)})')
        break
else:
    # Try stripping all CRLF and normalizing
    content_norm = content.replace('\r\n', '\n')
    if search in content_norm:
        content_norm = content_norm.replace(search, addition, 1)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content_norm)
        print('PATCHED OK (normalized)')
    else:
        print('COULD NOT FIND. First 5 occurrences of "contract_date":')
        idx = 0
        for _ in range(5):
            idx = content_norm.find('contract_date', idx)
            if idx < 0: break
            print(repr(content_norm[max(0,idx-50):idx+80]))
            idx += 1
