'use strict';

const { google } = require('googleapis');
const { parseConservancyWorkbook } = require('./attendanceParse');

const DEFAULT_FOLDER_ID = process.env.DRIVE_ATTENDANCE_FOLDER_ID || '1G6OaJf4k7JN5pJVcZuN7ZddLmWcNwnSp';

function createDriveClient() {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (saJson) {
        let creds;
        try {
            creds = JSON.parse(saJson);
        } catch {
            return { client: null, reason: 'invalid_service_account_json' };
        }
        const auth = new google.auth.GoogleAuth({
            credentials: creds,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        return { client: google.drive({ version: 'v3', auth }), reason: null };
    }

    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (clientId && clientSecret && refreshToken) {
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
        oauth2.setCredentials({ refresh_token: refreshToken });
        return { client: google.drive({ version: 'v3', auth: oauth2 }), reason: null };
    }

    return { client: null, reason: 'missing_drive_credentials' };
}

function normalizeToken(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Site-specific filename tokens. Never use generic words (DEPOT, INST) — they collide across files. */
const SITE_FILE_ALIASES = {
    MORGAH: ['MORGAH'],
    CHAKPIRANA: ['CHAKPIRANA', 'CHAKPIR'],
    SIHALA: ['SIHALA'],
    FAQIRABAD: ['FAQIRABAD', 'FAQIR'],
    JUGLOT: ['JUGLOT'],
    CHITRAL: ['CHITRAL'],
    TARUJABBA: ['TARUJABBA', 'TARRUJABBA', 'TARRU', 'JABBA'],
    SERAINOURANG: ['SERAINOURANG', 'SERAINAURANG', 'NAURANG', 'SERAI'],
    KOHAT: ['KOHAT'],
    KUNDIAN: ['KUNDIAN'],
    DGM_OPS: ['DGMOPS', 'DGM'],
    PR_FUELING: ['PRFUELING', 'PRFUEL', 'FUELING'],
};

/** Longer token wins so CHAKPIRANA beats CHAKPIR, etc. */
function scoreFileForSite(fileName, siteCode) {
    const name = normalizeToken(fileName);
    const site = normalizeToken(siteCode);
    if (!name || !site) return 0;
    const tokens = SITE_FILE_ALIASES[siteCode] || [siteCode];
    let best = 0;
    for (const raw of tokens) {
        const t = normalizeToken(raw);
        if (t && name.includes(t) && t.length > best) best = t.length;
    }
    if (name.includes(site) && site.length > best) best = site.length;
    return best;
}

function matchFileToSite(fileName, siteCode) {
    return scoreFileForSite(fileName, siteCode) > 0;
}

function pickBestFileForSite(files, siteCode) {
    let best = null;
    let bestScore = 0;
    for (const f of files || []) {
        const score = scoreFileForSite(f.name, siteCode);
        if (score > bestScore) {
            bestScore = score;
            best = f;
        }
    }
    return best;
}

async function listDriveAttendanceFiles(folderId = DEFAULT_FOLDER_ID) {
    const { client, reason } = createDriveClient();
    if (!client) {
        return { ok: false, code: reason, files: [] };
    }
    const q = `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel')`;
    const res = await client.files.list({
        q,
        fields: 'files(id,name,mimeType,modifiedTime)',
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });
    return { ok: true, files: res.data.files || [] };
}

async function downloadDriveFile(fileId) {
    const { client, reason } = createDriveClient();
    if (!client) return { ok: false, code: reason, buffer: null };
    const res = await client.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return { ok: true, buffer: Buffer.from(res.data) };
}

async function pullAttendanceForSite({ siteCode, month, year, folderId } = {}) {
    const listing = await listDriveAttendanceFiles(folderId);
    if (!listing.ok) return { ok: false, code: listing.code, matched: null, parse: null };

    const matched = pickBestFileForSite(listing.files || [], siteCode);
    if (!matched) {
        return {
            ok: false,
            code: 'NO_MATCHING_FILE',
            siteCode,
            available: listing.files.map(f => f.name),
            matched: null,
            parse: null,
        };
    }

    const dl = await downloadDriveFile(matched.id);
    if (!dl.ok) return { ok: false, code: dl.code, matched, parse: null };

    const parse = parseConservancyWorkbook(dl.buffer, { month, year });
    return { ok: parse.ok, code: parse.ok ? null : 'PARSE_FAILED', matched, parse, fileName: matched.name };
}

module.exports = {
    DEFAULT_FOLDER_ID,
    createDriveClient,
    SITE_FILE_ALIASES,
    scoreFileForSite,
    matchFileToSite,
    pickBestFileForSite,
    listDriveAttendanceFiles,
    downloadDriveFile,
    pullAttendanceForSite,
};
