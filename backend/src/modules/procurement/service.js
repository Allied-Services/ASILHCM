'use strict';

const { validateAction } = require('../constraints/service');

async function listProcurementRequests(pool, { status } = {}) {
    let sql = `SELECT pr.*, c.contract_name, cl.name AS client_name
               FROM procurement_requests pr
               LEFT JOIN contracts c ON c.id = pr.contract_id
               LEFT JOIN clients cl ON cl.id = pr.client_id`;
    const params = [];
    if (status) {
        params.push(status);
        sql += ` WHERE pr.status = $1`;
    }
    sql += ` ORDER BY pr.created_at DESC LIMIT 100`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function createProcurementRequest(pool, data) {
    const { rows } = await pool.query(
        `INSERT INTO procurement_requests (intake_message_id, client_id, contract_id, project_id, description, requested_items, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [data.intake_message_id || null, data.client_id, data.contract_id, data.project_id,
            data.description, JSON.stringify(data.requested_items || []), data.status || 'new']
    );
    return rows[0];
}

async function getBudgetLines(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT cbl.*, COALESCE(
            (SELECT SUM(COALESCE(b.total, b.amount, 0)) FROM bills b WHERE b.budget_line_id = cbl.id AND b.status NOT IN ('Rejected','Draft')), 0
         ) AS used_amount
         FROM contract_budget_lines cbl
         WHERE cbl.contract_id = $1 AND cbl.active = true
         ORDER BY cbl.name`,
        [contractId]
    );
    return rows.map(r => ({
        ...r,
        cap: Number(r.monthly_cap || r.annual_cap || 0),
        remaining: Number(r.monthly_cap || r.annual_cap || 0) - Number(r.used_amount || 0),
    }));
}

async function createBudgetLine(pool, body) {
    const contractId = body.contractId || body.contract_id;
    const { category, name } = body;
    if (!contractId || !category || !name) {
        throw new Error('contractId, category, and name are required');
    }
    const monthlyCap = body.monthlyCap ?? body.monthly_cap;
    const annualCap = body.annualCap ?? body.annual_cap;
    const { rows } = await pool.query(
        `INSERT INTO contract_budget_lines (contract_id, category, name, monthly_cap, annual_cap, active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [
            contractId,
            category,
            name,
            monthlyCap != null && monthlyCap !== '' ? Number(monthlyCap) : null,
            annualCap != null && annualCap !== '' ? Number(annualCap) : null,
        ]
    );
    return rows[0];
}

async function updateBudgetLine(pool, id, body) {
    const monthlyCap = body.monthlyCap ?? body.monthly_cap;
    const annualCap = body.annualCap ?? body.annual_cap;
    const { rows } = await pool.query(
        `UPDATE contract_budget_lines
         SET category = COALESCE($2, category),
             name = COALESCE($3, name),
             monthly_cap = CASE WHEN $4::text IS NOT NULL THEN $4::numeric ELSE monthly_cap END,
             annual_cap = CASE WHEN $5::text IS NOT NULL THEN $5::numeric ELSE annual_cap END,
             active = COALESCE($6, active)
         WHERE id = $1
         RETURNING *`,
        [
            id,
            body.category ?? null,
            body.name ?? null,
            monthlyCap != null && monthlyCap !== '' ? String(monthlyCap) : null,
            annualCap != null && annualCap !== '' ? String(annualCap) : null,
            body.active ?? null,
        ]
    );
    if (!rows[0]) throw new Error('Budget line not found');
    return rows[0];
}

async function deactivateBudgetLine(pool, id) {
    const { rows } = await pool.query(
        `UPDATE contract_budget_lines SET active = false WHERE id = $1 RETURNING *`,
        [id]
    );
    if (!rows[0]) throw new Error('Budget line not found');
    return rows[0];
}

async function getVerificationQueue(pool) {
    const { rows } = await pool.query(
        `SELECT b.*, bd.id AS doc_id, bd.ocr_status, bd.ocr_json, bd.ocr_confidence, bd.verified_by, bd.verified_at,
                cbl.name AS budget_line_name, cbl.category AS budget_line_category
         FROM bills b
         LEFT JOIN bill_documents bd ON bd.bill_id = b.id
         LEFT JOIN contract_budget_lines cbl ON cbl.id = b.budget_line_id
         WHERE b.status IN ('Draft','Pending Approval','Pending')
            OR bd.ocr_status IN ('pending','needs_review')
            OR b.match_status IN ('unmatched','needs_review')
         ORDER BY b.created_at DESC NULLS LAST
         LIMIT 100`
    );
    return rows;
}

async function saveOcrVerification(pool, { billId, ocrJson, confidence, verifiedBy, fileId }) {
    const { rows: docRows } = await pool.query(
        `INSERT INTO bill_documents (bill_id, file_id, ocr_status, ocr_json, ocr_confidence, verified_by, verified_at)
         VALUES ($1,$2,'verified',$3,$4,$5,NOW()) RETURNING *`,
        [billId, fileId || null, JSON.stringify(ocrJson || {}), confidence || 0, verifiedBy]
    );
    if (ocrJson?.vendor || ocrJson?.grandTotal) {
        await pool.query(
            `UPDATE bills SET vendor = COALESCE($2, vendor), amount = COALESCE($3, amount), total = COALESCE($3, total),
             match_status = COALESCE(match_status, 'needs_review'), updated_at = NOW()
             WHERE id = $1`,
            [billId, ocrJson.vendor, ocrJson.grandTotal]
        );
    }
    return docRows[0] || { billId, ocrJson, verifiedBy };
}

async function matchBillToBudgetLine(pool, { billId, budgetLineId, matchedBy }) {
    const { rows: lineRows } = await pool.query(`SELECT * FROM contract_budget_lines WHERE id = $1`, [budgetLineId]);
    if (!lineRows.length) throw new Error('Budget line not found');
    const line = lineRows[0];

    const { rows: billRows } = await pool.query(`SELECT * FROM bills WHERE id = $1`, [billId]);
    if (!billRows.length) throw new Error('Bill not found');
    const bill = billRows[0];
    const amount = Number(bill.total || bill.amount || 0);
    const cap = Number(line.monthly_cap || line.annual_cap || 0);
    if (cap && amount > cap) {
        return { ok: false, code: 'BUDGET_EXCEEDED', message: 'Bill amount exceeds budget line cap' };
    }

    const { rows } = await pool.query(
        `UPDATE bills SET budget_line_id = $1, match_status = 'matched', matched_by = $2, matched_at = NOW(), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [budgetLineId, matchedBy, billId]
    );
    return { ok: true, bill: rows[0] };
}

async function canApproveBill(pool, billId, overrideReason) {
    const { rows } = await pool.query(`SELECT * FROM bills WHERE id = $1`, [billId]);
    if (!rows.length) return { ok: false, code: 'NOT_FOUND', message: 'Bill not found' };
    const bill = rows[0];
    return validateAction(pool, 'bill_approve', {
        billable: bill.billable !== false,
        matchStatus: bill.match_status,
        overrideReason,
        contractId: bill.contract_id,
    });
}

module.exports = {
    listProcurementRequests,
    createProcurementRequest,
    getBudgetLines,
    createBudgetLine,
    updateBudgetLine,
    deactivateBudgetLine,
    getVerificationQueue,
    saveOcrVerification,
    matchBillToBudgetLine,
    canApproveBill,
};
