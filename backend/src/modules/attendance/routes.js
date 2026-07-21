'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    getParserProfiles,
    parseCsvAttendance,
    manualBulkEntry,
    getAlertRules,
    saveAlertRule,
    runAlertCheck,
} = require('./service');
const {
    exportMonthlyHubCsv,
    importMonthlyHubCsv,
    getMonthlyHubRollups,
} = require('./monthlyHub');
const {
    upsertProjectClientFocals,
    listProjectClientFocals,
} = require('./clientFocals');

function registerAttendanceIntakeRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail, sendJazzSMS } = deps;

    app.get('/api/attendance/parser-profiles', requireAuth, requireRole('superadmin', 'operations', 'supervisor'), async (req, res) => {
        try {
            const rows = await getParserProfiles(pool, req.query);
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'attendance.profiles', err);
        }
    });

    app.post('/api/attendance/parse-csv', requireAuth, requireRole('superadmin', 'operations', 'finance_manager', 'hr_manager'), async (req, res) => {
        try {
            const { csvText, profileId, projectId, periodMonth, periodYear, formatHint, inputMode } = req.body;
            let profile = { input_mode: inputMode || 'full_ledger', column_map: {}, format_type: formatHint || null };
            if (profileId) {
                const { rows } = await pool.query(`SELECT * FROM attendance_parser_profiles WHERE id = $1`, [profileId]);
                if (rows[0]) profile = { ...rows[0], input_mode: inputMode || rows[0].input_mode };
            }
            const result = await parseCsvAttendance(pool, {
                csvText, profile, projectId, periodMonth, periodYear, formatHint: formatHint || profile.format_type,
            });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'attendance.parseCsv', err);
        }
    });

    app.post('/api/attendance/manual-bulk', requireAuth, requireRole('superadmin', 'operations', 'supervisor'), async (req, res) => {
        try {
            const result = await manualBulkEntry(pool, req.body);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'attendance.manualBulk', err);
        }
    });

    app.get('/api/attendance/alert-rules', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            res.json(await getAlertRules(pool));
        } catch (err) {
            handleRouteError(res, 'attendance.alertRules', err);
        }
    });

    app.post('/api/attendance/alert-rules', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const rule = await saveAlertRule(pool, req.body);
            res.json(rule);
        } catch (err) {
            handleRouteError(res, 'attendance.saveAlertRule', err);
        }
    });

    app.post('/api/attendance/run-alerts', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const result = await runAlertCheck(pool, { sendAppEmail, sendJazzSMS });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'attendance.runAlerts', err);
        }
    });

    // ── Monthly Report Hub (15-column export / import / rollups) ──────────────
    app.get('/api/attendance/monthly-hub/export', requireAuth, requireRole('hr_manager', 'finance_manager', 'superadmin', 'admin', 'operations'), async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
            const year = parseInt(req.query.year, 10) || new Date().getFullYear();
            const result = await exportMonthlyHubCsv(pool, { month, year, client: req.query.client });
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
            res.send(result.csv);
        } catch (err) {
            handleRouteError(res, 'attendance.monthlyHubExport', err);
        }
    });

    app.post('/api/attendance/monthly-hub/import', requireAuth, requireRole('hr_manager', 'finance_manager', 'superadmin', 'admin', 'operations'), async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            if (!month || !year || !req.body.csvText) {
                return res.status(400).json({ error: 'month, year, and csvText required' });
            }
            const result = await importMonthlyHubCsv(pool, {
                csvText: req.body.csvText,
                month,
                year,
                updatedBy: req.user?.email,
            });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'attendance.monthlyHubImport', err);
        }
    });

    app.get('/api/attendance/monthly-hub/rollups', requireAuth, requireRole('hr_manager', 'finance_manager', 'superadmin', 'admin', 'operations'), async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
            const year = parseInt(req.query.year, 10) || new Date().getFullYear();
            res.json(await getMonthlyHubRollups(pool, { month, year, client: req.query.client }));
        } catch (err) {
            handleRouteError(res, 'attendance.monthlyHubRollups', err);
        }
    });

    // ── Client focals bound to project/site/dept ──────────────────────────────
    app.get('/api/attendance/client-focals', requireAuth, requireRole('superadmin', 'operations', 'hr_manager', 'admin', 'finance_manager'), async (req, res) => {
        try {
            res.json({ focals: await listProjectClientFocals(pool, req.query) });
        } catch (err) {
            handleRouteError(res, 'attendance.listFocals', err);
        }
    });

    app.post('/api/attendance/client-focals', requireAuth, requireRole('superadmin', 'operations', 'hr_manager', 'admin', 'finance_manager'), async (req, res) => {
        try {
            const row = await upsertProjectClientFocals(pool, req.body);
            res.json({ ok: true, focal: row });
        } catch (err) {
            handleRouteError(res, 'attendance.saveFocals', err);
        }
    });
}

module.exports = { registerAttendanceIntakeRoutes };
