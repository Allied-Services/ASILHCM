'use strict';

const {
    countEligibleEmployees,
    resolveClaimsCategory,
} = require('./claimsEligibility');
const {
    stableFillerToken,
    hashToken,
    resolveOutboundEmail,
    sampleSubjectPrefix,
    sampleBodyBanner,
    isSamplePeriod,
    getClaimsMonitorCc,
} = require('./claimsMail');

function buildShortFillerInviteHtml({
    period, employeeCount, link, fillerEmail, employees = [], routingProfile, approverSummary, roleLabel, intendedEmail,
}) {
    const claimLabel = `${period.claim_month}/${period.claim_year}`;
    const empList = (employees || [])
        .map(e => `<li style="margin:4px 0"><strong>${e.id || ''}</strong> — ${e.name || 'Employee'}</li>`)
        .join('');
    const dest = routingProfile === 'focal_only'
        ? 'You are the <strong>final approver</strong> — no Line Manager on file.'
        : approverSummary
            ? `After you submit, <strong>${approverSummary}</strong> will review and approve.`
            : 'Your Line Manager will review after you submit.';
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="background:#1e3a8a;color:#fff;padding:22px 28px">
<div style="font-size:13px;opacity:.9;text-transform:uppercase">ASIL Claims</div>
<div style="font-size:22px;font-weight:700;margin-top:4px">Monthly claims — ${claimLabel}</div>
</td></tr>
<tr><td style="padding:28px">
${sampleBodyBanner(period, intendedEmail || fillerEmail, roleLabel)}
<p style="margin:0 0 14px;font-size:15px;line-height:1.55">You are the Claim Authority for <strong>${employeeCount}</strong> employee(s).</p>
${empList ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:14px">${empList}</ul>` : ''}
<ol style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.6">
<li>Open the secure form (no password).</li>
<li>Download <strong>your Excel</strong> (codes prefilled) or enter on screen.</li>
<li>Review totals, then confirm submit. ${dest}</li>
</ol>
<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700">Open claims form</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">${link}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function buildEmployeeInviteHtml({ period, link, employeeName, employeeId, approverEmail, roleLabel, intendedEmail }) {
    const claimLabel = `${period.claim_month}/${period.claim_year}`;
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" style="padding:24px"><tr><td align="center">
<table role="presentation" width="640" style="max-width:640px;background:#fff;border-radius:14px;padding:28px;border:1px solid #e2e8f0">
${sampleBodyBanner(period, intendedEmail, roleLabel)}
<h2 style="margin:0 0 8px">Your claims — ${claimLabel}</h2>
<p style="color:#334155;line-height:1.55">Hello ${employeeName || employeeId}, submit your own OT, Expense, and Medical for <strong>${claimLabel}</strong>.</p>
<p style="color:#475569;font-size:14px">Approver: <strong>${approverEmail || 'ASIL Operations'}</strong></p>
<p style="margin:18px 0"><a href="${link}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open my claims</a></p>
<p style="font-size:12px;color:#64748b">${link}</p>
</table></td></tr></table></body></html>`;
}

async function ensurePeriodMode(pool, periodId, campaignMode) {
    const mode = campaignMode === 'sample' ? 'sample' : 'actual';
    await pool.query(
        `UPDATE portal_claim_periods SET campaign_mode = $2 WHERE id = $1`,
        [periodId, mode]
    );
}

/** One employee per routing profile — separate filler batches so Shezad gets 4 labeled test emails. */
const TEST_PACK_PROFILES = [
    { profile: 'focal_then_lm', filler: 'sample.focal-lm@test.asil', roleLabel: 'Focal+LM' },
    { profile: 'focal_only', filler: 'sample.focal-only@test.asil', roleLabel: 'Focal only' },
    { profile: 'employee_then_lm', filler: 'sample.employee-lm@test.asil', roleLabel: 'Employee+LM' },
    { profile: 'employee_then_asil', filler: 'sample.employee-asil@test.asil', roleLabel: 'Employee+ASIL' },
];

function applyTestPackFour(eligible) {
    const picked = [];
    for (const spec of TEST_PACK_PROFILES) {
        const emp = eligible.find(e => e.routing_profile === spec.profile);
        if (!emp) continue;
        picked.push({
            ...emp,
            filler_email: spec.filler,
            claims_category: spec.roleLabel,
            cohort_type: emp.cohort_type || (spec.profile.startsWith('employee') ? 'employee' : 'focal'),
        });
    }
    return picked;
}

function safeOutboundEmail(period, fillerEmail, roleLabel) {
    try {
        return resolveOutboundEmail(period, fillerEmail, { roleLabel });
    } catch {
        return { to: fillerEmail, originalTo: fillerEmail, sample: false, roleLabel: null };
    }
}

/** Same subject + HTML the live send uses — preview and send must not drift. */
function buildInvitePayload({
    period, fillerEmail, emps, cohortType, routingProfile, roleLabel,
    FRONTEND_URL, buildFillerInviteHtml,
}) {
    const token = stableFillerToken(period.id, fillerEmail);
    const tokenHash = hashToken(token);
    const link = `${FRONTEND_URL}/?asil_claims=fill&token=${token}`;
    const mail = safeOutboundEmail(period, fillerEmail, roleLabel);
    const approverSummary = emps[0]?.approver_email && emps[0].approver_email !== fillerEmail
        ? emps[0].approver_email : null;
    const rawHtml = cohortType === 'employee'
        ? buildEmployeeInviteHtml({
            period, link,
            employeeName: emps[0].name,
            employeeId: emps[0].id,
            approverEmail: emps[0].approver_email,
            roleLabel,
            intendedEmail: fillerEmail,
        })
        : (buildFillerInviteHtml || buildShortFillerInviteHtml)({
            period,
            employeeCount: emps.length,
            link,
            fillerEmail,
            employees: emps.map(e => ({ id: e.id, name: e.name })),
            routingProfile,
            approverSummary,
            roleLabel,
            intendedEmail: fillerEmail,
        });
    const html = typeof rawHtml === 'string'
        ? rawHtml
        : buildShortFillerInviteHtml({
            period, employeeCount: emps.length, link, fillerEmail,
            employees: emps, routingProfile, approverSummary, roleLabel, intendedEmail: fillerEmail,
        });
    const subject = `${sampleSubjectPrefix(period, roleLabel)}ASIL Claims ${period.claim_month}/${period.claim_year} — ${emps.length} employee(s)`;
    const cc = getClaimsMonitorCc();
    return { token, tokenHash, link, mail, html, subject, approverSummary, cc };
}

function mapPreviewEmployee(e) {
    return {
        id: e.id,
        name: e.name,
        client: e.client || '',
        location: e.location || '',
        contract_id: e.contract_id || '',
        contract_name: e.contract_name || e.contract_id || '',
        dept: e.dept || '',
        filler_email: e.filler_email || null,
        approver_email: e.approver_email || null,
        routing_profile: e.routing_profile || null,
        claims_category: e.claims_category || null,
        cohort_type: e.cohort_type || null,
    };
}

function flattenPreviewEmployees(recipients) {
    const rows = [];
    for (const r of recipients || []) {
        for (const e of r.employees || []) {
            rows.push({
                ...e,
                fillerEmail: r.fillerEmail,
                mailTo: r.mailTo,
                sampleRedirect: !!r.sampleRedirect,
                approverEmail: e.approver_email || r.approverEmail,
                routingProfile: e.routing_profile || r.routingProfile,
                roleLabel: e.claims_category || r.roleLabel,
                template: r.template,
                subject: r.subject,
            });
        }
    }
    return rows;
}

function summarizeRecipients(recipients) {
    const byProfile = {};
    for (const r of recipients) {
        const key = r.routingProfile || 'unknown';
        byProfile[key] = (byProfile[key] || 0) + 1;
    }
    return {
        recipientCount: recipients.length,
        employeeCount: recipients.reduce((n, r) => n + (r.employeeCount || 0), 0),
        byProfile,
    };
}

async function createCampaignAugust(pool, {
    period,
    campaignMonth,
    campaignYear,
    sendAppEmail,
    dryRun,
    preview,
    onlyEmails,
    onlyEmployeeIds,
    campaignMode,
    testPackFour,
    FRONTEND_URL,
    FILL_CLOSE_DAY,
    buildFillerInviteHtml,
}) {
    period.campaign_mode = campaignMode === 'sample' ? 'sample' : 'actual';
    if (!preview) {
        await ensurePeriodMode(pool, period.id, campaignMode);
    }

    const { eligible, skipped, rules } = await countEligibleEmployees(pool);
    let filtered = eligible;
    if (testPackFour) {
        filtered = applyTestPackFour(eligible);
        if (!filtered.length) {
            return {
                period,
                invites: [],
                recipients: [],
                skipped: [...skipped, { reason: 'testPackFour: no employee found for each routing profile' }],
                fillerCount: 0,
                employeeCount: 0,
                campaignMode: period.campaign_mode,
                testPackFour: true,
                summary: { recipientCount: 0, employeeCount: 0, byProfile: {} },
            };
        }
    } else {
        if (onlyEmails && onlyEmails.length) {
            const set = new Set(onlyEmails.map(x => String(x).toLowerCase()));
            filtered = filtered.filter(e => set.has(String(e.filler_email || '').toLowerCase()));
        }
        if (onlyEmployeeIds && onlyEmployeeIds.length) {
            const set = new Set(onlyEmployeeIds.map(x => String(x)));
            filtered = filtered.filter(e => set.has(String(e.id)));
        }
    }

    const byFiller = new Map();
    for (const e of filtered) {
        if (!e.filler_email) continue;
        if (!byFiller.has(e.filler_email)) byFiller.set(e.filler_email, []);
        byFiller.get(e.filler_email).push(e);
    }

    const invites = [];
    const recipients = [];
    for (const [fillerEmail, emps] of byFiller) {
        const cohortType = emps[0]?.cohort_type || 'focal';
        const routingProfile = emps[0]?.routing_profile || 'focal_then_lm';
        const roleLabel = emps[0]?.claims_category || (cohortType === 'employee' ? 'Employee path' : 'Focal path');
        const payload = buildInvitePayload({
            period, fillerEmail, emps, cohortType, routingProfile, roleLabel,
            FRONTEND_URL, buildFillerInviteHtml,
        });

        if (preview) {
            recipients.push({
                fillerEmail,
                mailTo: payload.mail.to,
                sampleRedirect: !!payload.mail.sample,
                roleLabel,
                cohortType,
                routingProfile,
                approverEmail: emps[0]?.approver_email || null,
                employeeCount: emps.length,
                employees: emps.map(e => mapPreviewEmployee(e)),
                subject: payload.subject,
                link: payload.link,
                html: payload.html,
                cc: payload.cc,
                template: cohortType === 'employee' ? 'employee' : 'focal',
            });
            continue;
        }

        if (!dryRun) {
            const { rows: batchRows } = await pool.query(
                `INSERT INTO portal_claim_batches
                 (period_id, filler_email, invite_token_hash, invite_sent_at, invite_delivered, status, routing_profile, cohort_type)
                 VALUES ($1,$2,$3,NOW(),TRUE,'invited',$4,$5)
                 ON CONFLICT (period_id, filler_email) DO UPDATE SET
                   invite_token_hash = EXCLUDED.invite_token_hash,
                   invite_sent_at = NOW(),
                   invite_delivered = TRUE,
                   routing_profile = EXCLUDED.routing_profile,
                   cohort_type = EXCLUDED.cohort_type,
                   status = CASE WHEN portal_claim_batches.status IN ('submitted','no_claims') THEN portal_claim_batches.status ELSE 'invited' END
                 RETURNING *`,
                [period.id, fillerEmail, payload.tokenHash, routingProfile, cohortType]
            );
            const batch = batchRows[0];

            for (const emp of emps) {
                await pool.query(
                    `INSERT INTO portal_claim_submissions
                     (period_id, batch_id, employee_id, filler_email, approver_email, status, channel, routing_profile)
                     VALUES ($1,$2,$3,$4,$5,'invited','portal',$6)
                     ON CONFLICT (period_id, employee_id) DO UPDATE SET
                       batch_id = EXCLUDED.batch_id,
                       filler_email = EXCLUDED.filler_email,
                       approver_email = EXCLUDED.approver_email,
                       routing_profile = EXCLUDED.routing_profile,
                       updated_at = NOW()
                     WHERE portal_claim_submissions.status NOT IN ('approved','in_payroll')`,
                    [period.id, batch.id, emp.id, fillerEmail, emp.approver_email, emp.routing_profile]
                );
            }

            if (sendAppEmail) {
                try {
                    await sendAppEmail({
                        to: payload.mail.to,
                        subject: payload.subject,
                        html: payload.html,
                        cc: payload.cc,
                    });
                } catch (err) {
                    await pool.query(`UPDATE portal_claim_batches SET invite_delivered = FALSE WHERE id = $1`, [batch.id]);
                    invites.push({ fillerEmail, ok: false, error: err.message, roleLabel });
                    continue;
                }
            }
            invites.push({
                fillerEmail, ok: true, employeeCount: emps.length, link: payload.link, batchId: batch.id,
                roleLabel, cohortType, routingProfile, mailTo: payload.mail.to,
            });
        } else {
            invites.push({
                fillerEmail, ok: true, dryRun: true, employeeCount: emps.length,
                employees: emps.map(e => e.id), roleLabel, cohortType, routingProfile,
            });
        }
    }

    if (!dryRun && !preview) {
        await pool.query(
            `UPDATE portal_claim_periods SET eligibility_snapshot = $2::jsonb WHERE id = $1`,
            [period.id, JSON.stringify({ rules: rules.map(r => ({ id: r.id, name: r.name })), at: new Date().toISOString() })]
        );
    }

    return {
        period,
        invites,
        recipients,
        skipped,
        fillerCount: byFiller.size,
        employeeCount: filtered.length,
        campaignMode: period.campaign_mode,
        testPackFour,
        summary: summarizeRecipients(preview ? recipients : invites.map(i => ({
            routingProfile: i.routingProfile,
            employeeCount: i.employeeCount,
        }))),
        employees: preview ? flattenPreviewEmployees(recipients) : undefined,
    };
}

function computeBatchTotals(submissions, items) {
    const byEmp = new Map();
    for (const s of submissions) {
        const empItems = items.filter(i => i.submission_id === s.id);
        let otHours = 0; let expense = 0; let medical = 0;
        for (const i of empItems) {
            if (i.claim_type === 'OT') otHours += Number(i.ot_hours) || 0;
            if (i.claim_type === 'EXPENSE') expense += Number(i.amount) || 0;
            if (i.claim_type === 'MEDICAL') medical += Number(i.amount) || 0;
        }
        byEmp.set(s.employee_id, { otHours, expense, medical, name: s.employee_name, approver: s.approver_email });
    }
    let totalOt = 0; let totalExp = 0; let totalMed = 0;
    const rows = [];
    for (const s of submissions) {
        const t = byEmp.get(s.employee_id) || { otHours: 0, expense: 0, medical: 0 };
        totalOt += t.otHours; totalExp += t.expense; totalMed += t.medical;
        rows.push({
            employee_id: s.employee_id,
            employee_name: s.employee_name,
            status: s.status,
            approver_email: s.approver_email,
            ...t,
        });
    }
    const byLm = new Map();
    for (const r of rows) {
        const key = r.approver_email || 'final';
        if (!byLm.has(key)) byLm.set(key, { approver: key, otHours: 0, expense: 0, medical: 0, count: 0 });
        const g = byLm.get(key);
        g.otHours += r.otHours; g.expense += r.expense; g.medical += r.medical; g.count += 1;
    }
    return {
        totals: { otHours: totalOt, expense: totalExp, medical: totalMed },
        employees: rows,
        byApprover: [...byLm.values()],
    };
}

module.exports = {
    createCampaignAugust,
    computeBatchTotals,
    buildShortFillerInviteHtml,
    buildEmployeeInviteHtml,
    buildInvitePayload,
    summarizeRecipients,
    isSamplePeriod,
};
