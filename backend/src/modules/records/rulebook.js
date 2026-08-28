'use strict';

const { getPolicy, upsertPolicy } = require('../constraints/service');
const { getClaimsPolicy, upsertClaimsPolicy } = require('../claims/claimsPolicy');

const COMMERCIAL_TYPES = ['cost_plus', 'fixed_value'];
const ENGINES = ['legacy', 'runs'];
const ROUTING_MODES = [
    'auto',
    'employee_then_focal',
    'employee_then_lm',
    'focal_then_lm',
    'focal_only',
    'lm_only',
    'employee_then_asil',
    'asil_supervisor_then_focal',
];

function inferCommercialType(policy, contract) {
    const existing = String(policy?.commercial_type || '').trim();
    if (COMMERCIAL_TYPES.includes(existing)) return existing;
    const billing = String(policy?.billing_model || '').toLowerCase();
    if (billing === 'service_order_deduction' || billing === 'fixed_value') return 'fixed_value';
    const svc = String(contract?.service_type || '').toLowerCase();
    if (svc.includes('fixed value') || svc.includes('conservancy')) return 'fixed_value';
    const id = String(contract?.id || '');
    if (id.startsWith('CTR-PSO-')) return 'fixed_value';
    return 'cost_plus';
}

function shapeRulebook(contract, policy, claims) {
    const commercial_type = inferCommercialType(policy, contract);
    return {
        contract_id: contract.id,
        contract_name: contract.contract_name,
        client_id: contract.client_id,
        client_name: contract.client_name || null,
        commercial_type,
        payroll_engine: ENGINES.includes(policy?.payroll_engine) ? policy.payroll_engine : 'legacy',
        billing_model: policy?.billing_model || (commercial_type === 'fixed_value' ? 'service_order_deduction' : 'cost_plus'),
        attendance_input_mode: policy?.attendance_input_mode || 'full_ledger',
        proration_basis: policy?.proration_basis || 'calendar_30',
        standard_month_days: policy?.standard_month_days != null ? Number(policy.standard_month_days) : 30,
        ot_allowed: policy?.ot_allowed !== false,
        ot_applicable_tiers: policy?.ot_applicable_tiers || ['2x', '3x'],
        ot_divisor_days: policy?.ot_divisor_days != null ? Number(policy.ot_divisor_days) : 26,
        ot_divisor_hours: policy?.ot_divisor_hours != null ? Number(policy.ot_divisor_hours) : 8,
        ot_monthly_cap_hours: policy?.ot_monthly_cap_hours != null ? Number(policy.ot_monthly_cap_hours) : null,
        service_charge_pct: policy?.service_charge_pct != null ? Number(policy.service_charge_pct) : 0.18,
        sales_tax_rate: policy?.sales_tax_rate != null ? Number(policy.sales_tax_rate) : null,
        sales_tax_exempt: !!policy?.sales_tax_exempt,
        income_tax_wht_pct: policy?.income_tax_wht_pct != null ? Number(policy.income_tax_wht_pct) : null,
        credit_days: policy?.credit_days != null ? Number(policy.credit_days) : 30,
        invoice_frequency: policy?.invoice_frequency || 'monthly',
        invoice_day_of_month: policy?.invoice_day_of_month != null ? Number(policy.invoice_day_of_month) : 1,
        po_required: !!policy?.po_required,
        overhead_per_employee: policy?.overhead_per_employee != null ? Number(policy.overhead_per_employee) : null,
        medical_in_cost: policy?.medical_in_cost !== false,
        employer_pf_in_cost: policy?.employer_pf_in_cost !== false,
        sessi_basis: policy?.sessi_basis || 'salary_45k',
        allied_contract_focal_email: policy?.allied_contract_focal_email || contract.allied_focal_email || null,
        dedicated_payroll_resource_email:
            policy?.dedicated_payroll_resource_email
            || contract.dedicated_payroll_resource_email
            || policy?.allied_contract_focal_email
            || contract.allied_focal_email
            || null,
        routing_mode: ROUTING_MODES.includes(policy?.routing_mode) ? policy.routing_mode : 'auto',
        claims: claims || {},
        policy_id: policy?.id || null,
    };
}

async function loadContractRow(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT c.*, cl.name AS client_name
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE c.id = $1`,
        [contractId]
    );
    return rows[0] || null;
}

async function getRulebook(pool, contractId) {
    const contract = await loadContractRow(pool, contractId);
    if (!contract) {
        const err = new Error('Contract not found');
        err.status = 404;
        err.code = 'CONTRACT_NOT_FOUND';
        throw err;
    }
    const policy = await getPolicy(pool, contractId);
    const claims = await getClaimsPolicy(pool, contractId);
    return shapeRulebook(contract, policy, claims);
}

async function saveRulebook(pool, contractId, body, actor) {
    const current = await getRulebook(pool, contractId);
    const commercial = COMMERCIAL_TYPES.includes(body.commercial_type)
        ? body.commercial_type
        : current.commercial_type;
    const engine = ENGINES.includes(body.payroll_engine) ? body.payroll_engine : current.payroll_engine;
    const routing = ROUTING_MODES.includes(body.routing_mode) ? body.routing_mode : current.routing_mode;
    const focal = String(body.allied_contract_focal_email || '').trim().toLowerCase();
    if (!focal || !focal.includes('@')) {
        const err = new Error('ASIL Contract Focal email is required');
        err.status = 400;
        err.code = 'FOCAL_REQUIRED';
        throw err;
    }
    const payrollResource = String(body.dedicated_payroll_resource_email || focal).trim().toLowerCase();

    const policyRow = await upsertPolicy(pool, {
        contract_id: contractId,
        billing_model: body.billing_model || (commercial === 'fixed_value' ? 'service_order_deduction' : current.billing_model),
        attendance_input_mode: body.attendance_input_mode || current.attendance_input_mode,
        standard_month_days: body.standard_month_days != null ? body.standard_month_days : current.standard_month_days,
        ot_allowed: body.ot_allowed != null ? !!body.ot_allowed : current.ot_allowed,
        ot_monthly_cap_hours: body.ot_monthly_cap_hours != null ? body.ot_monthly_cap_hours : current.ot_monthly_cap_hours,
        ot_divisor_days: body.ot_divisor_days != null ? body.ot_divisor_days : current.ot_divisor_days,
        ot_divisor_hours: body.ot_divisor_hours != null ? body.ot_divisor_hours : current.ot_divisor_hours,
        service_charge_pct: body.service_charge_pct != null ? body.service_charge_pct : current.service_charge_pct,
        credit_days: body.credit_days != null ? body.credit_days : current.credit_days,
        invoice_frequency: body.invoice_frequency || current.invoice_frequency,
        invoice_day_of_month: body.invoice_day_of_month != null ? body.invoice_day_of_month : current.invoice_day_of_month,
        po_required: body.po_required != null ? !!body.po_required : current.po_required,
        income_tax_wht_pct: body.income_tax_wht_pct != null ? body.income_tax_wht_pct : current.income_tax_wht_pct,
        commercial_type: commercial,
        payroll_engine: engine,
        allied_contract_focal_email: focal,
        dedicated_payroll_resource_email: payrollResource,
        routing_mode: routing,
        overhead_per_employee: body.overhead_per_employee != null ? body.overhead_per_employee : current.overhead_per_employee,
        medical_in_cost: body.medical_in_cost != null ? !!body.medical_in_cost : current.medical_in_cost,
        employer_pf_in_cost: body.employer_pf_in_cost != null ? !!body.employer_pf_in_cost : current.employer_pf_in_cost,
        sessi_basis: body.sessi_basis || current.sessi_basis,
        proration_basis: body.proration_basis || current.proration_basis,
        ot_applicable_tiers: body.ot_applicable_tiers || current.ot_applicable_tiers,
        sales_tax_rate: body.sales_tax_rate != null ? body.sales_tax_rate : current.sales_tax_rate,
        sales_tax_exempt: body.sales_tax_exempt != null ? !!body.sales_tax_exempt : current.sales_tax_exempt,
    });

    if (body.claims) {
        await upsertClaimsPolicy(pool, contractId, body.claims);
    }

    await pool.query(
        `UPDATE contracts SET
            allied_focal_email = $2,
            dedicated_payroll_resource_email = $3
         WHERE id = $1`,
        [contractId, focal, payrollResource]
    );

    if (policyRow?.id) {
        await pool.query(
            `UPDATE contract_policies SET
                commercial_type = $2,
                payroll_engine = $3,
                allied_contract_focal_email = $4,
                dedicated_payroll_resource_email = $5,
                routing_mode = $6,
                overhead_per_employee = $7,
                medical_in_cost = $8,
                employer_pf_in_cost = $9,
                sessi_basis = $10,
                proration_basis = $11,
                ot_applicable_tiers = $12,
                sales_tax_rate = COALESCE($13, sales_tax_rate),
                sales_tax_exempt = COALESCE($14, sales_tax_exempt)
             WHERE id = $1`,
            [
                policyRow.id, commercial, engine, focal, payrollResource, routing,
                body.overhead_per_employee != null ? body.overhead_per_employee : current.overhead_per_employee,
                body.medical_in_cost != null ? !!body.medical_in_cost : current.medical_in_cost,
                body.employer_pf_in_cost != null ? !!body.employer_pf_in_cost : current.employer_pf_in_cost,
                body.sessi_basis || current.sessi_basis,
                body.proration_basis || current.proration_basis,
                body.ot_applicable_tiers || current.ot_applicable_tiers,
                body.sales_tax_rate != null ? body.sales_tax_rate : null,
                body.sales_tax_exempt != null ? !!body.sales_tax_exempt : null,
            ]
        );
    }

    return getRulebook(pool, contractId);
}

async function listRulebooks(pool) {
    const { rows } = await pool.query(
        `SELECT c.id FROM contracts c ORDER BY c.contract_name`
    );
    const out = [];
    for (const r of rows) {
        try {
            out.push(await getRulebook(pool, r.id));
        } catch {
            // skip broken
        }
    }
    return out;
}

async function getRulebookForEmployee(pool, emp) {
    const contractId = emp.contract_id || emp.contractId;
    if (!contractId) {
        return {
            routing_mode: 'auto',
            dedicated_payroll_resource_email: null,
            allied_contract_focal_email: null,
            reviewer_required: false,
        };
    }
    try {
        return await getRulebook(pool, contractId);
    } catch {
        return {
            routing_mode: 'auto',
            dedicated_payroll_resource_email: null,
            allied_contract_focal_email: null,
            reviewer_required: false,
        };
    }
}

module.exports = {
    COMMERCIAL_TYPES,
    ENGINES,
    ROUTING_MODES,
    inferCommercialType,
    shapeRulebook,
    getRulebook,
    saveRulebook,
    listRulebooks,
    getRulebookForEmployee,
};
