'use strict';

const { formatDate, addDays } = require('../../core/dates');

async function startOnboardingRun(pool, { contractId, leadId, serviceType = 'default' }) {
    const { rows: runs } = await pool.query(
        `INSERT INTO onboarding_runs (contract_id, lead_id, status) VALUES ($1, $2, 'in_progress') RETURNING *`,
        [contractId, leadId || null]
    );
    const run = runs[0];

    const { rows: templates } = await pool.query(
        `SELECT * FROM onboarding_templates
         WHERE service_type = $1 OR service_type = 'default'
         ORDER BY sort_order`,
        [serviceType]
    );

    for (const t of templates) {
        await pool.query(
            `INSERT INTO onboarding_tasks (run_id, task_key, task_label, blocking, due_date, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')`,
            [run.id, t.task_key, t.task_label, t.blocking, formatDate(addDays(new Date(), 7))]
        );
    }
    return run;
}

async function getOnboardingStatus(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT r.*,
                (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.run_id = r.id AND t.status = 'completed') AS completed_count,
                (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.run_id = r.id) AS total_count
         FROM onboarding_runs r
         WHERE r.contract_id = $1
         ORDER BY r.started_at DESC LIMIT 1`,
        [contractId]
    );
    if (!rows.length) return null;
    const run = rows[0];
    const { rows: tasks } = await pool.query(
        `SELECT * FROM onboarding_tasks WHERE run_id = $1 ORDER BY id`,
        [run.id]
    );
    return { ...run, tasks, pctComplete: run.total_count ? Math.round((run.completed_count / run.total_count) * 100) : 0 };
}

async function completeOnboardingTask(pool, taskId, userEmail) {
    const { rows } = await pool.query(
        `UPDATE onboarding_tasks SET status = 'completed', completed_at = NOW(), owner_email = COALESCE(owner_email, $2)
         WHERE id = $1 RETURNING *`,
        [taskId, userEmail]
    );
    return rows[0];
}

async function hasBlockingOnboardingIncomplete(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT 1 FROM onboarding_tasks t
         JOIN onboarding_runs r ON r.id = t.run_id
         WHERE r.contract_id = $1 AND r.status = 'in_progress'
           AND t.blocking = true AND t.status <> 'completed'
         LIMIT 1`,
        [contractId]
    );
    return rows.length > 0;
}

module.exports = { startOnboardingRun, getOnboardingStatus, completeOnboardingTask, hasBlockingOnboardingIncomplete };
