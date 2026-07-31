'use strict';

const crypto = require('crypto');
const { hashToken } = require('../../intake/autoAck');
const { claimMonthFloor } = require('../../core/cutover');

const FALLBACK_EMAIL = 'huzaifa.rafaqat@asil.com.pk';
const TOKEN_TTL_DAYS = 14;
const READY_STATES = new Set(['ready_for_hcm', 'legacy_bypass']);

function isNamedEmail(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s !== '' && s !== 'n/a' && s !== 'na' && s !== 'none' && s.includes('@');
}

function computeRoutingProfile(lmEmail, focalEmail) {
    const lm = isNamedEmail(lmEmail);
    const focal = isNamedEmail(focalEmail);
    if (lm && focal) {
        return {
            profile: 'focal_then_lm',
            initialState: 'pending_focal_input',
            focalEmail: String(focalEmail).trim().toLowerCase(),
            lmEmail: String(lmEmail).trim().toLowerCase(),
        };
    }
    if (lm && !focal) {
        return {
            profile: 'lm_only',
            initialState: 'pending_lm_approval',
            focalEmail: null,
            lmEmail: String(lmEmail).trim().toLowerCase(),
        };
    }
    if (!lm && focal) {
        return {
            profile: 'focal_only',
            initialState: 'pending_focal_input',
            focalEmail: String(focalEmail).trim().toLowerCase(),
            lmEmail: null,
        };
    }
    return {
        profile: 'fallback_huzaifa',
        initialState: 'pending_focal_input',
        focalEmail: FALLBACK_EMAIL,
        lmEmail: null,
    };
}

function makeToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function logApprovalEvent(pool, { sessionId, step, actorEmail, decision, comment }) {
    await pool.query(
        `INSERT INTO wafi_claims_approval_events (session_id, step, actor_email, decision, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, step, actorEmail || null, decision, comment || null]
    );
}

async function isChainEnabled(pool) {
    const { rows } = await pool.query(`SELECT value FROM system_config WHERE key = 'wafi_approval_chain_enabled'`);
    const v = rows[0]?.value;
    return v !== false && v !== 'false';
}

async function resolveSessionRouting(pool, sessionId) {
    const { rows: items } = await pool.query(
        `SELECT DISTINCT wci.employee_id, e.line_manager_email, e.claim_authority, e.supervisor_email
         FROM wafi_claims_items wci
         LEFT JOIN employees e ON e.id = wci.employee_id
         WHERE wci.session_id = $1 AND wci.active = TRUE AND wci.employee_id IS NOT NULL`,
        [sessionId]
    );
    if (!items.length) {
        return computeRoutingProfile(null, null);
    }
    const first = items.find(i => isNamedEmail(i.line_manager_email) || isNamedEmail(i.claim_authority)) || items[0];
    const lm = first.line_manager_email || first.supervisor_email;
    const focal = first.claim_authority;
    return computeRoutingProfile(lm, focal);
}

async function sendApprovalEmail({ to, subject, html, sendAppEmail }) {
    if (!to || !sendAppEmail) return false;
    try {
        await sendAppEmail({ to, subject, html });
        return true;
    } catch (err) {
        console.error('[wafi-approval-email]', err);
        return false;
    }
}

function buildActionLink(baseUrl, path, token, sessionId) {
    return `${baseUrl}${path}?token=${token}&id=${sessionId}`;
}

function buildApprovalEmailHtml({ title, sessionId, actionUrl, instructions }) {
    return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;padding:28px;">
  <h2 style="color:#1e293b;margin:0 0 12px;">${title}</h2>
  <p style="color:#475569;line-height:1.6;">${instructions}</p>
  <p style="color:#64748b;font-size:0.85rem;">Session #${sessionId}</p>
  <p style="margin:24px 0;"><a href="${actionUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open approval form</a></p>
  <p style="color:#94a3b8;font-size:0.75rem;">Link expires in ${TOKEN_TTL_DAYS} days. Allied Services (Pvt.) Ltd. · ASIL HCM</p>
</div></body></html>`;
}

async function initApprovalChain(pool, sessionId, { sendAppEmail, appBaseUrl } = {}) {
    if (!(await isChainEnabled(pool))) {
        await pool.query(
            `UPDATE wafi_claims_sessions SET approval_state = 'legacy_bypass', routing_profile = 'disabled' WHERE id = $1`,
            [sessionId]
        );
        return { state: 'legacy_bypass' };
    }

    const { rows: sess } = await pool.query(`SELECT * FROM wafi_claims_sessions WHERE id = $1`, [sessionId]);
    if (!sess.length) return { error: 'NOT_FOUND' };
    const session = sess[0];

    // Pre-July claim months stay legacy for routing
    if (session.claim_month) {
        const cm = new Date(session.claim_month);
        if (cm < new Date('2026-07-01')) {
            await pool.query(
                `UPDATE wafi_claims_sessions SET approval_state = 'legacy_bypass', routing_profile = 'pre_cutover' WHERE id = $1`,
                [sessionId]
            );
            return { state: 'legacy_bypass', reason: 'pre_cutover' };
        }
    }

    if (!['PENDING_REVIEW', 'PROCESSED_SUCCESSFULLY'].includes(session.processing_status)) {
        return { skipped: true, status: session.processing_status };
    }

    const routing = await resolveSessionRouting(pool, sessionId);
    const focalToken = routing.initialState === 'pending_focal_input' ? makeToken() : null;
    const lmToken = routing.initialState === 'pending_lm_approval' ? makeToken() : null;

    await pool.query(
        `UPDATE wafi_claims_sessions SET
            approval_state = $2,
            routing_profile = $3,
            focal_email = $4,
            lm_email = $5,
            focal_token_hash = $6,
            lm_token_hash = $7
         WHERE id = $1`,
        [
            sessionId,
            routing.initialState,
            routing.profile,
            routing.focalEmail,
            routing.lmEmail,
            focalToken ? hashToken(focalToken) : null,
            lmToken ? hashToken(lmToken) : null,
        ]
    );

    const base = appBaseUrl || process.env.APP_BASE_URL || process.env.BACKEND_URL || '';

    if (focalToken && routing.focalEmail) {
        const url = buildActionLink(base, '/api/wafi-claims/focal-action', focalToken, sessionId);
        await sendApprovalEmail({
            to: routing.focalEmail,
            subject: `[ASIL HCM] Wafi claims — focal review required (#${sessionId})`,
            html: buildApprovalEmailHtml({
                title: 'Wafi Claims — Focal Review',
                sessionId,
                actionUrl: url,
                instructions: 'Please review and confirm the claim line items submitted for your team. After your approval, the line manager step will follow if required.',
            }),
            sendAppEmail,
        });
        await logApprovalEvent(pool, {
            sessionId, step: 'focal_link_sent', actorEmail: routing.focalEmail, decision: 'sent',
        });
    }

    if (lmToken && routing.lmEmail) {
        const url = buildActionLink(base, '/api/wafi-claims/lm-action', lmToken, sessionId);
        await sendApprovalEmail({
            to: routing.lmEmail,
            subject: `[ASIL HCM] Wafi claims — manager approval required (#${sessionId})`,
            html: buildApprovalEmailHtml({
                title: 'Wafi Claims — Manager Approval',
                sessionId,
                actionUrl: url,
                instructions: 'Please approve or reject the Wafi claims submission for your team.',
            }),
            sendAppEmail,
        });
        await logApprovalEvent(pool, {
            sessionId, step: 'lm_link_sent', actorEmail: routing.lmEmail, decision: 'sent',
        });
    }

    return { state: routing.initialState, profile: routing.profile };
}

async function assertReadyForHcm(pool, sessionId) {
    const { rows } = await pool.query(
        `SELECT approval_state, processing_status, claim_month FROM wafi_claims_sessions WHERE id = $1`,
        [sessionId]
    );
    if (!rows.length) return { ok: false, status: 404, code: 'NOT_FOUND' };
    const { approval_state: state, claim_month: claimMonth } = rows[0];
    if (READY_STATES.has(state)) return { ok: true };

    const postCutover = claimMonth && new Date(claimMonth) >= new Date('2026-07-01');
    const chainEnabled = postCutover ? await isChainEnabled(pool) : false;

    if (state == null) {
        if (chainEnabled) {
            return {
                ok: false,
                status: 409,
                code: 'APPROVAL_PENDING',
                approval_state: 'not_initialized',
                message: 'Approval chain not complete (not initialized)',
            };
        }
        return { ok: true };
    }

    return {
        ok: false,
        status: 409,
        code: 'APPROVAL_PENDING',
        approval_state: state,
        message: `Approval chain incomplete (current state: ${state})`,
    };
}

async function handleFocalAction(pool, { sessionId, token, decision, comment, actorEmail }) {
    const { rows } = await pool.query(`SELECT * FROM wafi_claims_sessions WHERE id = $1`, [sessionId]);
    if (!rows.length) return { ok: false, status: 404 };
    const sess = rows[0];
    if (sess.approval_state !== 'pending_focal_input') {
        return { ok: false, status: 409, error: 'Focal step not pending' };
    }
    if (!sess.focal_token_hash || sess.focal_token_hash !== hashToken(token)) {
        return { ok: false, status: 403, error: 'Invalid or expired token' };
    }

    if (decision === 'reject') {
        await pool.query(
            `UPDATE wafi_claims_sessions SET approval_state = 'focal_rejected', focal_token_hash = NULL WHERE id = $1`,
            [sessionId]
        );
        await logApprovalEvent(pool, { sessionId, step: 'focal', actorEmail, decision: 'rejected', comment });
        return { ok: true, state: 'focal_rejected' };
    }

    const needsLm = ['focal_then_lm', 'lm_only'].includes(sess.routing_profile)
        || (sess.routing_profile === 'focal_then_lm');
    const lmNeeded = sess.routing_profile === 'focal_then_lm' && isNamedEmail(sess.lm_email);

    if (lmNeeded) {
        const lmToken = makeToken();
        await pool.query(
            `UPDATE wafi_claims_sessions SET
                approval_state = 'pending_lm_approval',
                focal_token_hash = NULL,
                lm_token_hash = $2
             WHERE id = $1`,
            [sessionId, hashToken(lmToken)]
        );
        await logApprovalEvent(pool, { sessionId, step: 'focal', actorEmail, decision: 'approved', comment });
        return { ok: true, state: 'pending_lm_approval', lmToken, lmEmail: sess.lm_email };
    }

    await pool.query(
        `UPDATE wafi_claims_sessions SET approval_state = 'ready_for_hcm', focal_token_hash = NULL WHERE id = $1`,
        [sessionId]
    );
    await logApprovalEvent(pool, { sessionId, step: 'focal', actorEmail, decision: 'approved', comment });
    return { ok: true, state: 'ready_for_hcm' };
}

async function handleLmAction(pool, { sessionId, token, decision, comment, actorEmail }) {
    const { rows } = await pool.query(`SELECT * FROM wafi_claims_sessions WHERE id = $1`, [sessionId]);
    if (!rows.length) return { ok: false, status: 404 };
    const sess = rows[0];
    if (sess.approval_state !== 'pending_lm_approval') {
        return { ok: false, status: 409, error: 'LM step not pending' };
    }
    if (!sess.lm_token_hash || sess.lm_token_hash !== hashToken(token)) {
        return { ok: false, status: 403, error: 'Invalid or expired token' };
    }

    if (decision === 'reject') {
        await pool.query(
            `UPDATE wafi_claims_sessions SET approval_state = 'lm_rejected', lm_token_hash = NULL WHERE id = $1`,
            [sessionId]
        );
        await logApprovalEvent(pool, { sessionId, step: 'lm', actorEmail, decision: 'rejected', comment });
        return { ok: true, state: 'lm_rejected' };
    }

    await pool.query(
        `UPDATE wafi_claims_sessions SET approval_state = 'ready_for_hcm', lm_token_hash = NULL WHERE id = $1`,
        [sessionId]
    );
    await logApprovalEvent(pool, { sessionId, step: 'lm', actorEmail, decision: 'approved', comment });
    return { ok: true, state: 'ready_for_hcm' };
}

function wafiSessionPeriodClause(alias = 'wcs', opts = {}) {
    return claimMonthFloor(`${alias}.claim_month`, opts);
}

module.exports = {
    FALLBACK_EMAIL,
    READY_STATES,
    isNamedEmail,
    computeRoutingProfile,
    initApprovalChain,
    assertReadyForHcm,
    handleFocalAction,
    handleLmAction,
    logApprovalEvent,
    wafiSessionPeriodClause,
    buildApprovalEmailHtml,
    buildActionLink,
};
