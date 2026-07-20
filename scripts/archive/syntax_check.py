import re, sys
sys.stdout.reconfigure(encoding='utf-8')

def check(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        content = f.read()
    lines = content.split('\n')
    print(f'FILE: {path} ({len(lines)} lines)')
    
    first_non_import = None
    for i, l in enumerate(lines):
        s = l.strip()
        if s.startswith('import '):
            if first_non_import is not None:
                print(f'  *** IMPORT AFTER CODE at line {i+1}: {s[:80]}')
        elif s and not s.startswith('//') and not s.startswith('/*') and not s.startswith('*') and not s.startswith('*/'):
            if first_non_import is None:
                first_non_import = i+1
    
    sources = {}
    for i, l in enumerate(lines):
        if l.strip().startswith('import '):
            m = re.search(r"from ['\"]([^'\"]+)['\"]", l)
            if m:
                src = m.group(1)
                if src in sources:
                    print(f'  *** DUPE IMPORT: {src} at lines {sources[src]},{i+1}')
                sources[src] = i+1
    
    for i in range(min(4, len(lines))):
        print(f'  L{i+1}: {lines[i][:120]}')
    print(f'  OK: {len(sources)} imports, first non-import at line {first_non_import}')
    print()

for f in [
    'frontend/src/EmployeeProfile.jsx',
    'frontend/src/EmployeeInformation.jsx',
    'frontend/src/PayrollSheet.jsx',
    'frontend/src/payrollUtils.js'
]:
    try:
        check(f)
    except Exception as e:
        print(f'ERR {f}: {e}')
