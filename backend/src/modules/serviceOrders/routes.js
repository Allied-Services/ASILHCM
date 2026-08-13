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
    deleteManualDeduction,
    computeSoInvoice,
    persistSoInvoice,
    updateFvInvoiceNumber,
    listRegistry,
    printInvoiceHtml,
    pullAttendanceForSite,
    listDriveAttendanceFiles,
    parseConservancyWorkbook,
    applyAttendance,
    seedPsoNorthZone,
    resyncNorthZoneFromSeed,
    getFixedValueContract,
    createFixedValueContract,
    updateFixedValueContract,
    composeFocalEmail,
    composeVerificationEmail,
    sendFocalEmail,
    sendVerificationEmails,
    resolveSiteFocalEmails,
    buildCcList,
    parseEmailList,
    renderInvoiceHtml,
    applyAttendanceAllSites,
    computeInvoicesAllSites,
    persistInvoicesAllSites,
    attendanceStatusBySite,
    buildPayrollWorkbook,
    buildInvoiceWorkbook,
    workbookToBuffer,
    getBillableConfirmationsForSo,
    listContractBillableConfirmations,
    saveBillableConfirmations,
    saveContractBillableConfirmations,
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
    const contractWriteRoles = requireRole('superadmin', 'operations');

    app.get('/api/fixed-value/contracts', requireAuth, readRoles, async (req, res) => {
        try {
            res.json(await listFixedValueContracts(pool));
        } catch (err) {
            handleRouteError(res, 'fixed-value.contracts', err);
        }
    });

    app.get('/api/fixed-value/contracts/:contractId', requireAuth, readRoles, async (req, res) => {
        try {
            const row = await getFixedValueContract(pool, req.params.contractId);
            if (!row) return res.status(404).json({ error: 'Contract not found' });
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'fixed-value.contracts.get', err);
        }
    });

    app.post('/api/fixed-value/contracts', requireAuth, contractWriteRoles, async (req, res) => {
        try {
            const result = await createFixedValueContract(pool, req.body || {}, req.user?.email);
            if (logAudit) logAudit(req, 'CREATE', 'fixed_value_contract', result.contract?.id || req.body?.id);
            res.status(201).json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.contracts.create', err);
        }
    });

    app.put('/api/fixed-value/contracts/:contractId', requireAuth, contractWriteRoles, async (req, res) => {
        try {
            const result = await updateFixedValueContract(pool, req.params.contractId, req.body || {}, req.user?.email);
            if (logAudit) logAudit(req, 'UPDATE', 'fixed_value_contract', req.params.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.contracts.update', err);
        }
    });

    app.post('/api/fixed-value/contracts/:contractId/resync-seed', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            if (req.params.contractId !== 'CTR-PSO-NORTH-ZONE') {
                return res.status(400).json({ error: 'resync-seed is only supported for CTR-PSO-NORTH-ZONE' });
            }
            const result = await resyncNorthZoneFromSeed(pool, {
                confirm: !!req.body?.confirm,
                syncEmployees: !!req.body?.syncEmployees,
                actor: req.user?.email,
            });
            if (logAudit) logAudit(req, 'RESYNC_SEED', 'fixed_value_contract', req.params.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.contracts.resyncSeed', err);
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
            // Deprecated alias → resyncNorthZoneFromSeed (employees included for first-time bootstrap).
            const result = await seedPsoNorthZone(pool, { actor: req.user?.email });
            if (logAudit) logAudit(req, 'SEED', 'fixed_value_pso', result.contractId);
            res.json({
                ...result,
                deprecated: true,
                preferredPath: 'POST /api/fixed-value/contracts/CTR-PSO-NORTH-ZONE/resync-seed',
            });
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
            const html = await printInvoiceHtml(pool, rows[0], format);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (err) {
            console.error('[GET /api/fixed-value/invoices/:id/print]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.patch('/api/fixed-value/invoices/:id/invoice-number', requireAuth, writeRoles, async (req, res) => {
        try {
            const invId = parseInt(req.params.id, 10);
            const invoiceNumber = req.body?.invoice_number ?? req.body?.invoiceNumber;
            const invoice = await updateFvInvoiceNumber(pool, invId, invoiceNumber);
            if (logAudit) logAudit(req, 'INVOICE_NUMBER', 'client_invoice', String(invoice.id));
            res.json({ ok: true, invoice });
        } catch (err) {
            handleRouteError(res, 'fixed-value.invoice.number', err);
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
            if (logAudit) logAudit(req, 'CREATE', 'so_deduction', row.id);
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'fixed-value.deductions.add', err);
        }
    });

    app.delete('/api/fixed-value/service-orders/:id/deductions/:deductionId', requireAuth, writeRoles, async (req, res) => {
        try {
            const row = await deleteManualDeduction(pool, req.params.id, req.params.deductionId);
            if (logAudit) logAudit(req, 'DELETE', 'so_deduction', row.id);
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'fixed-value.deductions.delete', err);
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

    app.get('/api/fixed-value/service-orders/:id/billable-confirmations', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const result = await getBillableConfirmationsForSo(pool, req.params.id, month, year);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.billable.get', err);
        }
    });

    app.put('/api/fixed-value/service-orders/:id/billable-confirmations', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const result = await saveBillableConfirmations(pool, {
                serviceOrderId: req.params.id,
                month,
                year,
                lines: req.body.lines || [],
                confirmAll: !!req.body.confirmAll,
                actor: req.user?.email,
            });
            if (logAudit) logAudit(req, 'BILLABLE_CONFIRM', 'fixed_value_so', req.params.id);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.billable.save', err);
        }
    });

    app.post('/api/fixed-value/service-orders/:id/billable-confirmations/confirm-all', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const result = await saveBillableConfirmations(pool, {
                serviceOrderId: req.params.id,
                month,
                year,
                confirmAll: true,
                actor: req.user?.email,
            });
            if (logAudit) logAudit(req, 'BILLABLE_CONFIRM_ALL', 'fixed_value_so', req.params.id);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.billable.confirmAll', err);
        }
    });

    app.get('/api/fixed-value/contracts/:contractId/billable-confirmations', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const siteCodes = req.query.siteCodes
                ? String(req.query.siteCodes).split(',').map((s) => s.trim()).filter(Boolean)
                : undefined;
            const result = await listContractBillableConfirmations(
                pool, req.params.contractId, month, year, siteCodes
            );
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.billable.contractGet', err);
        }
    });

    app.put('/api/fixed-value/contracts/:contractId/billable-confirmations', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const result = await saveContractBillableConfirmations(pool, {
                contractId: req.params.contractId,
                month,
                year,
                actor: req.user?.email,
                confirmAll: !!req.body.confirmAll,
                siteCodes: req.body.siteCodes,
                sites: req.body.sites,
            });
            if (logAudit) logAudit(req, 'BILLABLE_CONFIRM', 'fixed_value_contract', req.params.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.billable.contractSave', err);
        }
    });

    app.post('/api/fixed-value/contracts/:contractId/billable-confirmations/confirm-all', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const result = await saveContractBillableConfirmations(pool, {
                contractId: req.params.contractId,
                month,
                year,
                actor: req.user?.email,
                confirmAll: true,
                siteCodes: req.body.siteCodes,
            });
            if (logAudit) logAudit(req, 'BILLABLE_CONFIRM_ALL', 'fixed_value_contract', req.params.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.billable.contractConfirmAll', err);
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

    app.post('/api/fixed-value/contracts/:contractId/attendance/apply-all', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            const result = await applyAttendanceAllSites(pool, {
                contractId: req.params.contractId,
                month,
                year,
                actor: req.user?.email,
                siteCodes: req.body.siteCodes,
            });
            if (logAudit) logAudit(req, 'ATTENDANCE_APPLY_ALL', 'fixed_value_contract', req.params.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.attendance.applyAll', err);
        }
    });

    app.get('/api/fixed-value/contracts/:contractId/attendance/status', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            const rows = await attendanceStatusBySite(pool, {
                contractId: req.params.contractId,
                month,
                year,
            });
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'fixed-value.attendance.status', err);
        }
    });

    app.post('/api/fixed-value/contracts/:contractId/invoices/compute-all', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await computeInvoicesAllSites(pool, {
                contractId: req.params.contractId,
                month,
                year,
                siteCodes: req.body.siteCodes,
            });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.invoice.computeAll', err);
        }
    });

    app.post('/api/fixed-value/contracts/:contractId/invoices/persist-all', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await persistInvoicesAllSites(pool, {
                contractId: req.params.contractId,
                month,
                year,
                generatedBy: req.user?.email,
                siteCodes: req.body.siteCodes,
            });
            if (logAudit) logAudit(req, 'INVOICE_ALL', 'fixed_value_contract', req.params.contractId);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'fixed-value.invoice.persistAll', err);
        }
    });

    app.get('/api/fixed-value/contracts/:contractId/exports/payroll.xlsx', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            const wb = await buildPayrollWorkbook(pool, {
                contractId: req.params.contractId,
                month,
                year,
            });
            const buf = await workbookToBuffer(wb);
            const filename = `FV_Payroll_${req.params.contractId}_${year}-${String(month).padStart(2, '0')}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(Buffer.from(buf));
        } catch (err) {
            console.error('[GET /api/fixed-value/.../exports/payroll.xlsx]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/fixed-value/contracts/:contractId/exports/invoices.xlsx', requireAuth, readRoles, async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            const wb = await buildInvoiceWorkbook(pool, {
                contractId: req.params.contractId,
                month,
                year,
            });
            const buf = await workbookToBuffer(wb);
            const filename = `FV_Invoices_${req.params.contractId}_${year}-${String(month).padStart(2, '0')}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(Buffer.from(buf));
        } catch (err) {
            console.error('[GET /api/fixed-value/.../exports/invoices.xlsx]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/fixed-value/service-orders/:id/focals/email', requireAuth, writeRoles, async (req, res) => {
        try {
            const so = await getServiceOrder(pool, req.params.id);
            if (!so) return res.status(404).json({ error: 'Service order not found' });
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const dryRun = !!req.body.dryRun;
            const computed = await computeSoInvoice(pool, { serviceOrderId: req.params.id, month, year });
            const invoiceHtml = renderInvoiceHtml({ computed }, { format: 'invoice_letterhead' });
            const meta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
            const intendedTo = req.body.to ? parseEmailList(req.body.to) : resolveSiteFocalEmails(so);
            const { rows: cRows } = await pool.query(
                `SELECT client_focal_name, client_focal_email FROM contracts WHERE id = $1`,
                [so.contract_id]
            );
            const cc = buildCcList({ contractFocalEmail: cRows[0]?.client_focal_email });
            const composed = composeVerificationEmail({
                siteName: so.name,
                siteCode: so.site_code,
                month,
                year,
                invoiceHtml,
                focalName: meta.focalName || meta.focal_name,
                primaryEmail: intendedTo[0],
                dryRun,
                intendedTo,
            });
            const to = dryRun
                ? ['obaid.rana@asil.com.pk', 'huzaifa.rafaqat@asil.com.pk', 'shezad.mumtaz@asil.com.pk']
                : intendedTo;
            const result = await sendFocalEmail(sendAppEmail, {
                to,
                subject: composed.subject,
                html: composed.html,
                cc,
            });
            if (logAudit) logAudit(req, dryRun ? 'FV_EMAIL_DRY_RUN' : 'FV_EMAIL', 'service_order', req.params.id);
            res.json({ ...composed, send: result, to, intendedTo, cc, dryRun });
        } catch (err) {
            handleRouteError(res, 'fixed-value.focals.email', err);
        }
    });

    app.post('/api/fixed-value/contracts/:contractId/verification-emails', requireAuth, writeRoles, async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await sendVerificationEmails(pool, sendAppEmail, {
                contractId: req.params.contractId,
                month,
                year,
                dryRun: !!req.body.dryRun,
                siteCode: req.body.siteCode,
                serviceOrderId: req.body.serviceOrderId,
                computeSoInvoice,
                renderInvoiceHtml,
            });
            if (logAudit) {
                logAudit(req, req.body.dryRun ? 'FV_VERIFY_EMAIL_DRY_RUN' : 'FV_VERIFY_EMAIL_ALL', 'fixed_value_contract', req.params.contractId);
            }
            res.json(result);
        } catch (err) {
            if (err.status === 404) return res.status(404).json({ error: err.message });
            if (err.status === 400) return res.status(400).json({ error: err.message });
            handleRouteError(res, 'fixed-value.verification-emails', err);
        }
    });
}

module.exports = { registerServiceOrderRoutes };
