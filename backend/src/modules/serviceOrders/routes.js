'use strict';

const multer = require('multer');
const { handleRouteError } = require('../../core/validate');
const {
    listFixedValueContracts,
    listServiceOrders,
    getServiceOrder,
    upsertServiceOrder,
    replaceLines,
    listDeductions,
    addManualDeduction,
    computeSoInvoice,
    persistSoInvoice,
    listRegistry,
    printInvoiceHtml,
    pullAttendanceForSite,
    listDriveAttendanceFiles,
    parseConservancyWorkbook,
    applyAttendance,
    seedPsoNorthZone,
    composeFocalEmail,
    sendFocalEmail,
    renderInvoiceHtml,
} = require('./service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function registerServiceOrderRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail, logAudit } = deps;
    const readRoles = requireRole(
        'superadmin', 'operations', 'operations_supervisor', 'operations_team',
        'finance_manager', 'finance_approver', 'finance_proposer',
        'ar_team', 'payroll_initiator', 'payroll'
    );
    const writeRoles = requireRole(
        'superadmin', 'operations', 'finance_manager', 'finance_approver',
        'ar_team', 'payroll_initiator', 'payroll'
    );

    app.get('/api/fixed-value/contracts', requireAuth, readRoles, async (req, res) => {
        try {
            res.json(await listFixedValueContracts(pool));
        } catch (err) {
            handleRouteError(res, 'fixed-value.contracts', err);
        }
    });

    app.get('/api/fixed-value/service-orders', requireAuth, readRoles, async (req, res) => {
        try {
            const rows = await listServiceOrders(pool, {
                contractId: req.query.contractId,
                siteCode: req.query.siteCode,
            });
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'fixed-value.serviceOrders.list', err);
        }
    });

    app.get('/api/fixed-value/registry', requireAuth, readRoles, async (req, res) => {
        try {
            const rows = await listRegistry(pool, {
                contractId: req.query.contractId,
                month: req.query.month ? parseInt(req.query.month, 10) : undefined,
                year: req.query.year ? parseInt(req.query.year, 10) : undefined,
                siteCode: req.query.siteCode,
            });
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'fixed-value.registry', err);
        }
    });

    app.post('/api/fixed-value/seed-pso', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            const result = await seedPsoNorthZone(pool, { actor: req.user?.email });
            if (logAudit) logAudit(req, 'SEED', 'fixed_value_pso', result.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.seedPso', err);
        }
    });

    app.get('/api/fixed-value/invoices/:id/print', requireAuth, readRoles, async (req, res) => {
        try {
            const invId = parseInt(req.params.id, 10);
            const format = req.query.format || 'invoice';
            const allowed = ['invoice', 'invoice_letterhead', 'sales_tax', 'sales_tax_letterhead'];
            if (!allowed.includes(format)) {
                return res.status(400).json({ error: 'Invalid format' });
            }
            const { rows } = await pool.query(`SELECT * FROM client_invoices WHERE id = $1`, [invId]);
            if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
            const html = printInvoiceHtml(rows[0], format);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (err) {
            console.error('[GET /api/fixed-value/invoices/:id/print]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/fixed-value/service-orders/:id/attendance/drive/status', requireAuth, readRoles, async (req, res) => {
        try {
            const so = await getServiceOrder(pool, req.params.id);
            if (!so) return res.status(404).json({ error: 'Service order not found' });
            const listing = await listDriveAttendanceFiles();
            const files = (listing.files || []).map(f => ({
                ...f,
                matchesSite: require('./driveAttendance').matchFileToSite(f.name, so.site_code),
            }));
            res.json({ ok: listing.ok, code: listing.code, siteCode: so.site_code, files });
        } catch (err) {
            handleRouteError(res, 'fixed-value.driveStatus', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/attendance/drive', requireAuth, writeRoles, async (req, res) => {
        try {
            const so = await getServiceOrder(pool, req.params.id);
            if (!so) return res.status(404).json({ error: 'Service order not found' });
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const pulled = await pullAttendanceForSite({ siteCode: so.site_code, month, year });
            if (!pulled.ok) {
                return res.status(pulled.code === 'missing_drive_credentials' ? 503 : 404).json(pulled);
            }
            res.json(pulled);
        } catch (err) {
            handleRouteError(res, 'fixed-value.drivePull', err);
        }
    });

    app.get('/api/fixed-value/service-orders/:id', requireAuth, readRoles, async (req, res) => {
        try {
            const row = await getServiceOrder(pool, req.params.id);
            if (!row) return res.status(404).json({ error: 'Service order not found' });
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'fixed-value.serviceOrders.get', err);
        }
    });

    app.put('/api/fixed-value/service-orders/:id', requireAuth, writeRoles, async (req, res) => {
        try {
            const payload = { ...req.body, id: req.params.id };
            const row = await upsertServiceOrder(pool, payload, req.user?.email);
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'fixed-value.serviceOrders.upsert', err);
        }
    });

    app.put('/api/fixed-value/service-orders/:id/lines', requireAuth, writeRoles, async (req, res) => {
        try {
            const result = await replaceLines(pool, req.params.id, req.body.lines || req.body);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.serviceOrders.lines', err);
        }
    });

    app.get('/api/fixed-value/service-orders/:id/deductions', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            const rows = await listDeductions(pool, req.params.id, month, year);
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'fixed-value.deductions.list', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/deductions', requireAuth, writeRoles, async (req, res) => {
        try {
            const row = await addManualDeduction(pool, {
                ...req.body,
                service_order_id: req.params.id,
            }, req.user?.email);
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'fixed-value.deductions.add', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/attendance/upload', requireAuth, writeRoles, upload.single('file'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const parsed = parseConservancyWorkbook(req.file.buffer, { month, year });
            res.json(parsed);
        } catch (err) {
            console.error('[POST /api/fixed-value/.../attendance/upload]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/fixed-value/service-orders/:id/attendance/apply', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const rows = req.body.rows || [];
            const summary = await applyAttendance(pool, {
                serviceOrderId: req.params.id,
                month,
                year,
                rows,
                actor: req.user?.email,
                monthDays: req.body.monthDays,
            });
            res.json(summary);
        } catch (err) {
            handleRouteError(res, 'fixed-value.attendance.apply', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/invoice/compute', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await computeSoInvoice(pool, { serviceOrderId: req.params.id, month, year });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.invoice.compute', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/invoice/persist', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await persistSoInvoice(pool, {
                serviceOrderId: req.params.id,
                month,
                year,
                generatedBy: req.user?.email,
                poNumber: req.body.poNumber,
            });
            if (logAudit) logAudit(req, 'INVOICE', 'fixed_value_so', String(result.invoice.id));
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.invoice.persist', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/focals/email', requireAuth, writeRoles, async (req, res) => {
        try {
            const so = await getServiceOrder(pool, req.params.id);
            if (!so) return res.status(404).json({ error: 'Service order not found' });
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const computed = await computeSoInvoice(pool, { serviceOrderId: req.params.id, month, year });
            const invoiceHtml = renderInvoiceHtml({ computed }, { format: 'invoice_letterhead' });
            const composed = composeFocalEmail({
                siteName: so.name,
                siteCode: so.site_code,
                month,
                year,
                invoiceHtml,
                payrollSummaryHtml: req.body.payrollSummaryHtml,
            });
            const meta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
            const to = req.body.to || (meta.focalEmail ? [meta.focalEmail] : []);
            const result = await sendFocalEmail(sendAppEmail, {
                to,
                subject: composed.subject,
                html: composed.html,
                cc: composed.cc,
            });
            res.json({ ...composed, send: result, to });
        } catch (err) {
            handleRouteError(res, 'fixed-value.focals.email', err);
        }
    });
}

module.exports = { registerServiceOrderRoutes };
