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

    app.post('/api/attendance/parse-csv', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { csvText, profileId, projectId, periodMonth, periodYear } = req.body;
            const { rows } = await pool.query(`SELECT * FROM attendance_parser_profiles WHERE id = $1`, [profileId]);
            const profile = rows[0] || { input_mode: req.body.inputMode || 'full_ledger', column_map: {} };
            const result = await parseCsvAttendance(pool, { csvText, profile, projectId, periodMonth, periodYear });
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
}

module.exports = { registerAttendanceIntakeRoutes };
