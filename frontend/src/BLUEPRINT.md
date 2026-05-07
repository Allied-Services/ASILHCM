# ASIL HCM — Frontend Blueprint
**Read this before modifying any frontend component.**  
Last updated: 2026-05-07

---

## Component Structure & Conventions

### File Size Limit
No single component file should exceed **60KB**. Current violations:
- `EmployeeProfile.jsx` (128KB) — split into tab sub-components
- `ClientInformation.jsx` (111KB) — split into tab sub-components
- `PayrollSheet.jsx` (100KB) — extract payroll engine to separate module
- `BillingProcurement.jsx` (94KB)

When a component exceeds 60KB, extract individual tabs or logical sections into their own files.

### Component Naming
- PascalCase for components: `EmployeeProfile`, `PayrollSheet`
- camelCase for utility functions: `calcEOBI`, `fmtRs`
- All components live in `frontend/src/`

---

## State Management Rules

### API Calls
Always use `api.js` functions — never call `fetch()` directly from components:
```js
// CORRECT
import { api } from './api';
const employees = await api.getEmployees();

// WRONG — bypasses auth token injection and error handling
const res = await fetch('https://asilhcm.onrender.com/api/employees');
```

### Loading States
Every async data load **must** have a loading state:
```jsx
const [loading, setLoading] = useState(true);
const [data, setData] = useState([]);

useEffect(() => {
    api.getEmployees()
        .then(d => setData(d.employees || []))
        .catch(err => toast.error(err.message))
        .finally(() => setLoading(false));
}, []);
```

---

## Tax Calculation — Single Source of Truth

**ALL** payroll calculations must use `payrollUtils.js`. Never define tax functions inline inside components.

```js
// CORRECT — import from payrollUtils
import { calcEOBI, calcWHT, calculateSESSI, calcGross } from './payrollUtils';

// WRONG — do NOT redefine in component files
const calcEOBI = () => 400; // ← this caused the SESSI bug
```

### Current canonical functions in `payrollUtils.js`:
| Function | Purpose |
|---|---|
| `calcGross(salary)` | Sum all salary components |
| `calcEOBI(gross)` | Rs. 400 flat (both employee and employer) |
| `calcWHT(annualGross)` | FBR 2025-26 income tax slabs |
| `calculateSESSI(gross)` | 6% if gross < Rs. 45,000, else 0 |

---

## Medical Insurance — Contract-Driven (DO NOT use static employee fields)

The Medical & Insurance tab in `EmployeeProfile.jsx` now auto-calculates from:
1. `contractsList.find(c => c.id === emp.contractId)` — match employee to contract
2. `contract.costs.medical_ee` — self rate (Rs./month)
3. `contract.costs.medical_sp` — spouse rate (Rs./month)
4. `contract.costs.medical_ch` — per-child rate, capped at 2 children

**Never** read from `emp.totalMedicalCoverage` (legacy static field). That field may be stale.

---

## RBAC — Role-Based Navigation

Roles and their access (defined in `App.jsx`):

| Role | Access |
|---|---|
| `superadmin` | Everything |
| `hr_manager` | Employees, Payroll, Documents, Reports |
| `finance_manager` | Payroll (view), Billing, Invoices, POs, AP |
| `finance_proposer` | Bills (create), Invoices (create) |
| `finance_approver` | Bills (approve), Invoices (approve) |
| `ops_manager` | Clients, Contracts, Attendance, KPI |
| `viewer` | Reports, Dashboard only |
| `supervisor` | Attendance marking only |

When adding a new tab/route, update the RBAC matrix in `App.jsx`.

---

## Styling Conventions

- **No TailwindCSS** — all styles are inline or from `index.css` CSS variables
- CSS variables defined in `index.css`: `--bg-dark`, `--bg-card`, `--primary`, `--border`, `--text`, `--text-muted`
- Colors: primary=#38bdf8, success=#22c55e, warning=#f59e0b, danger=#ef4444, purple=#a78bfa

### Standard Card/Row Components (defined at top of each major file)
```jsx
const Card = ({ children, style }) => <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem', ...style }}>{children}</div>;
const Row = ({ label, value }) => <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.88rem' }}><span style={{ color: 'var(--text-muted)' }}>{label}</span><span style={{ fontWeight: 600 }}>{value}</span></div>;
```

---

## api.js — Adding New Endpoints

Always add typed wrapper functions to `api.js`, never call `apiFetch` directly from components:
```js
// In api.js
export const api = {
    // ... existing ...
    
    // New attendance endpoints
    getTeamAttendance: (supervisorId, date) => apiFetch(`/api/attendance/${supervisorId}/${date}`),
    submitAttendance: (data) => apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify(data) }),
};
```

---

## Build & Deployment

- Frontend hosted on: **Render Static Site** (`https://asil-hcm-frontend.onrender.com`)
- API URL configured via: `VITE_API_URL` environment variable in Render dashboard
- Build command: `npm run build` (in `frontend/` directory)
- Build output: `frontend/dist/`
- **Always test `npm run build` locally before pushing** to avoid failed deployments
