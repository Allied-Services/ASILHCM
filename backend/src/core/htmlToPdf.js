'use strict';

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

async function resolveExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.platform === 'linux') {
        chromium.setGraphicsMode = false;
        return chromium.executablePath();
    }
    return null;
}

/**
 * Render HTML string to a PDF buffer (A4, print backgrounds).
 * Returns null when no Chromium binary is available (local dev without Chrome path).
 */
async function htmlToPdf(html, { timeoutMs = 45000 } = {}) {
    const executablePath = await resolveExecutablePath();
    if (!executablePath) {
        console.warn('[htmlToPdf] No Chromium executable — set PUPPETEER_EXECUTABLE_PATH or run on Linux/Render');
        return null;
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: chromium.headless ?? true,
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });
        return Buffer.from(pdf);
    } catch (err) {
        console.error('[htmlToPdf]', err);
        throw err;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

module.exports = { htmlToPdf, resolveExecutablePath };
