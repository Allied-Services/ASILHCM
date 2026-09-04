'use strict';

const { handleRouteError } = require('../../core/validate');
const { communicationsStatus } = require('../../core/communications');
const { getRulebook, saveRulebook, listRulebooks } = require('./rulebook');
const {
    listContacts, upsertContact, updateContact, seedContactsFromExisting,
    listRegions, upsertRegion,
} = require('./contacts');
const { sendFocalDigests, buildFocalDigests } = require('./digest');
const { createDraft, getImport, listImports, updateRows, submitImport, buildCycleFileTemplate } = require('./machineFile');
const {
    loadSheetProvenance, detectConflicts, resolveConflict,
    importPendingClaims, assertNoOpenConflicts,
} = require('./provenance');
const { getPayrollEngine, sheetEngineMap, assertSheetWritable, assertRunAllowed } = require('./engineFlag');
const { getMonthClose } = require('./monthClose');
const { generateCostPlusInvoiceFromSheet, assertSoInvoiceAllowed } = require('./costPlusInvoice');
const { statutoryFilesFromSnapshot } = require('./statutoryFiles');
const { createClosePackFromSheet } = require('../payrollClose/service');

function registerRecordsRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail, logAudit } = deps;
    const writeRoles = requireRole('superadmin', 'finance_manager', 'operations', 'payroll_initiator');

    app.get('/api/records/communications', requireAuth, async (_req, res) => {
        res.json(communicationsStatus());
    });

    app.get('/api/records/rulebooks', requireAuth, async (_req, res) => {
        try {
            res.json({ rulebooks: await listRulebooks(pool) });
        } catch (err) {
            handleRouteError(res, 'records.listRulebooks', err);
        }
    });

    app.get('/api/records/rulebook/:contractId', requireAuth, async (req, res) => {
        try {
            res.json(await getRulebook(pool, req.params.contractId));
        } catch (err) {
            handleRouteError(res, 'records.getRulebook', err);
        }
    });

    app.put('/api/records/rulebook/:contractId', requireAuth, writeRoles, async (req, res) => {
        try {
            const saved = await saveRulebook(pool, req.params.contractId, req.body || {}, req.user);
            if (typeof logAudit === 'function') logAudit(req, 'RULEBOOK_SAVE', 'contract', req.params.contractId);
            res.json(saved);
        } catch (err) {
            handleRouteError(res, 'records.saveRulebook', err);
        }
    });

    app.get('/api/records/contacts', requireAuth, async (req, res) => {
        try {
            res.json({ contacts: await listContacts(pool, req.query) });
        } catch (err) {
            handleRouteError(res, 'records.listContacts', err);
        }
    });

    app.post('/api/records/contacts', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json({ contact: await upsertContact(pool, req.body || {}) });
        } catch (err) {
            handleRouteError(res, 'records.upsertContact', err);
        }
    });

    app.put('/api/records/contacts/:id', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json({ contact: await updateContact(pool, parseInt(req.params.id, 10), req.body || {}) });
        } catch (err) {
            handleRouteError(res, 'records.updateContact', err);
        }
    });

    app.post('/api/records/contacts/seed', requireAuth, requireRole('superadmin', 'finance_manager'), async (_req, res) => {
        try {
            res.json(await seedContactsFromExisting(pool));
        } catch (err) {
            handleRouteError(res, 'records.seedContacts', err);
        }
    });

    app.get('/api/records/regions', requireAuth, async (_req, res) => {
        try {
            res.json({ regions: await listRegions(pool) });
        } catch (err) {
            handleRouteError(res, 'records.listRegions', err);
        }
    });

    app.put('/api/records/regions', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json({ region: await upsertRegion(pool, req.body || {}) });
        } catch (err) {
            handleRouteError(res, 'records.upsertRegion', err);
        }
    });

    app.get('/api/records/digest', requireAuth, async (req, res) => {
        try {
            const year = parseInt(req.query.year, 10) || new Date().getFullYear();
            const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
            res.json({ groups: await buildFocalDigests(pool, year, month), year, month });
        } catch (err) {
            handleRouteError(res, 'records.digestPreview', err);
        }
    });

    app.post('/api/records/digest/send', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json(await sendFocalDigests(pool, sendAppEmail, req.body || {}));
        } catch (err) {
            handleRouteError(res, 'records.digestSend', err);
        }
    });

    app.get('/api/cycle-files/template', requireAuth, async (req, res) => {
        try {
            const pack = await buildCycleFileTemplate(pool, {
                contractId: req.query.contractId || req.query.contract_id,
                month: parseInt(req.query.month, 10),
                year: parseInt(req.query.year, 10),
                inputMode: req.query.input_mode || req.query.inputMode,
            });
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${pack.filename}"`);
            res.send(pack.csv);
        } catch (err) {
            handleRouteError(res, 'records.cycleFileTemplate', err);
        }
    });

    app.get('/api/cycle-files', requireAuth, async (req, res) => {
        try {
            res.json({
                imports: await listImports(pool, {
                    contractId: req.query.contractId,
                    month: parseInt(req.query.month, 10),
                    year: parseInt(req.query.year, 10),
                }),
            });
        } catch (err) {
            handleRouteError(res, 'records.listCycleFiles', err);
        }
    });

    app.post('/api/cycle-files', requireAuth, writeRoles, async (req, res) => {
        try {
            const body = req.body || {};
            res.json(await createDraft(pool, {
                contractId: body.contractId || body.contract_id,
                month: parseInt(body.month, 10),
                year: parseInt(body.year, 10),
                inputMode: body.input_mode || body.inputMode,
                fileName: body.file_name || body.fileName,
                text: body.text,
                createdBy: req.user?.email,
            }));
        } catch (err) {
            handleRouteError(res, 'records.createCycleFile', err);
        }
    });

    app.get('/api/cycle-files/:id', requireAuth, async (req, res) => {
        try {
            res.json(await getImport(pool, parseInt(req.params.id, 10)));
        } catch (err) {
            handleRouteError(res, 'records.getCycleFile', err);
        }
    });

    app.put('/api/cycle-files/:id/rows', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await updateRows(pool, parseInt(req.params.id, 10), req.body?.rows || []));
        } catch (err) {
            handleRouteError(res, 'records.updateCycleFile', err);
        }
    });

    app.post('/api/cycle-files/:id/submit', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await submitImport(pool, parseInt(req.params.id, 10), req.user?.email));
        } catch (err) {
            handleRouteError(res, 'records.submitCycleFile', err);
        }
    });

    app.get('/api/payroll/:year/:month/provenance', requireAuth, async (req, res) => {
        try {
            res.json(await loadSheetProvenance(pool, parseInt(req.params.year, 10), parseInt(req.params.month, 10), {
                client: req.query.client,
                contractId: req.query.contractId,
            }));
        } catch (err) {
            handleRouteError(res, 'records.provenance', err);
        }
    });

    app.post('/api/payroll/:year/:month/detect-conflicts', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await detectConflicts(pool, parseInt(req.params.year, 10), parseInt(req.params.month, 10)));
        } catch (err) {
            handleRouteError(res, 'records.detectConflicts', err);
        }
    });

    app.post('/api/payroll/conflicts/:id/resolve', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await resolveConflict(pool, parseInt(req.params.id, 10), req.user?.email));
        } catch (err) {
            handleRouteError(res, 'records.resolveConflict', err);
        }
    });

    app.post('/api/payroll/:year/:month/import-pending', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await importPendingClaims(
                pool,
                parseInt(req.params.year, 10),
                parseInt(req.params.month, 10),
                req.body?.employeeIds || [],
                req.user?.email
            ));
        } catch (err) {
            handleRouteError(res, 'records.importPending', err);
        }
    });

    app.get('/api/records/engines', requireAuth, async (req, res) => {
        try {
            const ids = String(req.query.contractIds || '').split(',').filter(Boolean);
            res.json({ engines: await sheetEngineMap(pool, ids) });
        } catch (err) {
            handleRouteError(res, 'records.engines', err);
        }
    });

    app.get('/api/month-close/:contractId/:year/:month', requireAuth, async (req, res) => {
        try {
            res.json(await getMonthClose(
                pool,
                req.params.contractId,
                parseInt(req.params.year, 10),
                parseInt(req.params.month, 10)
            ));
        } catch (err) {
            handleRouteError(res, 'records.monthClose', err);
        }
    });

    app.post('/api/month-close/:contractId/:year/:month/invoice', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await generateCostPlusInvoiceFromSheet(pool, {
                contractId: req.params.contractId,
                year: parseInt(req.params.year, 10),
                month: parseInt(req.params.month, 10),
                generatedBy: req.user?.email,
            }));
        } catch (err) {
            handleRouteError(res, 'records.costPlusInvoice', err);
        }
    });

    app.post('/api/month-close/:contractId/:year/:month/close-pack', requireAuth, writeRoles, async (req, res) => {
        try {
            res.json(await createClosePackFromSheet(pool, {
                contractId: req.params.contractId,
                year: parseInt(req.params.year, 10),
                month: parseInt(req.params.month, 10),
                actor: req.user?.email,
            }));
        } catch (err) {
            handleRouteError(res, 'records.closePackFromSheet', err);
        }
    });

    app.get('/api/payroll/:year/:month/statutory-files', requireAuth, async (req, res) => {
        try {
            res.json(await statutoryFilesFromSnapshot(pool, {
                year: parseInt(req.params.year, 10),
                month: parseInt(req.params.month, 10),
                contractId: req.query.contractId || null,
            }));
        } catch (err) {
            handleRouteError(res, 'records.statutoryFiles', err);
        }
    });

    app.get('/api/records/engine/:contractId', requireAuth, async (req, res) => {
        try {
            res.json({ payroll_engine: await getPayrollEngine(pool, req.params.contractId) });
        } catch (err) {
            handleRouteError(res, 'records.getEngine', err);
        }
    });
}

module.exports = {
    registerRecordsRoutes,
    assertSheetWritable,
    assertRunAllowed,
    assertSoInvoiceAllowed,
    assertNoOpenConflicts,
};
