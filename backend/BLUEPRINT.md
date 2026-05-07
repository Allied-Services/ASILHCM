# ASIL HCM — Backend Blueprint
**Read this before modifying any backend file.**  
Last updated: 2026-05-07

---

## Architecture Rules

### 1. Authentication — ALWAYS Required on `/api/*`
Every `/api/` route **must** have `requireAuth` as the second argument. No exceptions.
```js
// CORRECT
app.get('/api/employees', requireAuth, async (req, res) => { ... });

// WRONG — exposes data publicly
app.get('/api/employees', async (req, res) => { ... });
```
**Exceptions:** `/health`, `/`, `/auth/google`, `/auth/google/callback`, `/api/portal/*` (employee portal has its own `requirePortalAuth`).

### 2. Role Guards — Use `requireRole()`
```js
// Roles: 'superadmin', 'hr_manager', 'finance_manager', 'finance_proposer',
//        'finance_approver', 'ops_manager', 'viewer'
app.delete('/api/employees/:id', requireAuth, requireRole('superadmin'), async ...);
app.post('/api/payroll/:y/:m/lock', requireAuth, requireRole('hr_manager', 'superadmin'), async ...);
```

### 3. Error Handling — Never Expose DB Internals to Client
```js
// CORRECT
} catch (err) {
    console.error('[route-name]', err);
    res.status(500).json({ error: 'Internal server error' });
}

// WRONG — exposes table names, column names, PostgreSQL version to browser
} catch (err) { res.status(500).json({ error: err.message }); }
```

### 4. Parameterized Queries — Always
```js
// CORRECT
pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id])

// WRONG — SQL injection risk
pool.query(`SELECT * FROM employees WHERE id = '${req.params.id}'`)
```

### 5. Avoid N+1 Queries — Batch Operations
When processing multiple rows, use `UNNEST` or bulk INSERT instead of looping:
```js
// CORRECT (bulk insert)
const vals = employees.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',');
await pool.query(`INSERT INTO table (a,b,c) VALUES ${vals}`, employees.flatMap(e => [e.a, e.b, e.c]));

// WRONG (N+1)
for (const emp of employees) {
    await pool.query('INSERT INTO table (a,b,c) VALUES ($1,$2,$3)', [emp.a, emp.b, emp.c]);
}
```

---

## Database Conventions

### Pool Configuration
```js
// backend/server.js — configured limits for Neon free tier
max: 10,                       // Never exceed 10; Neon free caps at 100 total
idleTimeoutMillis: 30000,
connectionTimeoutMillis: 5000,
```

### Table Naming
- Snake_case: `payroll_transactions`, `purchase_orders`, `hcm_users`
- Always use `IF NOT EXISTS` in migrations
- Migrations run on every server startup (idempotent)

### JSON Columns
Several tables use JSONB columns for flexibility:
- `contracts.costs` — all financial parameters (medical_ee, medical_sp, bonus_months, etc.)
- `employees` — salary history, leave history stored as JSONB arrays
- Access with: `costs->>'medical_ee'` (text) or `costs->'costs'` (JSON)

---

## Statutory Business Rules (Pakistan Labour Law)

| Rule | Value | Source |
|---|---|---|
| EOBI (Employee) | Rs. 400/month flat | Statutory |
| EOBI (Employer) | Rs. 400/month flat | Statutory |
| SESSI | 6% of gross | **EXEMPT if gross ≥ Rs. 45,000** |
| Income Tax | Sliding scale | `taxEngine.js` — DO NOT INLINE |
| PF | Contract-defined % | From `costs.pf_percentage` |
| Gratuity | 1/26 × basic × years | Min 1 year of service |
| EOSB | Contract-defined | From `costs.eosb_type` |

**CRITICAL:** Always use `taxEngine.js` for tax calculations. Never inline tax logic in routes.
```js
const { calculateSESSI, calculateWHT } = require('./taxEngine');
```

---

## Key Endpoints Reference

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | None | Render health check + UptimeRobot ping |
| GET | `/api/employees` | requireAuth | All active employees |
| POST | `/api/payroll/:y/:m/lock` | hr_manager+ | Lock payroll for month |
| POST | `/api/payroll/:y/:m/unlock` | superadmin | Unlock locked payroll |
| GET | `/api/debug/bonus-check` | superadmin | Contract cost diagnostic |
| POST | `/api/migrate/asil-migrate-2026-x9k7` | superadmin | Run schema migrations |

---

## Adding a New Route — Checklist
- [ ] Uses `requireAuth`
- [ ] Uses `requireRole()` if write/delete
- [ ] Catch block logs `err` and returns generic message (not `err.message`)
- [ ] Uses parameterized queries
- [ ] No `pool.query` inside a loop
- [ ] Added to `api.js` on frontend with a typed function name
