'use strict';

/**
 * North Zone (and the other live PSO contracts) were stored as monthly_form
 * even though Collect actually uses the machine file. The earlier backfill
 * kept a non-empty collection_mode, so PSO stayed on the Wafi form.
 */
const PSO_CONTRACTS = [
    'CTR-PSO-NORTH-ZONE',
    'CTR-PSO-CORO-MA',
    'CTR-1778149976025',
    'CTR-1773053337970',
];

exports.up = async (pgm) => {
    pgm.sql(`
        UPDATE contract_claim_policies
        SET collection_mode = 'machine_file',
            updated_at = NOW()
        WHERE contract_id IN (${PSO_CONTRACTS.map((id) => `'${id}'`).join(', ')})
          AND collection_mode IS DISTINCT FROM 'machine_file'
    `);
};

exports.down = async () => {};
