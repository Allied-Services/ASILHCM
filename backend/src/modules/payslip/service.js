'use strict';

const crypto = require('crypto');
const { buildWorldAPayslipData, normalizeCnic } = require('./dataBuilder');
const { buildProtectedPayslipPdf } = require('./pdfProtect');
const { mintAccessToken } = require('./tokenStore');
const { renderEmailCoverHtml, OPS_SUPPORT } = require('./template');
const { firstValidPkMobile } = require('../../../lib/sms');
const {
    isUsableEmail,
    resolvePayslipRecipients,
    hasPayslipEmailChannel,
} = require('../employees/contactEmails');

function isSentStatus(status) {
    return String(status || '').startsWith('sent');
}

function normalizeOnlyMissing(raw) {
    const v = String(raw || '').trim().toLowerCase();
    return (v === 'email' || v === 'sms') ? v : null;
}

/** Latest email/SMS status per employee for this payroll month. */
async function getMonthDeliveryMap(pool, year, month) {
    const { rows } = await pool.query(
        `SELECT DISTINCT ON (l.employee_id)
                l.employee_id, l.email_status, l.sms_status
         FROM payslip_delivery_log l
         JOIN payslip_delivery_batches b ON b.id = l.batch_id
         WHERE b.year = $1 AND b.month = $2
         ORDER BY l.employee_id, l.created_at DESC`,
        [year, month]
    );
    return new Map(rows.map((r) => [r.employee_id, r]));
}

async function recomputeBatchTotals(pool, batchId) {
    const { rows } = await pool.query(
        `WITH latest AS (
            SELECT DISTINCT ON (employee_id)
                   employee_id, email_status, sms_status
            FROM payslip_delivery_log
            WHERE batch_id = $1
            ORDER BY employee_id, created_at DESC
         )
         SELECT
            COUNT(*) FILTER (WHERE email_status LIKE 'sent%' OR sms_status LIKE 'sent%')::int AS delivered,
            COUNT(*) FILTER (WHERE email_status LIKE 'sent%')::int AS email_count,
            COUNT(*) FILTER (WHERE sms_status LIKE 'sent%')::int AS sms_count,
            COUNT(*) FILTER (WHERE email_status LIKE 'failed%' OR sms_status LIKE 'failed%')::int AS failed_count
         FROM latest`,
        [batchId]
    );
    return rows[0] || { delivered: 0, email_count: 0, sms_count: 0, failed_count: 0 };
}

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

/**
 * Employees with a SALARY ledger row in a PAYROLL batch for this period.
 * Optional `ids` scopes the lookup (employee_id = ANY).
 * @returns {Promise<Set<string>>}
 */
async function getPaidEmployeeIds(pool, year, month, ids = []) {
    const scoped = normalizeEmployeeIds(ids);
    let q = `SELECT DISTINCT pl.employee_id
             FROM payment_ledger pl
             JOIN payment_batches pb ON pb.id = pl.batch_id
             WHERE pb.batch_type = 'PAYROLL'
               AND pb.year = $1 AND pb.month = $2
               AND pl.payment_type = 'SALARY'
               AND pl.status = 'Paid'`;
    const params = [year, month];
    if (scoped.length) {
        params.push(scoped);
        q += ` AND pl.employee_id = ANY($3::text[])`;
    }
    const { rows } = await pool.query(q, params);
    return new Set(rows.map((r) => r.employee_id).filter(Boolean));
}

/** True if any employee has a paid SALARY ledger row this month (banner / any-payment). */
async function isMonthPaid(pool, year, month) {
    const paid = await getPaidEmployeeIds(pool, year, month);
    return paid.size > 0;
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
    const paidSet = await getPaidEmployeeIds(pool, yr, mo);

    let empQ = `
        SELECT e.id, e.name, e.email, e.claim_authority, e.primary_contact AS phone, e.cnic,
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

    const withEmail = employees.filter(e => hasPayslipEmailChannel(e)).length;
    const withPhone = employees.filter(e => firstValidPkMobile(e.phone)).length;
    const withCnic = employees.filter(e => normalizeCnic(e.cnic).length >= 5).length;
    const missingCnic = employees.filter(e => normalizeCnic(e.cnic).length < 5);
    const missingEmail = employees.filter(e => !hasPayslipEmailChannel(e));
    const missingPhone = employees.filter(e => !firstValidPkMobile(e.phone));

    // Scoped send: only the selected employees must be locked.
    // Full-month send: every payroll row for the month must be locked.
    const scopeLocked = lockStats.total > 0 && lockStats.locked_count === lockStats.total
        && (!ids.length || lockStats.total === ids.length);

    const deliveryMap = await getMonthDeliveryMap(pool, yr, mo);

    const employeeList = employees.map((e) => {
        const prior = deliveryMap.get(e.id);
        return {
            id: e.id,
            name: e.name,
            locked: e.locked === true,
            paid: paidSet.has(e.id),
            emailStatus: prior?.email_status || 'none',
            smsStatus: prior?.sms_status || 'none',
            hasEmail: hasPayslipEmailChannel(e),
            payslipRecipients: resolvePayslipRecipients(e),
            hasPhone: !!firstValidPkMobile(e.phone),
            hasCnic: normalizeCnic(e.cnic).length >= 5,
        };
    });
    const notPaid = employeeList.filter((e) => !e.paid).map((e) => ({ id: e.id, name: e.name }));
    const paidCount = employeeList.filter((e) => e.paid).length;
    const everyEmployeeInScopeIsPaid = employeeList.length > 0 && notPaid.length === 0;
    // Backward compatible `paid`: every employee in scope is paid (not "any batch exists").
    const paid = everyEmployeeInScopeIsPaid;

    const alreadyDeliveredCount = employeeList.filter((e) => (
        isSentStatus(e.emailStatus) || isSentStatus(e.smsStatus)
    )).length;
    const emailSentCount = employeeList.filter((e) => isSentStatus(e.emailStatus)).length;
    const smsSentCount = employeeList.filter((e) => isSentStatus(e.smsStatus)).length;
    const remainingEmail = employeeList
        .filter((e) => e.paid && e.hasEmail && e.hasCnic && !isSentStatus(e.emailStatus))
        .map((e) => ({ id: e.id, name: e.name }));
    const remainingSms = employeeList
        .filter((e) => e.paid && e.hasPhone && e.hasCnic && !isSentStatus(e.smsStatus))
        .map((e) => ({ id: e.id, name: e.name }));

    const alreadySent = batch?.status === 'sent';
    // Force only when nobody in scope still needs email or SMS.
    const needsForceResend = employees.length > 0
        && alreadyDeliveredCount > 0
        && remainingEmail.length === 0
        && remainingSms.length === 0;

    return {
        year: yr,
        month: mo,
        scope: ids.length ? 'selected' : 'all',
        selectedCount: ids.length,
        allLocked: scopeLocked,
        lockedCount: lockStats.locked_count,
        totalRows: lockStats.total,
        paid,
        paidCount,
        notPaid,
        paidIds: [...paidSet],
        employees: employeeList,
        alreadySent,
        alreadyDeliveredCount,
        emailSentCount,
        smsSentCount,
        remainingEmail,
        remainingSms,
        needsForceResend,
        batch,
        employeeCount: employees.length,
        withEmail,
        withPhone,
        withCnic,
        missingCnic: missingCnic.map(e => ({ id: e.id, name: e.name })),
        missingEmail: missingEmail.map(e => ({ id: e.id, name: e.name, email: e.email || '' })),
        missingPhone: missingPhone.map(e => ({ id: e.id, name: e.name, phone: e.phone || '' })),
        canSend: scopeLocked && everyEmployeeInScopeIsPaid,
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
    const onlyMissing = normalizeOnlyMissing(opts.onlyMissing);
    const destEmailOverride = isUsableEmail(opts.destEmail);
    const destPhoneOverride = firstValidPkMobile(opts.destPhone);
    const { sendAppEmail, sendJazzSMS } = deps;
    const yr = parseInt(year, 10);
    const mo = parseInt(month, 10);
    const ids = normalizeEmployeeIds(opts.employeeIds);
    const scoped = ids.length > 0;

    // Empty selection must explicitly opt into send-all or remaining-channel — never silently expand.
    if (!scoped && !sendAll && !onlyMissing) {
        const err = new Error('SELECTION_REQUIRED');
        err.code = 'SELECTION_REQUIRED';
        throw err;
    }

    if (!confirm) {
        const err = new Error('CONFIRM_REQUIRED');
        err.code = 'CONFIRM_REQUIRED';
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
    } else if (!onlyMissing) {
        const lockReadiness = await getPayslipReadiness(pool, yr, mo, []);
        if (!lockReadiness.allLocked) {
            const err = new Error('NOT_ALL_LOCKED');
            err.code = 'NOT_ALL_LOCKED';
            throw err;
        }
    }

    const paidSet = await getPaidEmployeeIds(pool, yr, mo, scoped ? ids : []);
    const unpaid = scoped
        ? ids.filter((id) => !paidSet.has(id))
        : [];
    if (scoped && unpaid.length) {
        const err = new Error('NOT_PAID');
        err.code = 'NOT_PAID';
        err.detail = { unpaid };
        throw err;
    }

    const readiness = await getPayslipReadiness(pool, yr, mo, ids);
    if (!scoped && !onlyMissing && !readiness.paid) {
        const err = new Error('NOT_PAID');
        err.code = 'NOT_PAID';
        err.detail = { unpaid: (readiness.notPaid || []).map((e) => e.id) };
        throw err;
    }
    if (!forceResend) {
        const remainingForAction = onlyMissing === 'email'
            ? (readiness.remainingEmail || [])
            : onlyMissing === 'sms'
                ? (readiness.remainingSms || [])
                : [...(readiness.remainingEmail || []), ...(readiness.remainingSms || [])];
        if ((readiness.employees || []).length > 0 && remainingForAction.length === 0
            && readiness.alreadyDeliveredCount > 0) {
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
        SELECT e.id, e.name, e.email, e.claim_authority, e.primary_contact, e.cnic, e.designation,
               e.client, e.location, e.bank_name, e.bank_account, e.contract_name, e.salary,
               pt.paid_days, pt.gross, pt.net, pt.ot2_hrs, pt.ot3_hrs, pt.opd_claim, pt.reimbursement,
               pt.arrears, pt.special_allowance, pt.fuel_mobile, pt.bonus_amount, pt.wht, pt.eobi_ee,
               pt.advance_deduction, pt.loan_deduction, pt.other_deduction, pt.locked,
               pt.year, pt.month, pt.computed_json
        FROM payroll_transactions pt
        JOIN employees e ON e.id = pt.employee_id
        WHERE pt.year = $1 AND pt.month = $2 AND pt.locked = TRUE`;
    const params = [yr, mo];
    const paidIds = [...paidSet];
    if (scoped) {
        params.push(ids);
        empQ += ` AND e.id = ANY($3::text[])`;
        params.push(paidIds);
        empQ += ` AND e.id = ANY($4::text[])`;
    } else {
        params.push(paidIds);
        empQ += ` AND e.id = ANY($3::text[])`;
    }
    let { rows: targets } = await pool.query(empQ, params);

    if (scoped && targets.length !== ids.length) {
        const found = new Set(targets.map((t) => t.id));
        const missing = ids.filter((id) => !found.has(id));
        const stillUnpaid = missing.filter((id) => !paidSet.has(id));
        if (stillUnpaid.length) {
            const err = new Error('NOT_PAID');
            err.code = 'NOT_PAID';
            err.detail = { unpaid: stillUnpaid };
            throw err;
        }
        const err = new Error('NOT_ALL_LOCKED');
        err.code = 'NOT_ALL_LOCKED';
        err.detail = { missing, unlocked: [] };
        throw err;
    }

    const deliveryMap = await getMonthDeliveryMap(pool, yr, mo);
    const planned = targets.map((row) => {
        const prior = deliveryMap.get(row.id);
        const destEmails = destEmailOverride
            ? [destEmailOverride]
            : resolvePayslipRecipients(row);
        const destEmail = destEmails[0] || '';
        const destPhone = destPhoneOverride || firstValidPkMobile(row.primary_contact);
        const wantEmail = (!onlyMissing || onlyMissing === 'email')
            && (forceResend || !isSentStatus(prior?.email_status))
            && destEmails.length > 0;
        const wantSms = (!onlyMissing || onlyMissing === 'sms')
            && (forceResend || !isSentStatus(prior?.sms_status))
            && !!destPhone;
        return { row, wantEmail, wantSms, destEmail, destEmails, destPhone };
    }).filter((p) => p.wantEmail || p.wantSms);
    targets = planned.map((p) => p.row);
    const planById = new Map(planned.map((p) => [p.row.id, p]));

    let emailCount = 0;
    let smsCount = 0;
    let failedCount = 0;
    const failed = [];
    const skipped = [];
    const deliveries = [];

    for (const row of targets) {
        const emp = row;
        const pay = row;
        const plan = planById.get(emp.id) || {};
        try {
            const eosbType = await getContractEosbType(pool, emp.contract_name);
            const doc = await generateAndStorePdf(pool, emp, pay, eosbType, batchId, yr, mo);

            let emailStatus = 'skipped';
            let smsStatus = 'skipped';
            let emailDetail = plan.wantEmail ? null : (onlyMissing === 'sms' ? 'channel_not_requested' : 'already sent');
            let smsDetail = plan.wantSms ? null : (onlyMissing === 'email' ? 'channel_not_requested' : 'already sent');
            let tokenId = null;
            const destEmails = (plan.destEmails && plan.destEmails.length)
                ? plan.destEmails
                : (plan.destEmail ? [plan.destEmail] : []);
            const destEmail = destEmails.join(', ');
            const destPhone = plan.destPhone || '';

            if (plan.wantEmail && destEmails.length && sendAppEmail) {
                try {
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
                    const mailResult = await sendAppEmail({
                        to: destEmails,
                        subject: `TRIAL — Salary Slip — ${monthName} ${yr} | ASIL`,
                        html: cover,
                        attachments: [{
                            filename: `PaySlip_${safeName}_${monthName}_${yr}.pdf`,
                            content: pdfBuf,
                        }],
                    });
                    if (mailResult?.skipped) {
                        emailStatus = 'skipped';
                        emailDetail = mailResult.reason || 'email provider unavailable';
                    } else if (mailResult?.ok === false || mailResult?.result?.error) {
                        emailStatus = 'failed';
                        emailDetail = 'email_rejected';
                    } else {
                        emailStatus = 'sent';
                        emailCount += 1;
                    }
                } catch (mailErr) {
                    console.error('[send-payslips email]', emp.id, mailErr);
                    emailStatus = 'failed';
                    emailDetail = 'email_failed';
                }
            } else if (plan.wantEmail && !destEmails.length) {
                emailDetail = 'no valid employee or focal email on file';
            }

            if (plan.wantSms && destPhone && sendJazzSMS) {
                try {
                    const { rawToken, tokenId: tid } = await mintAccessToken(pool, {
                        employeeId: emp.id,
                        year: yr,
                        month: mo,
                        documentId: doc.id,
                    });
                    tokenId = tid;
                    const sms = buildSmsMessage(rawToken);
                    const smsResult = await sendJazzSMS(destPhone, sms);
                    if (smsResult?.skipped) {
                        smsStatus = 'skipped';
                        smsDetail = smsResult.reason || 'sms skipped';
                    } else if (smsResult && smsResult.ok === false) {
                        smsStatus = 'failed';
                        smsDetail = 'sms_rejected';
                    } else {
                        smsStatus = sms.length > 160 ? 'sent_long' : 'sent';
                        smsCount += 1;
                    }
                } catch (smsErr) {
                    console.error('[send-payslips sms]', emp.id, smsErr);
                    smsStatus = 'failed';
                    smsDetail = 'sms_failed';
                }
            } else if (plan.wantSms && !destPhone) {
                smsDetail = 'no valid mobile on file';
            }

            if (emailStatus === 'failed' || smsStatus === 'failed') {
                failedCount += 1;
                failed.push({
                    id: emp.id,
                    name: emp.name,
                    err: emailDetail || smsDetail || 'channel_failed',
                });
            }

            deliveries.push({
                id: emp.id,
                name: emp.name,
                email: destEmail,
                phone: destPhone,
                emailStatus,
                smsStatus,
                emailDetail,
                smsDetail,
            });

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
            deliveries.push({
                id: emp.id,
                name: emp.name,
                email: destEmailOverride || isUsableEmail(emp.email),
                phone: destPhoneOverride || firstValidPkMobile(emp.primary_contact),
                emailStatus: 'failed',
                smsStatus: 'failed',
                emailDetail: e.code || 'send_failed',
                smsDetail: e.code || 'send_failed',
            });
            await pool.query(
                `INSERT INTO payslip_delivery_log (batch_id, employee_id, email_status, sms_status, error_detail)
                 VALUES ($1, $2, 'failed', 'failed', $3)`,
                [batchId, emp.id, e.message]
            );
        }
    }

    const channelFailed = deliveries.some(d => d.emailStatus === 'failed' || d.smsStatus === 'failed');
    const totals = await recomputeBatchTotals(pool, batchId);
    const status = failedCount > 0 && (emailCount + smsCount) === 0
        ? 'failed'
        : ((onlyMissing || scoped || failedCount > 0 || channelFailed) ? 'partial' : 'sent');
    await pool.query(
        `UPDATE payslip_delivery_batches
         SET status = $2, sent_at = NOW(), employee_count = $3, email_count = $4, sms_count = $5, failed_count = $6
         WHERE id = $1`,
        [batchId, status, totals.delivered, totals.email_count, totals.sms_count, totals.failed_count]
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
        sent: deliveries.filter(d => d.emailStatus === 'sent' || String(d.smsStatus).startsWith('sent')).length,
        emailCount,
        smsCount,
        failed,
        skipped,
        deliveries,
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
        const phone = firstValidPkMobile(emp.primary_contact);
        if (phone) await deps.sendJazzSMS(phone, msg.slice(0, 160)).catch(() => {});
    }
    return c;
}

module.exports = {
    getPaidEmployeeIds,
    getPayslipReadiness,
    getStoredDocument,
    sendPayslips,
    createSupportCase,
    resolveSupportCase,
    frontendBase,
    backendBase,
    payslipPdfLink,
    buildSmsMessage,
    isUsableEmail,
    resolvePayslipRecipients,
    hasPayslipEmailChannel,
    OPS_SUPPORT,
};
