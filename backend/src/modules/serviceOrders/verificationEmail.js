'use strict';

const { MONTH_NAMES } = require('./attendanceParse');

const ALLIED_CC = Object.freeze([
    'obaid.rana@asil.com.pk',
    'huzaifa.rafaqat@asil.com.pk',
]);

const DRY_RUN_RECIPIENTS = Object.freeze([
    'obaid.rana@asil.com.pk',
    'huzaifa.rafaqat@asil.com.pk',
    'shezad.mumtaz@asil.com.pk',
]);

function monthYearLabel(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!m || !y) return '';
    return `${MONTH_NAMES[m - 1]} ${y}`;
}

function parseEmailList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@'));
    }
    return String(raw)
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((e) => e.includes('@'));
}

/** FirstName.LastName@domain → "Firstname Lastname" (drops single-letter initials). */
function parseNameFromEmail(email) {
    const local = String(email || '').split('@')[0] || '';
    const parts = local.split(/[._-]+/).filter(Boolean);
    const significant = parts.filter((p) => p.length > 1);
    const use = significant.length ? significant : parts;
    return use
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
}

function buildSalutation({ focalName, primaryEmail }) {
    const trimmed = String(focalName || '').trim();
    if (trimmed) {
        if (/^(mr|ms|mrs|miss|dr)\.?\s/i.test(trimmed)) return trimmed;
        return `Mr. ${trimmed}`;
    }
    const parsed = parseNameFromEmail(primaryEmail);
    return parsed ? `Mr. ${parsed}` : 'Sir/Madam';
}

function composeVerificationEmail({
    siteName,
    siteCode,
    month,
    year,
    invoiceHtml,
    focalName,
    primaryEmail,
    dryRun,
    intendedTo,
}) {
    const period = monthYearLabel(month, year);
    const displaySite = siteName || siteCode || 'your terminal';
    const salutation = buildSalutation({ focalName, primaryEmail: primaryEmail || (intendedTo && intendedTo[0]) });
    const subject = `Payroll & Invoice Verification for ${period} — ${displaySite}`;

    const dryRunBanner = dryRun
        ? `<div style="background:#fff3cd;border:1px solid #ffc107;padding:12px 16px;margin-bottom:20px;border-radius:6px;">
             <strong>DRY RUN</strong> — This is a test email. In production this would be sent to:
             <em>${(intendedTo || []).join(', ') || '— no client emails configured —'}</em>
           </div>`
        : '';

    const html = `
      ${dryRunBanner}
      <div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:720px;">
        <p>Assalam-o-Alaikum ${salutation},</p>
        <p>We hope this message finds you well.</p>
        <p>
          Please note that the payroll and invoice for <strong>${displaySite}</strong> for
          <strong>${period}</strong> have been computed based on the attendance sheet provided by your team.
          Our payroll is now ready for disbursement and is awaiting your final confirmation.
        </p>
        <p>We would appreciate it if you could share your response at your earliest convenience.</p>
        <p>
          Please note that the invoice below is a <strong>proforma invoice</strong>. The actual invoice will be
          sent with all necessary supporting documents; however, this forms the basis of the calculation.
        </p>
        <p>In case of any changes proposed, please reply to us at your earliest.</p>
        <p>Thank you for your continued cooperation.</p>
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;"/>
        ${invoiceHtml || '<p><em>Invoice preview unavailable.</em></p>'}
        <p style="margin-top:24px;">
          Regards,<br/>
          <strong>Allied Services International (Pvt.) Ltd.</strong><br/>
          Human Capital Management
        </p>
      </div>
    `;

    return { subject, html, salutation };
}

function resolveSiteFocalEmails(so) {
    const meta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
    return parseEmailList(meta.focalEmail || meta.focal_emails || '');
}

function buildCcList({ contractFocalEmail }) {
    const cc = new Set(ALLIED_CC.map((e) => e.toLowerCase()));
    for (const em of parseEmailList(contractFocalEmail)) cc.add(em);
    return [...cc];
}

function skipReasonMessage(reason, sendDetail) {
    switch (reason) {
        case 'emails_disabled':
            return 'Email sending is turned off on the server (EMAILS_ENABLED=false on Render). Enable it to send verification emails.';
        case 'no_mailer':
            return 'Email service is not available on this server.';
        case 'missing_key_or_recipients':
            return 'Resend is not configured — add RESEND_API_KEY on the Render backend service.';
        case 'send_failed':
            return 'Resend rejected the email. Check Render logs for [sendAppEmail].';
        case 'send_skipped':
            return sendDetail?.reason === 'missing_key_or_recipients'
                ? 'Resend is not configured — add RESEND_API_KEY on the Render backend service.'
                : 'Email send was skipped by the mailer.';
        default:
            return reason ? String(reason) : 'Email was not sent.';
    }
}

function summarizeSendOutcome(results, dryRun) {
    const sent = results.filter((r) => r.ok).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => r.ok === false).length;
    let message = null;
    if (sent === 0 && results.length) {
        const first = results[0];
        message = skipReasonMessage(first.reason || first.error, first.send);
    } else if (sent === 0 && dryRun) {
        message = 'No site available for dry run';
    }
    return { sent, skipped, failed, message };
}

async function sendVerificationEmails(pool, sendAppEmail, {
    contractId,
    month,
    year,
    dryRun = false,
    siteCode,
    serviceOrderId,
    computeSoInvoice,
    renderInvoiceHtml,
}) {
    if (!contractId || !month || !year) {
        const err = new Error('contractId, month, and year are required');
        err.status = 400;
        throw err;
    }

    const { rows: contracts } = await pool.query(
        `SELECT id, contract_name, client_focal_name, client_focal_email FROM contracts WHERE id = $1`,
        [contractId]
    );
    if (!contracts[0]) {
        const err = new Error('Contract not found');
        err.status = 404;
        throw err;
    }
    const contract = contracts[0];
    const cc = buildCcList({ contractFocalEmail: contract.client_focal_email });

    const { rows: orders } = await pool.query(
        `SELECT id, site_code, name, meta FROM service_orders
         WHERE contract_id = $1
           AND (status IS NULL OR LOWER(TRIM(status)) NOT IN ('inactive', 'cancelled'))
         ORDER BY name`,
        [contractId]
    );

    const results = [];
    let targets = orders;

    if (dryRun) {
        let pick = null;
        if (serviceOrderId) pick = orders.find((o) => String(o.id) === String(serviceOrderId));
        if (!pick && siteCode) {
            const code = String(siteCode).trim().toUpperCase();
            pick = orders.find((o) => String(o.site_code || '').toUpperCase() === code);
        }
        if (!pick) pick = orders.find((o) => resolveSiteFocalEmails(o).length) || orders.find((o) => o.site_code === 'TARUJABBA') || orders[0];
        targets = pick ? [pick] : [];
    } else {
        targets = orders.filter((o) => resolveSiteFocalEmails(o).length > 0);
    }

    if (!targets.length) {
        return {
            ok: true,
            dryRun,
            sent: 0,
            skipped: orders.length,
            results: [],
            message: dryRun ? 'No site available for dry run' : 'No sites with focal emails configured',
        };
    }

    for (const so of targets) {
        const intendedTo = resolveSiteFocalEmails(so);
        const meta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
        const focalName = meta.focalName || meta.focal_name || null;
        const to = dryRun ? [...DRY_RUN_RECIPIENTS] : intendedTo;

        if (!to.length) {
            results.push({
                serviceOrderId: so.id,
                siteCode: so.site_code,
                siteName: so.name,
                skipped: true,
                reason: 'no_recipients',
            });
            continue;
        }

        const computed = await computeSoInvoice(pool, { serviceOrderId: so.id, month, year });
        const invoiceHtml = renderInvoiceHtml({ computed }, { format: 'invoice_letterhead' });
        const composed = composeVerificationEmail({
            siteName: so.name,
            siteCode: so.site_code,
            month,
            year,
            invoiceHtml,
            focalName,
            primaryEmail: intendedTo[0],
            dryRun,
            intendedTo,
        });

        if (!sendAppEmail) {
            results.push({
                serviceOrderId: so.id,
                siteCode: so.site_code,
                siteName: so.name,
                skipped: true,
                reason: 'no_mailer',
                subject: composed.subject,
                intendedTo,
                cc,
            });
            continue;
        }

        if (!dryRun && process.env.EMAILS_ENABLED === 'false') {
            results.push({
                serviceOrderId: so.id,
                siteCode: so.site_code,
                siteName: so.name,
                skipped: true,
                reason: 'emails_disabled',
                subject: composed.subject,
                intendedTo,
                cc,
            });
            continue;
        }

        if (!process.env.RESEND_API_KEY) {
            results.push({
                serviceOrderId: so.id,
                siteCode: so.site_code,
                siteName: so.name,
                skipped: true,
                reason: 'missing_key_or_recipients',
                subject: composed.subject,
                intendedTo,
                cc,
            });
            continue;
        }

        try {
            const send = await sendAppEmail({
                to,
                cc,
                subject: composed.subject,
                html: composed.html,
            });
            if (send?.skipped) {
                results.push({
                    serviceOrderId: so.id,
                    siteCode: so.site_code,
                    siteName: so.name,
                    skipped: true,
                    reason: send.reason || 'send_skipped',
                    send,
                    intendedTo,
                    cc,
                    subject: composed.subject,
                });
                continue;
            }
            results.push({
                serviceOrderId: so.id,
                siteCode: so.site_code,
                siteName: so.name,
                ok: true,
                dryRun,
                to,
                intendedTo,
                cc,
                subject: composed.subject,
                send,
            });
        } catch (err) {
            results.push({
                serviceOrderId: so.id,
                siteCode: so.site_code,
                siteName: so.name,
                ok: false,
                error: 'send_failed',
                intendedTo,
                cc,
                subject: composed.subject,
            });
        }

        if (dryRun) break;
    }

    const { sent, skipped, failed, message } = summarizeSendOutcome(results, dryRun);

    return {
        ok: failed === 0 && sent > 0,
        dryRun,
        contractId,
        contractFocal: {
            name: contract.client_focal_name,
            email: contract.client_focal_email,
        },
        sent,
        skipped,
        failed,
        message,
        results,
    };
}

module.exports = {
    ALLIED_CC,
    DRY_RUN_RECIPIENTS,
    monthYearLabel,
    parseEmailList,
    parseNameFromEmail,
    buildSalutation,
    composeVerificationEmail,
    resolveSiteFocalEmails,
    buildCcList,
    sendVerificationEmails,
};
