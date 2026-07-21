'use strict';

/**
 * Drop historic payroll runs imported from Excel that need a clean re-ingest.
 * Targets locked_by LIKE 'excel_import%' (and optional accuracy-fail flag).
 */
async function purgeExcelPayrollImports(pool, { confirm = false } = {}) {
    const { rows: runs } = await pool.query(
        `SELECT id, contract_id, period_month, period_year, locked_by, status
         FROM payroll_runs
         WHERE locked_by ILIKE 'excel_import%'
            OR locked_by = 'excel_import'
         ORDER BY period_year, period_month, contract_id`
    );

    if (!confirm) {
        return {
            preview: true,
            runCount: runs.length,
            runs: runs.slice(0, 50),
            message: 'Pass confirm:true to delete these excel_import payroll runs and their rows',
        };
    }

    const ids = runs.map(r => r.id);
    if (!ids.length) {
        return { ok: true, deletedRuns: 0, deletedRows: 0, deletedAllocations: 0 };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let deletedAllocations = 0;
        try {
            const a = await client.query(
                `DELETE FROM cost_allocations WHERE source_run_id = ANY($1::int[])`,
                [ids]
            );
            deletedAllocations = a.rowCount;
        } catch (_) {
            try {
                const a = await client.query(
                    `DELETE FROM cost_allocations WHERE source_type = 'payroll' AND source_id = ANY($1::text[])`,
                    [ids.map(String)]
                );
                deletedAllocations = a.rowCount;
            } catch (__) {
                deletedAllocations = 0;
            }
        }

        const rows = await client.query(
            `DELETE FROM payroll_run_rows WHERE run_id = ANY($1::int[])`,
            [ids]
        );
        const delRuns = await client.query(
            `DELETE FROM payroll_runs WHERE id = ANY($1::int[])`,
            [ids]
        );
        await client.query('COMMIT');
        return {
            ok: true,
            deletedRuns: delRuns.rowCount,
            deletedRows: rows.rowCount,
            deletedAllocations,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { purgeExcelPayrollImports };
