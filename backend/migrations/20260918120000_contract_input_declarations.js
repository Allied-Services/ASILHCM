'use strict';

/**
 * Backfill explicit collected types onto live contracts BEFORE the Wafi
 * default type list is removed in application code.
 *
 * Wafi: Attendance, OT, Expense, Medical.
 * PSO (North Zone, CORO, Janitorial, Ops Handling): Attendance + OT.
 */
exports.up = async (pgm) => {
    pgm.sql(`
        INSERT INTO contract_claim_policies
            (contract_id, enabled_types, collection_mode, reviewer_required, updated_at)
        SELECT c.id, ARRAY['ATTENDANCE','OT']::text[], 'machine_file', FALSE, NOW()
        FROM contracts c
        WHERE c.id IN (
            'CTR-PSO-NORTH-ZONE',
            'CTR-PSO-CORO-MA',
            'CTR-1778149976025',
            'CTR-1773053337970'
        )
        ON CONFLICT (contract_id) DO UPDATE SET
            enabled_types = ARRAY['ATTENDANCE','OT']::text[],
            collection_mode = COALESCE(NULLIF(contract_claim_policies.collection_mode, ''), 'machine_file'),
            updated_at = NOW()
    `);

    pgm.sql(`
        UPDATE contract_claim_policies p
        SET enabled_types = ARRAY['ATTENDANCE','OT','EXPENSE','MEDICAL']::text[],
            updated_at = NOW()
        FROM contracts c
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE p.contract_id = c.id
          AND (
            c.contract_name ILIKE '%wafi%'
            OR cl.name ILIKE '%wafi%'
          )
    `);

    pgm.sql(`
        INSERT INTO contract_claim_policies
            (contract_id, enabled_types, collection_mode, reviewer_required, updated_at)
        SELECT c.id,
               ARRAY['ATTENDANCE','OT','EXPENSE','MEDICAL']::text[],
               'monthly_form',
               FALSE,
               NOW()
        FROM contracts c
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE NOT EXISTS (
            SELECT 1 FROM contract_claim_policies p WHERE p.contract_id = c.id
        )
          AND (
            c.contract_name ILIKE '%wafi%'
            OR cl.name ILIKE '%wafi%'
          )
    `);

    pgm.sql(`
        UPDATE contract_policies
        SET commercial_type = 'fixed_value',
            billing_model = COALESCE(NULLIF(billing_model, ''), 'service_order_deduction')
        WHERE contract_id IN (
            'CTR-PSO-NORTH-ZONE',
            'CTR-PSO-CORO-MA',
            'CTR-1778149976025',
            'CTR-1773053337970'
        )
          AND (
            commercial_type IS DISTINCT FROM 'fixed_value'
            OR billing_model IS NULL
            OR billing_model = ''
          )
    `);
};

exports.down = async () => {};
