'use strict';

const HUZAIFA_FALLBACK = 'huzaifa.rafaqat@asil.com.pk';

function isNamedEmail(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s !== '' && s !== 'n/a' && s !== 'na' && s !== 'none' && s.includes('@');
}

function isActiveEmployee(emp) {
    const a = emp.active == null ? '' : String(emp.active).trim().toLowerCase();
    return a === '' || ['yes', 'true', '1', 'active'].includes(a);
}

function deptMatches(empDept, list) {
    if (!list || !list.length) return true;
    const d = String(empDept || '').trim().toLowerCase();
    return list.some(x => String(x || '').trim().toLowerCase() === d);
}

function ruleMatchesEmployee(rule, emp) {
    if (!rule.active) return false;
    const client = String(emp.client || '').toLowerCase();
    if (rule.client_pattern && !client.includes(String(rule.client_pattern).toLowerCase())) return false;
    if (rule.contract_id && String(emp.contract_id || '') !== String(rule.contract_id)) return false;
    const inc = rule.dept_include || [];
    const exc = rule.dept_exclude || [];
    if (inc.length && !deptMatches(emp.dept, inc)) return false;
    if (exc.length && deptMatches(emp.dept, exc)) return false;
    return true;
}

async function loadEligibilityRules(pool) {
    const { rows } = await pool.query(
        `SELECT * FROM claim_eligibility_rules WHERE active = TRUE ORDER BY priority ASC, id ASC`
    ).catch(() => ({ rows: [] }));
    return rows;
}

async function evaluateEmployeeEligibility(pool, emp, rules = null) {
    const rls = rules || await loadEligibilityRules(pool);
    if (!rls.length) {
        return { eligible: true, ruleId: null, ruleName: 'default (no rules)' };
    }
    const match = rls.find(r => ruleMatchesEmployee(r, emp));
    if (!match) return { eligible: false, ruleId: null, ruleName: 'No matching rule' };
    return {
        eligible: !!match.eligible,
        ruleId: match.id,
        ruleName: match.name,
        allowedClaimTypes: match.allowed_claim_types || ['OT', 'EXPENSE', 'MEDICAL'],
    };
}

function normalizeAuthority(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const v = String(raw).trim();
    if (/^self$/i.test(v)) return 'SELF';
    if (/^n\/?a$/i.test(v)) return null;
    return v.toLowerCase();
}

function resolveFocalEmail(emp) {
    const auth = normalizeAuthority(emp.claim_authority);
    if (!auth || auth === 'SELF') return null;
    return isNamedEmail(auth) ? auth : null;
}

function resolveLmEmail(emp) {
    const lm = (emp.line_manager_email || '').toLowerCase().trim();
    if (isNamedEmail(lm)) return lm;
    const sup = (emp.supervisor_email || '').toLowerCase().trim();
    if (isNamedEmail(sup)) return sup;
    return null;
}

function resolveEmployeeFillerEmail(emp) {
    const email = (emp.email || '').toLowerCase().trim();
    return isNamedEmail(email) ? email : null;
}

/**
 * @returns {{ profile: string, category: string, fillerEmail: string|null, approverEmail: string|null, initiator: string }}
 */
function resolveClaimsRouting(emp) {
    const focal = resolveFocalEmail(emp);
    const lm = resolveLmEmail(emp);
    const empEmail = resolveEmployeeFillerEmail(emp);

    if (focal && lm && focal !== lm) {
        return {
            profile: 'focal_then_lm',
            category: 'Focal + LM',
            fillerEmail: focal,
            approverEmail: lm,
            initiator: 'focal',
        };
    }
    if (focal && (!lm || focal === lm)) {
        return {
            profile: 'focal_only',
            category: 'Focal only',
            fillerEmail: focal,
            approverEmail: focal,
            initiator: 'focal',
        };
    }
    if (!focal && lm) {
        return {
            profile: 'employee_then_lm',
            category: 'Employee + LM',
            fillerEmail: empEmail,
            approverEmail: lm,
            initiator: 'employee',
        };
    }
    return {
        profile: 'employee_then_asil',
        category: 'Employee + ASIL',
        fillerEmail: empEmail,
        approverEmail: HUZAIFA_FALLBACK,
        initiator: 'employee',
    };
}

function resolveClaimsCategory(emp, eligibility = { eligible: true }) {
    if (!eligibility.eligible) {
        return { category: 'Not eligible', profile: 'not_eligible', tooltip: eligibility.ruleName || 'Excluded by rule' };
    }
    const routing = resolveClaimsRouting(emp);
    if (!routing.fillerEmail || (routing.initiator === 'employee' && !routing.fillerEmail)) {
        return {
            category: 'Setup needed',
            profile: 'setup_needed',
            tooltip: 'Missing employee or focal email on roster',
            ...routing,
        };
    }
    const tooltip = [
        routing.initiator === 'focal' ? `Focal: ${routing.fillerEmail}` : `Employee: ${routing.fillerEmail}`,
        routing.approverEmail ? `Approver: ${routing.approverEmail}` : '',
    ].filter(Boolean).join(' · ');
    return { ...routing, tooltip };
}

async function listRules(pool) {
    const { rows } = await pool.query(`SELECT * FROM claim_eligibility_rules ORDER BY priority ASC, id ASC`);
    return rows;
}

async function upsertRule(pool, rule, actor) {
    const fields = {
        name: rule.name,
        priority: parseInt(rule.priority, 10) || 100,
        active: rule.active !== false,
        client_pattern: rule.client_pattern || null,
        contract_id: rule.contract_id || null,
        dept_include: rule.dept_include || [],
        dept_exclude: rule.dept_exclude || [],
        eligible: rule.eligible !== false,
        allowed_claim_types: rule.allowed_claim_types || ['OT', 'EXPENSE', 'MEDICAL'],
        effective_from: rule.effective_from || null,
        effective_to: rule.effective_to || null,
        notes: rule.notes || null,
        updated_at: new Date(),
    };
    if (rule.id) {
        await pool.query(
            `UPDATE claim_eligibility_rules SET
                name=$2, priority=$3, active=$4, client_pattern=$5, contract_id=$6,
                dept_include=$7, dept_exclude=$8, eligible=$9, allowed_claim_types=$10,
                effective_from=$11, effective_to=$12, notes=$13, updated_at=NOW()
             WHERE id=$1`,
            [rule.id, fields.name, fields.priority, fields.active, fields.client_pattern, fields.contract_id,
                fields.dept_include, fields.dept_exclude, fields.eligible, fields.allowed_claim_types,
                fields.effective_from, fields.effective_to, fields.notes]
        );
        return rule.id;
    }
    const { rows } = await pool.query(
        `INSERT INTO claim_eligibility_rules
         (name, priority, active, client_pattern, contract_id, dept_include, dept_exclude,
          eligible, allowed_claim_types, effective_from, effective_to, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [fields.name, fields.priority, fields.active, fields.client_pattern, fields.contract_id,
            fields.dept_include, fields.dept_exclude, fields.eligible, fields.allowed_claim_types,
            fields.effective_from, fields.effective_to, fields.notes, actor || null]
    );
    return rows[0].id;
}

async function previewRuleMatch(pool, ruleId) {
    const { rows: rules } = await pool.query(`SELECT * FROM claim_eligibility_rules WHERE id = $1`, [ruleId]);
    if (!rules.length) return { count: 0, employees: [] };
    const rule = rules[0];
    const { rows: emps } = await pool.query(
        `SELECT id, name, client, dept, claim_authority, line_manager_email, email
         FROM employees
         WHERE (last_working_day IS NULL OR last_working_day >= CURRENT_DATE)`
    );
    const matched = emps.filter(e => isActiveEmployee(e) && ruleMatchesEmployee(rule, e) && rule.eligible);
    return { count: matched.length, employees: matched.slice(0, 50) };
}

async function countEligibleEmployees(pool) {
    const rules = await loadEligibilityRules(pool);
    const { rows: emps } = await pool.query(
        `SELECT id, name, email, claim_authority, supervisor_email, line_manager_email, client, location, dept, salary, contract_id
         FROM employees
         WHERE (last_working_day IS NULL OR last_working_day >= CURRENT_DATE)`
    );
    const eligible = [];
    const skipped = [];
    for (const e of emps) {
        if (!isActiveEmployee(e)) continue;
        const elig = await evaluateEmployeeEligibility(pool, e, rules);
        if (!elig.eligible) {
            skipped.push({ employee_id: e.id, reason: elig.ruleName || 'Not eligible' });
            continue;
        }
        const routing = resolveClaimsRouting(e);
        const cat = resolveClaimsCategory(e, elig);
        if (cat.category === 'Setup needed') {
            skipped.push({ employee_id: e.id, reason: 'Setup needed — missing email' });
            continue;
        }
        eligible.push({
            ...e,
            filler_email: routing.fillerEmail,
            approver_email: routing.approverEmail,
            routing_profile: routing.profile,
            claims_category: cat.category,
            cohort_type: routing.initiator === 'focal' ? 'focal' : 'employee',
        });
    }
    return { eligible, skipped, rules };
}

module.exports = {
    HUZAIFA_FALLBACK,
    isNamedEmail,
    loadEligibilityRules,
    evaluateEmployeeEligibility,
    resolveClaimsRouting,
    resolveClaimsCategory,
    resolveFocalEmail,
    resolveLmEmail,
    listRules,
    upsertRule,
    previewRuleMatch,
    countEligibleEmployees,
    normalizeAuthority,
    ruleMatchesEmployee,
};
