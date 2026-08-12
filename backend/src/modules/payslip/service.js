'use strict';

const crypto = require('crypto');
const { buildWorldAPayslipData, normalizeCnic } = require('./dataBuilder');
const { buildProtectedPayslipPdf } = require('./pdfProtect');
const { mintAccessToken } = require('./tokenStore');
const { renderEmailCoverHtml, OPS_SUPPORT } = require('./template');
const { normalisePhone } = require('../../../lib/sms');

function frontendBase() {
    return (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://asilhcm.onrender.com').replace(/\/$/, '');
}

/** Public backend origin used for SMS PDF deep-links (not the SPA). */
function backendBase() {
    return (process.env.APP_BASE_URL || process.env.BACKEND_URL || 'https://asilhcm.onrender.com').replace(/\/$/, '');
}

function payslipPdfLink(token) {
    return `${backendBase()}/api/payslip/link/${token}`;
}

/**
 * SMS copy: link + CNIC password only — no salary / OT amounts.
 * Kept ≤160 chars (including longer staging hosts) so Jazz never drops the link.
 */
function buildSmsMessage(token) {
    const link = payslipPdfLink(token);
    return `ASIL: Payslip can be viewed at ${link} Password: CNIC (13 digits, no dashes)`;
}

async function getContractEosbType(pool, contractName) {
    if (!contractName) return 'None';
    const { rows } = await pool.query(
        `SELECT c.costs->>'eosb_type' AS eosb_type FROM contracts c WHERE c.contract_name = $1 LIMIT 1`,
        [contractName]
    );
    return rows[0]?.eosb_type || 'None';
}

async function isMonthPaid(pool, year, month) {
    const { rows } = await pool.query(
        `SELECT id, status FROM payment_batches
         WHERE batch_type = 'PAYROLL' AND year = $1 AND month = $2
           AND status IN ('Confirmed', 'FM Approved')
         LIMIT 1`,
        [year, month]
    );
    return rows.length > 0;
}

function normalizeEmployeeIds(ids) {
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

async function getLockStats(pool, year, month, employeeIds = []) {
    const ids = normalizeEmployeeIds(employeeIds);
    let q = `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE locked = TRUE)::int AS locked_count
             FROM payroll_transactions WHERE year = $1 AND month = $2`;
    const params = [year, month];
    if (ids.length) {
        params.push(ids);
        q += ` AND employee_id = ANY($3::text[])`;
    }
    const { rows } = await pool.query(q, params);
    return rows[0] || { total: 0, locked_count: 0 };
}

async function getPayslipReadiness(pool, year, month, employeeIds = []) {
    const yr = parseInt(year, 10);
    const mo = parseInt(month, 10);
    const ids = normalizeEmployeeIds(employeeIds);
    const lockStats = await getLockStats(pool, yr, mo, ids);
    const paid = await isMonthPaid(pool, yr, mo);

    let empQ = `
        SELECT e.id, e.name, e.email, e.primary_contact AS phone, e.cnic,
               pt.locked
        FROM payroll_transactions pt
        JOIN employees e ON e.id = pt.employee_id
        WHERE pt.year = $1 AND pt.month = $2 AND pt.locked = TRUE`;
    const params = [yr, mo];
    if (ids.length) {
        params.push(ids);
        empQ += ` AND e.id = ANY($3::text[])`;
    }
    const { rows: employees } = await pool.query(empQ, params);

    const { rows: batchRows } = await pool.query(
        `SELECT id, status, sent_at FROM payslip_delivery_batches WHERE year = $1 AND month = $2`,
        [yr, mo]
    );
    const batch = batchRows[0] || null;

    const withEmail = employees.filter(e => e.email && String(e.email).trim()).length;
    const withPhone = employees.filter(e => e.phone && normalisePhone(e.phone)).length;
    const withCnic = employees.filter(e => normalizeCnic(e.cnic).length >= 5).length;
    const missingCnic = employees.filter(e => normalizeCnic(e.cnic).length < 5);

    // Scoped send: only the selected employees must be locked. Month must still be bank-paid.
    // Full-month send: every payroll row for the month must be locked.
    const scopeLocked = lockStats.total > 0 && lockStats.locked_count === lockStats.total
        && (!ids.length || lockStats.total === ids.length);

    let alreadyDeliveredCount = 0;
    if (batch?.id && employees.length) {
        const empIds = employees.map((e) => e.id);
        const { rows: prior } = await pool.query(
            `SELECT COUNT(DISTINCT employee_id)::int AS c FROM payslip_delivery_log
             WHERE batch_id = $1
               AND employee_id = ANY($2::text[])
               AND (email_status LIKE 'sent%' OR sms_status LIKE 'sent%')`,
            [batch.id, empIds]
        );
        alreadyDeliveredCount = prior[0]?.c || 0;
    }
    const alreadySent = batch?.status === 'sent';
    // Force only when every employee currently in scope was already delivered.
    const needsForceResend = alreadySent && employees.length > 0
        && alreadyDeliveredCount >= employees.length;

    return {
        year: yr,
        month: mo,
        scope: ids.length ? 'selected' : 'all',
        selectedCount: ids.length,
        allLocked: scopeLocked,
        lockedCount: lockStats.locked_count,
        totalRows: lockStats.total,
        paid,
        alreadySent,
        alreadyDeliveredCount,
        needsForceResend,
        batch,
        employeeCount: employees.length,
        withEmail,
        withPhone,
        withCnic,
        missingCnic: missingCnic.map(e => ({ id: e.id, name: e.name })),
        canSend: scopeLocked && paid,
    };
}

async function getStoredDocument(pool, employeeId, year, month) {
    const { rows } = await pool.query(
        `SELECT * FROM payslip_documents WHERE employee_id = $1 AND year = $2 AND month = $3`,
        [employeeId, year, month]
    );
    return rows[0] || null;
}

async function generateAndStorePdf(pool, emp, pay, contractEosbType, batchId, year, month) {
    const cnic = normalizeCnic(emp.cnic);
    if (cnic.length < 5) {
        const err = new Error('MISSING_CNIC');
        err.code = 'MISSING_CNIC';
        throw err;
    }
    const data = buildWorldAPayslipData(emp, pay, contractEosbType);
    const pdfBytes = await buildProtectedPayslipPdf(data, { year, month }, cnic);
    const contentHash = crypto.createHash('sha256').update(pdfBytes).digest('hex');
    const { rows } = await pool.query(
        `INSERT INTO payslip_documents (employee_id, year, month, pdf_bytes, content_hash, batch_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (employee_id, year, month) DO UPDATE SET
           pdf_bytes = EXCLUDED.pdf_bytes,
           content_hash = EXCLUDED.content_hash,
           batch_id = EXCLUDED.batch_id,
           generated_at = NOW()
         RETURNING id, pdf_bytes`,
        [emp.id, year, month, pdfBytes, contentHash, batchId]
    );
    return rows[0];
}

async function sendPayslips(pool, deps, opts) {
    const { year, month, confirm, forceResend, actorEmail, sendAll = false } = opts;
    const { sendAppEmail, sendJazzSMS } = deps;
    const yr = parseInt(year, 10);
    const mo = parseInt(month, 10);
    const ids = normalizeEmployeeIds(opts.employeeIds);
    const scoped = ids.length > 0;

    // Empty selection must explicitly opt into send-all — never silently expand a partial intent.
    if (!scoped && !sendAll) {
        const err = new Error('SELECTION_REQUIRED');
        err.code = 'SELECTION_REQUIRED';
        throw err;
    }

    if (!confirm) {
        const err = new Error('CONFIRM_REQUIRED');
        err.code = 'CONFIRM_REQUIRED';
        throw err;
    }

    const paid = await isMonthPaid(pool, yr, mo);
    if (!paid) {
        const err = new Error('NOT_PAID');
        err.code = 'NOT_PAID';
        throw err;
    }

    if (scoped) {
        const { rows: lockRows } = await pool.query(
            `SELECT employee_id, locked FROM payroll_transactions
             WHERE year = $1 AND month = $2 AND employee_id = ANY($3::text[])`,
            [yr, mo, ids]
        );
        const byId = new Map(lockRows.map((r) => [r.employee_id, r.locked === true]));
        const missing = ids.filter((id) => !byId.has(id));
        const unlocked = ids.filter((id) => byId.has(id) && !byId.get(id));
        if (missing.length || unlocked.length) {
            const err = new Error('NOT_ALL_LOCKED');
            err.code = 'NOT_ALL_LOCKED';
            err.detail = { missing, unlocked };
            throw err;
        }
    } else {
        const readiness = await getPayslipReadiness(pool, yr, mo, []);
        if (!readiness.allLocked) {
            const err = new Error('NOT_ALL_LOCKED');
            err.code = 'NOT_ALL_LOCKED';
            throw err;
        }
    }

    const readiness = await getPayslipReadiness(pool, yr, mo, ids);
    if (readiness.alreadySent && !forceResend) {
        // Partial send to new recipients is allowed; only block when every selected
        // employee was already delivered in this month's batch.
        if (scoped && readiness.batch?.id) {
            const { rows: prior } = await pool.query(
                `SELECT DISTINCT employee_id FROM payslip_delivery_log
                 WHERE batch_id = $1
                   AND employee_id = ANY($2::text[])
                   AND (email_status LIKE 'sent%' OR sms_status LIKE 'sent%')`,
                [readiness.batch.id, ids]
            );
            if (prior.length >= ids.length) {
                const err = new Error('ALREADY_SENT');
                err.code = 'ALREADY_SENT';
                throw err;
            }
        } else if (!scoped) {
            const err = new Error('ALREADY_SENT');
            err.code = 'ALREADY_SENT';
            throw err;
        }
    }

    const monthName = new Date(2000, mo - 1, 1).toLocaleString('en-PK', { month: 'long' });

    const { rows: batchRows } = await pool.query(
        `INSERT INTO payslip_delivery_batches (year, month, status, sent_by)
         VALUES ($1, $2, 'pending', $3)
         ON CONFLICT (year, month) DO UPDATE SET sent_by = EXCLUDED.sent_by
         RETURNING id`,
        [yr, mo, actorEmail]
    );
    const batchId = batchRows[0].id;

    let empQ = `
        SELECT e.id, e.name, e.email, e.primary_contact, e.contact, e.cnic, e.designation,
               e.client, e.location, e.bank_name, e.bank_account, e.contract_name, e.contract, e.salary,
               pt.paid_days, pt.gross, pt.net, pt.ot2_hrs, pt.ot3_hrs, pt.opd_claim, pt.reimbursement,
               pt.arrears, pt.special_allowance, pt.fuel_mobile, pt.bonus_amount, pt.wht, pt.eobi_ee,
               pt.advance_deduction, pt.loan_deduction, pt.other_deduction, pt.locked,
               pt.year, pt.month, pt.computed_json
        FROM payroll_transactions pt
        JOIN employees e ON e.id = pt.employee_id
        WHERE pt.year = $1 AND pt.month = $2 AND pt.locked = TRUE`;
    const params = [yr, mo];
    if (scoped) {
        params.push(ids);
        empQ += ` AND e.id = ANY($3::text[])`;
    }
    const { rows: targets } = await pool.query(empQ, params);

    if (scoped && targets.length !== ids.length) {
        const found = new Set(targets.map((t) => t.id));
        const missing = ids.filter((id) => !found.has(id));
        const err = new Error('NOT_ALL_LOCKED');
        err.code = 'NOT_ALL_LOCKED';
        err.detail = { missing, unlocked: [] };
        throw err;
    }

    let emailCount = 0;
    let smsCount = 0;
    let failedCount = 0;
    const failed = [];
    const skipped = [];

    for (const row of targets) {
        const emp = row;
        const pay = row;
        try {
            const eosbType = await getContractEosbType(pool, emp.contract_name || emp.contract);
            const doc = await generateAndStorePdf(pool, emp, pay, eosbType, batchId, yr, mo);

            let emailStatus = 'skipped';
            let smsStatus = 'skipped';
            let tokenId = null;

            if (emp.email && String(emp.email).trim() && sendAppEmail) {
                const slipData = buildWorldAPayslipData(emp, pay, eosbType);
                const cover = renderEmailCoverHtml({
                    emp,
                    monthName,
                    year: yr,
                    frontendUrl: frontendBase(),
                    netPay: slipData.netPay,
                });
                const safeName = (emp.name || 'Employee').replace(/[^a-zA-Z0-9 ]/g, '_').trim();
                const pdfBuf = Buffer.isBuffer(doc.pdf_bytes) ? doc.pdf_bytes : Buffer.from(doc.pdf_bytes);
                await sendAppEmail({
                    to: emp.email,
                    subject: `TRIAL — Salary Slip — ${monthName} ${yr} | ASIL`,
                    html: cover,
                    attachments: [{
                        filename: `PaySlip_${safeName}_${monthName}_${yr}.pdf`,
                        content: pdfBuf,
                    }],
                });
                emailStatus = 'sent';
                emailCount += 1;
            }

            const phone = normalisePhone(emp.primary_contact || emp.contact);
            if (phone && sendJazzSMS) {
                const { rawToken, tokenId: tid } = await mintAccessToken(pool, {
                    employeeId: emp.id,
                    year: yr,
                    month: mo,
                    documentId: doc.id,
                });
                tokenId = tid;
                const sms = buildSmsMessage(rawToken);
                await sendJazzSMS(phone, sms);
                smsStatus = sms.length > 160 ? 'sent_long' : 'sent';
                smsCount += 1;
            }

            await pool.query(
                `INSERT INTO payslip_delivery_log (batch_id, employee_id, email_status, sms_status, token_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [batchId, emp.id, emailStatus, smsStatus, tokenId]
            );
        } catch (e) {
            failedCount += 1;
            failed.push({ id: emp.id, name: emp.name, err: e.code || e.message });
            if (e.code === 'MISSING_CNIC') {
                skipped.push({ id: emp.id, name: emp.name, reason: 'missing_cnic' });
            }
            await pool.query(
                `INSERT INTO payslip_delivery_log (batch_id, employee_id, email_status, sms_status, error_detail)
                 VALUES ($1, $2, 'failed', 'failed', $3)`,
                [batchId, emp.id, e.message]
            );
        }
    }

    const status = failedCount > 0 && (emailCount + smsCount) === 0 ? 'failed' : (failedCount > 0 ? 'partial' : 'sent');
    await pool.query(
        `UPDATE payslip_delivery_batches
         SET status = $2, sent_at = NOW(), employee_count = $3, email_count = $4, sms_count = $5, failed_count = $6
         WHERE id = $1`,
        [batchId, status, targets.length, emailCount, smsCount, failedCount]
    );

    await pool.query(
        `UPDATE payroll_transactions SET paid_on = COALESCE(paid_on, CURRENT_DATE), status = 'Paid'
         WHERE year = $1 AND month = $2 AND locked = TRUE`,
        [yr, mo]
    );

    return {
        ok: true,
        batchId,
        status,
        sent: targets.length - failedCount,
        emailCount,
        smsCount,
        failed,
        skipped,
        total: targets.length,
    };
}

async function nextCaseNo(pool) {
    const prefix = `PSL-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM payslip_support_cases WHERE case_no LIKE $1`,
        [`${prefix}%`]
    );
    const seq = (rows[0]?.c || 0) + 1;
    return `${prefix}-${String(seq).padStart(5, '0')}`;
}

async function createSupportCase(pool, deps, payload) {
    const { employeeId, year, month, description, channel, actorEmail } = payload;
    const caseNo = await nextCaseNo(pool);
    const { rows } = await pool.query(
        `INSERT INTO payslip_support_cases (case_no, employee_id, year, month, channel, description)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [caseNo, employeeId, year || null, month || null, channel || 'portal', description]
    );
    const row = rows[0];
    if (deps.sendAppEmail) {
        await deps.sendAppEmail({
            to: OPS_SUPPORT,
            subject: `[${caseNo}] Payslip query — ${employeeId}`,
            html: `<p>New payslip support case <strong>${caseNo}</strong></p>
                   <p>Employee: ${employeeId}<br>Period: ${month || '—'}/${year || '—'}<br>Channel: ${channel}</p>
                   <p>${description}</p>
                   <p>Reporter: ${actorEmail || 'employee'}</p>`,
        }).catch(err => console.error('[payslip-support-case]', err));
    }
    return row;
}

async function resolveSupportCase(pool, deps, caseId, { resolutionNote, resolvedBy }) {
    const { rows } = await pool.query(
        `UPDATE payslip_support_cases
         SET status = 'resolved', resolution_note = $2, resolved_by = $3, resolved_at = NOW()
         WHERE id = $1 AND status != 'resolved'
         RETURNING *`,
        [caseId, resolutionNote, resolvedBy]
    );
    if (!rows.length) return null;
    const c = rows[0];
    const { rows: empRows } = await pool.query(`SELECT name, email, primary_contact FROM employees WHERE id = $1`, [c.employee_id]);
    const emp = empRows[0];
    const msg = `ASIL: Your payslip query ${c.case_no} has been resolved. Please check your email for details. ${OPS_SUPPORT}`;
    if (emp?.email && deps.sendAppEmail) {
        await deps.sendAppEmail({
            to: emp.email,
            subject: `Resolved: Payslip query ${c.case_no}`,
            html: `<p>Dear ${emp.name},</p><p>Your payslip query (${c.case_no}) has been resolved.</p><p>${resolutionNote || ''}</p><p>${OPS_SUPPORT}</p>`,
        }).catch(err => console.error('[payslip-resolve-email]', err));
    }
    if (emp?.primary_contact && deps.sendJazzSMS) {
        const phone = normalisePhone(emp.primary_contact);
        if (phone) await deps.sendJazzSMS(phone, msg.slice(0, 160)).catch(() => {});
    }
    return c;
}

module.exports = {
    getPayslipReadiness,
    getStoredDocument,
    sendPayslips,
    createSupportCase,
    resolveSupportCase,
    frontendBase,
    backendBase,
    payslipPdfLink,
    buildSmsMessage,
    OPS_SUPPORT,
};
