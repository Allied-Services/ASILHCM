'use strict';

const { formatDate } = require('../../core/dates');

async function getPolicy(pool, contractId, projectId = null, asOfDate = new Date()) {
    const date = formatDate(asOfDate);
    const { rows } = await pool.query(
        `SELECT * FROM contract_policies
         WHERE contract_id = $1
           AND ($2::text IS NULL OR project_id IS NULL OR project_id = $2)
           AND effective_from <= $3::date
           AND (effective_to IS NULL OR effective_to >= $3::date)
         ORDER BY project_id NULLS LAST, effective_from DESC, id DESC
         LIMIT 1`,
        [contractId, projectId, date]
    );
    return rows[0] || null;
}

async function getBenefitPolicy(pool, contractId, benefitType, asOfDate = new Date()) {
    const date = formatDate(asOfDate);
    const { rows } = await pool.query(
        `SELECT * FROM benefit_policies
         WHERE contract_id = $1 AND benefit_type = $2
           AND (effective_from IS NULL OR effective_from <= $3::date)
           AND (effective_to IS NULL OR effective_to >= $3::date)
         ORDER BY effective_from DESC NULLS LAST
         LIMIT 1`,
        [contractId, benefitType, date]
    );
    return rows[0] || null;
}

async function validateAction(pool, action, context) {
    const skipPolicy = action === 'bill_approve' || action === 'onboarding_check';
    const policy = context.policy || (!skipPolicy && pool
        ? await getPolicy(pool, context.contractId, context.projectId, context.asOfDate)
        : null);
    if (!policy && !skipPolicy) {
        return { ok: false, code: 'NO_POLICY', message: 'No contract policy configured for this contract.' };
    }

    switch (action) {
        case 'ot_claim': {
            if (!policy.ot_allowed) {
                return { ok: false, code: 'OT_NOT_ALLOWED', message: 'Overtime is not permitted on this project/contract.' };
            }
            if (policy.ot_monthly_cap_hours != null && context.otHours > Number(policy.ot_monthly_cap_hours)) {
                return { ok: false, code: 'OT_CAP_EXCEEDED', message: `OT exceeds monthly cap of ${policy.ot_monthly_cap_hours} hours.` };
            }
            return { ok: true };
        }
        case 'medical_claim': {
            const cap = policy.medical_annual_cap;
            if (cap != null && context.claimAmount + context.usedAmount > Number(cap)) {
                return {
                    ok: false,
                    code: 'MEDICAL_CAP_EXCEEDED',
                    message: `Medical claim exceeds annual cap. Remaining: ${Number(cap) - Number(context.usedAmount || 0)}`,
                };
            }
            return { ok: true };
        }
        case 'invoice_generate': {
            if (policy.po_required && !context.poId) {
                return { ok: false, code: 'PO_REQUIRED', message: 'A purchase order is required before invoicing this contract.' };
            }
            const challans = policy.challans_required || [];
            if (challans.length && context.missingChallans?.length) {
                return {
                    ok: false,
                    code: 'CHALLANS_INCOMPLETE',
                    message: `Missing challans: ${context.missingChallans.join(', ')}`,
                };
            }
            return { ok: true };
        }
        case 'bill_approve': {
            if (context.billable && context.matchStatus !== 'matched' && !context.overrideReason) {
                return { ok: false, code: 'BUDGET_UNMATCHED', message: 'Bill must be matched to a budget line before approval.' };
            }
            return { ok: true };
        }
        default:
            return { ok: true };
    }
}

async function upsertPolicy(pool, data) {
    const projectId = data.project_id || null;
    const effectiveFrom = data.effective_from || formatDate();
    const params = [
        data.contract_id, projectId, data.billing_model || 'headcount_rate',
        data.attendance_input_mode || 'full_ledger', data.standard_month_days || 30,
        data.ot_allowed !== false, data.ot_monthly_cap_hours || null, data.ot_client_managed || false,
        data.ot_divisor_days || 26, data.ot_divisor_hours || 8,
        data.service_charge_pct ?? 0.18, data.medical_annual_cap || null,
        data.medical_cycle_anchor || 'employment_date', data.credit_days || 30,
        data.invoice_frequency || 'monthly', data.invoice_day_of_month || 1,
        data.po_required || false, JSON.stringify(data.challans_required || []),
        JSON.stringify(data.reminder_cadence || []), data.edu_cess_enabled || false,
        data.bonus_accrual_months || 12, data.gratuity_accrual_months || 12,
        data.income_tax_wht_pct ?? null,
        effectiveFrom, data.effective_to || null,
    ];

    const { rows: existing } = await pool.query(
        `SELECT id FROM contract_policies
         WHERE contract_id = $1
           AND (($2::text IS NULL AND project_id IS NULL) OR project_id = $2)
           AND effective_from::date = $3::date
         LIMIT 1`,
        [data.contract_id, projectId, effectiveFrom]
    );

    if (existing.length) {
        const updateValues = [...params.slice(2, 23), params[24]];
        const { rows } = await pool.query(
            `UPDATE contract_policies SET
                billing_model = $4, attendance_input_mode = $5, standard_month_days = $6,
                ot_allowed = $7, ot_monthly_cap_hours = $8, ot_client_managed = $9,
                ot_divisor_days = $10, ot_divisor_hours = $11, service_charge_pct = $12,
                medical_annual_cap = $13, medical_cycle_anchor = $14, credit_days = $15,
                invoice_frequency = $16, invoice_day_of_month = $17, po_required = $18,
                challans_required = $19, reminder_cadence = $20, edu_cess_enabled = $21,
                bonus_accrual_months = $22, gratuity_accrual_months = $23, income_tax_wht_pct = $24, effective_to = $25
             WHERE id = $25
             RETURNING *`,
            [...updateValues, existing[0].id]
        );
        return rows[0];
    }

    const { rows } = await pool.query(
        `INSERT INTO contract_policies (
            contract_id, project_id, billing_model, attendance_input_mode, standard_month_days,
            ot_allowed, ot_monthly_cap_hours, ot_client_managed, ot_divisor_days, ot_divisor_hours,
            service_charge_pct, medical_annual_cap, medical_cycle_anchor, credit_days,
            invoice_frequency, invoice_day_of_month, po_required, challans_required, reminder_cadence,
            edu_cess_enabled, bonus_accrual_months, gratuity_accrual_months, effective_from, effective_to
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        ) RETURNING *`,
        params
    );
    return rows[0];
}

module.exports = { getPolicy, getBenefitPolicy, validateAction, upsertPolicy };
