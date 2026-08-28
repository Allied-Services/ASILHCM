'use strict';

const {
    isClaimsWorkMailbox,
    SADIA_SETUP_EMAIL,
} = require('../employees/contactEmails');

const HUZAIFA_FALLBACK = 'huzaifa.rafaqat@asil.com.pk';
const SADIA_FALLBACK = 'sadia.komal@asil.com.pk';

function dedicatedPayrollEmail(rulebook) {
    const e = String(rulebook?.dedicated_payroll_resource_email || '').trim().toLowerCase();
    return isNamedEmail(e) ? e : SADIA_FALLBACK;
}

function asilContractFocalEmail(rulebook) {
    const e = String(rulebook?.allied_contract_focal_email || '').trim().toLowerCase();
    return isNamedEmail(e) ? e : dedicatedPayrollEmail(rulebook);
}

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
    if (!match) {
        return { eligible: true, ruleId: null, ruleName: 'No matching rule (send-screen filters decide)' };
    }
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
    // Wafi or asil.com.pk only. Personal Gmail is for payslips, never for gathering claims.
    const email = isClaimsWorkMailbox(emp.email);
    return email ? email.toLowerCase() : null;
}

function isFinalSubmitProfile(profile) {
    return profile === 'focal_only' || profile === 'lm_only';
}

const OFFICIAL_EMAIL_DOMAINS = ['wafi-energy.com', 'asil.com.pk'];

/** Corporate roster email — not personal Gmail/Yahoo used when no official address. */
function isOfficialEmployeeEmail(emp) {
    const email = String(emp?.email || '').trim().toLowerCase();
    if (!isNamedEmail(email)) return false;
    const domain = email.split('@')[1] || '';
    return OFFICIAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function resolveExplicitRouting(emp, rulebook) {
    const focal = resolveFocalEmail(emp);
    const lm = resolveLmEmail(emp);
    const empEmail = resolveEmployeeFillerEmail(emp);
    const payroll = dedicatedPayrollEmail(rulebook);
    const asilFocal = asilContractFocalEmail(rulebook);
    const supervisor = String(emp.asil_site_supervisor_email || '').toLowerCase().trim();
    const mode = rulebook.routing_mode;

    if (mode === 'employee_then_focal') {
        return {
            profile: 'employee_then_focal',
            category: 'Employee + Focal',
            fillerEmail: empEmail,
            approverEmail: focal || asilFocal,
            initiator: 'employee',
        };
    }
    if (mode === 'employee_then_lm') {
        return {
            profile: 'employee_then_lm',
            category: 'Employee + LM',
            fillerEmail: empEmail,
            approverEmail: lm || payroll,
            initiator: 'employee',
        };
    }
    if (mode === 'focal_then_lm') {
        return {
            profile: 'focal_then_lm',
            category: 'Focal + LM',
            fillerEmail: focal || payroll,
            approverEmail: lm || payroll,
            initiator: 'focal',
        };
    }
    if (mode === 'focal_only') {
        return {
            profile: 'focal_only',
            category: 'Focal only',
            fillerEmail: focal || payroll,
            approverEmail: focal || payroll,
            initiator: 'focal',
        };
    }
    if (mode === 'lm_only') {
        return {
            profile: 'lm_only',
            category: 'LM only',
            fillerEmail: lm || payroll,
            approverEmail: lm || payroll,
            initiator: 'lm',
        };
    }
    if (mode === 'employee_then_asil') {
        return {
            profile: 'employee_then_asil',
            category: 'Employee + ASIL',
            fillerEmail: empEmail || payroll,
            approverEmail: payroll,
            initiator: empEmail ? 'employee' : 'lm',
        };
    }
    if (mode === 'asil_supervisor_then_focal') {
        return {
            profile: 'asil_supervisor_then_focal',
            category: 'ASIL supervisor + Focal',
            fillerEmail: isNamedEmail(supervisor) ? supervisor : payroll,
            approverEmail: asilFocal,
            initiator: 'lm',
        };
    }
    return null;
}

/**
 * Routing rules (owner Aug 2026) when routing_mode is `auto`:
 * - Focal + LM → Focal fills, LM approves.
 * - Focal only (no LM) → Focal fills and approves (final).
 * - No focal + LM → LM fills and approves (final).
 * - No focal + no LM + official @wafi-energy.com / @asil.com.pk → Employee fills, Dedicated Payroll Resource approves.
 * - No focal + no LM + personal email → Dedicated Payroll Resource fills and approves (final).
 *
 * Explicit contract routing_mode values a–g override auto.
 *
 * @returns {{ profile: string, category: string, fillerEmail: string|null, approverEmail: string|null, initiator: string }}
 */
function resolveClaimsRouting(emp, rulebook) {
    if (rulebook?.routing_mode && rulebook.routing_mode !== 'auto') {
        const explicit = resolveExplicitRouting(emp, rulebook);
        if (explicit) return explicit;
    }

    const focal = resolveFocalEmail(emp);
    const lm = resolveLmEmail(emp);
    const empEmail = resolveEmployeeFillerEmail(emp);
    const payroll = dedicatedPayrollEmail(rulebook);

    // Focal + LM (different people) — focal always fills.
    if (focal && lm && focal !== lm) {
        return {
            profile: 'focal_then_lm',
            category: 'Focal + LM',
            fillerEmail: focal,
            approverEmail: lm,
            initiator: 'focal',
        };
    }

    // Focal without separate LM (or focal is LM) — focal fills and final.
    if (focal && (!lm || focal === lm)) {
        return {
            profile: 'focal_only',
            category: 'Focal only',
            fillerEmail: focal,
            approverEmail: focal,
            initiator: 'focal',
        };
    }
    // No focal, has LM — LM fills and final.
    if (!focal && lm) {
        return {
            profile: 'lm_only',
            category: 'LM only',
            fillerEmail: lm,
            approverEmail: lm,
            initiator: 'lm',
        };
    }

    // No focal, no LM + official work mailbox — employee fills, contract payroll resource approves.
    if (empEmail) {
        return {
            profile: 'employee_then_asil',
            category: 'Employee + ASIL',
            fillerEmail: empEmail,
            approverEmail: payroll,
            initiator: 'employee',
        };
    }

    // No focal, no LM + personal / missing work mailbox — payroll resource fills and final.
    return {
        profile: 'lm_only',
        category: 'ASIL only',
        fillerEmail: payroll,
        approverEmail: payroll,
        initiator: 'lm',
    };
}

async function resolveClaimsRoutingForEmployee(pool, emp) {
    const { getRulebookForEmployee } = require('../records/rulebook');
    const { resolveAsilSupervisor } = require('../records/contacts');
    const book = await getRulebookForEmployee(pool, emp);
    let enriched = emp;
    if (book.routing_mode === 'asil_supervisor_then_focal') {
        enriched = { ...emp, asil_site_supervisor_email: await resolveAsilSupervisor(pool, emp) };
    }
    return resolveClaimsRouting(enriched, book);
}

function resolveClaimsCategory(emp, eligibility = { eligible: true }, rulebook) {
    if (!eligibility.eligible) {
        return { category: 'Not eligible', profile: 'not_eligible', tooltip: eligibility.ruleName || 'Excluded by rule' };
    }
    const routing = resolveClaimsRouting(emp, rulebook);
    if (routing.profile === 'setup_needed' || !routing.fillerEmail) {
        return {
            ...routing,
            category: 'Setup needed',
            profile: 'setup_needed',
            tooltip: 'No Focal, no Wafi/ASIL employee mailbox, and no Line Manager — emailed to Sadia Komal to update',
        };
    }
    const actor = routing.initiator === 'focal'
        ? `Focal: ${routing.fillerEmail}`
        : routing.initiator === 'lm'
            ? `LM (final): ${routing.fillerEmail}`
            : `Employee: ${routing.fillerEmail}`;
    const tooltip = [
        actor,
        routing.approverEmail && routing.approverEmail !== routing.fillerEmail
            ? `Approver: ${routing.approverEmail}`
            : (isFinalSubmitProfile(routing.profile) ? 'Submit is final' : ''),
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
        `SELECT e.id, e.name, e.email, e.claim_authority, e.supervisor_email, e.line_manager_email,
                e.client, e.active,
                COALESCE(NULLIF(TRIM(e.location), ''), NULLIF(TRIM(e.site), '')) AS location,
                e.dept, e.salary, e.contract_id,
                COALESCE(c.contract_name, e.contract_name) AS contract_name
         FROM employees e
         LEFT JOIN contracts c ON c.id::text = e.contract_id::text
         WHERE (e.last_working_day IS NULL OR e.last_working_day >= CURRENT_DATE)`
    );
    const eligible = [];
    const skipped = [];
    for (const e of emps) {
        if (!isActiveEmployee(e)) continue;
        const elig = await evaluateEmployeeEligibility(pool, e, rules);
        if (!elig.eligible) {
            skipped.push({
                employee_id: e.id,
                name: e.name,
                client: e.client,
                dept: e.dept,
                reason: elig.ruleName || 'Not eligible',
                category: 'not_eligible',
            });
            continue;
        }
        const routing = await resolveClaimsRoutingForEmployee(pool, e);
        const cat = resolveClaimsCategory(e, elig);
        if (cat.category === 'Setup needed') {
            skipped.push({
                employee_id: e.id,
                name: e.name,
                client: e.client,
                dept: e.dept,
                contract_name: e.contract_name || '',
                reason: 'No Focal, no Wafi/ASIL mailbox, and no Line Manager',
                category: 'setup_needed',
                notify_email: SADIA_SETUP_EMAIL,
            });
            continue;
        }
        eligible.push({
            ...e,
            filler_email: routing.fillerEmail,
            approver_email: routing.approverEmail,
            routing_profile: routing.profile,
            claims_category: cat.category,
            cohort_type: routing.initiator === 'employee' ? 'employee' : 'focal',
        });
    }
    return { eligible, skipped, rules };
}

module.exports = {
    HUZAIFA_FALLBACK,
    SADIA_FALLBACK,
    SADIA_SETUP_EMAIL,
    isFinalSubmitProfile,
    isNamedEmail,
    loadEligibilityRules,
    evaluateEmployeeEligibility,
    resolveClaimsRouting,
    resolveClaimsRoutingForEmployee,
    resolveClaimsCategory,
    resolveFocalEmail,
    resolveLmEmail,
    isOfficialEmployeeEmail,
    listRules,
    upsertRule,
    previewRuleMatch,
    countEligibleEmployees,
    normalizeAuthority,
    ruleMatchesEmployee,
};
