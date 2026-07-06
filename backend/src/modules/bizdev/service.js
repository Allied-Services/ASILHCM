'use strict';

async function syncBizdevRenewals(pool) {
    const { rows: contracts } = await pool.query(
        `SELECT c.id, c.end_date FROM contracts c
         WHERE c.end_date IS NOT NULL
           AND c.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'`
    );
    let inserted = 0;
    for (const c of contracts) {
        const { rowCount } = await pool.query(
            `INSERT INTO bd_renewals (contract_id, renewal_date, status)
             SELECT $1, $2, 'upcoming'
             WHERE NOT EXISTS (SELECT 1 FROM bd_renewals WHERE contract_id = $1 AND renewal_date = $2)`,
            [c.id, c.end_date]
        );
        if (rowCount) inserted += 1;
    }
    return { scanned: contracts.length, inserted };
}

module.exports = { syncBizdevRenewals };
