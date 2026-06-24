#!/usr/bin/env node
/**
 * gmail-auth-setup.js — One-time OAuth2 token generator for Wafi Claims Service
 *
 * Run ONCE locally to generate a refresh token:
 *   node gmail-auth-setup.js
 *
 * Then copy the printed refresh_token into your .env (Render environment):
 *   GMAIL_REFRESH_TOKEN=<your_token>
 *
 * Requires:
 *   GMAIL_CLIENT_ID     — from Google Cloud Console OAuth2 client
 *   GMAIL_CLIENT_SECRET — from Google Cloud Console OAuth2 client
 *
 * These can be set as environment variables before running, or the script
 * will prompt you to enter them interactively.
 */

'use strict';

const readline = require('readline');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

function prompt(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n' + '═'.repeat(60));
    console.log('  ASIL HCM — Gmail OAuth2 Setup for Wafi Claims Service');
    console.log('═'.repeat(60));
    console.log('\nThis script generates a Gmail OAuth2 refresh token that allows');
    console.log('the ASIL HCM backend to read and label emails at claims@asil.com.pk\n');

    console.log('Prerequisites:');
    console.log('  1. Go to: https://console.cloud.google.com/');
    console.log('  2. Create or select a project');
    console.log('  3. Enable the Gmail API');
    console.log('  4. Create OAuth2 credentials → Desktop App');
    console.log('  5. Paste the Client ID and Secret below\n');
    console.log('─'.repeat(60) + '\n');

    // Get credentials
    let clientId = process.env.GMAIL_CLIENT_ID;
    let clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!clientId) {
        clientId = (await prompt(rl, 'Enter your GMAIL_CLIENT_ID: ')).trim();
    } else {
        console.log(`Using GMAIL_CLIENT_ID from environment: ${clientId.slice(0, 12)}...`);
    }

    if (!clientSecret) {
        clientSecret = (await prompt(rl, 'Enter your GMAIL_CLIENT_SECRET: ')).trim();
    } else {
        console.log(`Using GMAIL_CLIENT_SECRET from environment: ${clientSecret.slice(0, 8)}...`);
    }

    if (!clientId || !clientSecret) {
        console.error('\n❌ Client ID and Secret are required. Aborting.\n');
        rl.close();
        process.exit(1);
    }

    // Create OAuth2 client
    const auth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

    // Generate authorization URL
    const authUrl = auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // Force refresh_token to be returned
        scope: SCOPES,
    });

    console.log('\n' + '─'.repeat(60));
    console.log('Step 1: Open this URL in your browser (while signed in as claims@asil.com.pk):');
    console.log('\n' + authUrl + '\n');
    console.log('─'.repeat(60));
    console.log('\nStep 2: Google will show a consent screen → click Allow');
    console.log('Step 3: Copy the authorization code Google shows you\n');

    const code = (await prompt(rl, 'Enter the authorization code here: ')).trim();

    if (!code) {
        console.error('\n❌ No code entered. Aborting.\n');
        rl.close();
        process.exit(1);
    }

    console.log('\nExchanging code for tokens...\n');

    try {
        const { tokens } = await auth.getToken(code);

        if (!tokens.refresh_token) {
            console.error('❌ No refresh_token returned.');
            console.error('   This usually means the account already authorized this app.');
            console.error('   Fix: Revoke access at https://myaccount.google.com/permissions');
            console.error('   Then run this script again.\n');
            rl.close();
            process.exit(1);
        }

        console.log('═'.repeat(60));
        console.log('✅  SUCCESS! Add these to your Render environment variables:\n');
        console.log(`  GMAIL_CLIENT_ID     = ${clientId}`);
        console.log(`  GMAIL_CLIENT_SECRET = ${clientSecret}`);
        console.log(`  GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
        console.log(`  GMAIL_USER          = claims@asil.com.pk`);
        console.log('');
        console.log('  Optional (for email sending)');
        console.log('  EMAILS_ENABLED      = true');
        console.log('  RESEND_API_KEY      = re_...');
        console.log('  SMTP_FROM           = ASIL HR <hr@asil.com.pk>');
        console.log('═'.repeat(60) + '\n');

        if (tokens.access_token) {
            console.log(`(Access token also received — expires in: ${Math.round((tokens.expiry_date - Date.now()) / 60000)} minutes)`);
            console.log('(Only the refresh_token above is needed for the server.)\n');
        }

    } catch (err) {
        console.error('\n❌ Token exchange failed:', err.message);
        if (err.response?.data) {
            console.error('   Details:', JSON.stringify(err.response.data, null, 2));
        }
        console.error('\nCommon causes:');
        console.error('  • Authorization code already used (each code works once)');
        console.error('  • Wrong client credentials (ID/Secret mismatch)');
        console.error('  • Code expired (they expire after a few minutes)\n');
        rl.close();
        process.exit(1);
    }

    rl.close();
}

main().catch(err => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
});
