# ASIL HCM — Staging Environment Setup (MD Checklist)

**Created:** S0B remediation session (2026-07-24)  
**Purpose:** End the era where every `git push main` deploys straight to production.

Staging = **git branch `staging`** + **Neon DB branch `staging`** + **two Render services** (backend + frontend). A separate Neon branch `ci-test` is for integration tests (S2A+).

---

## 1. Neon database branches

### 1a. Create `staging` branch

1. Open [Neon Console](https://console.neon.tech) → select the ASIL HCM project (`ep-dry-shadow-ad443mnl`).
2. **Branches** → **Create branch**.
3. Name: `staging`
4. Parent: `production` (main)
5. Copy the **connection string** (pooled). Store in your password manager — **never commit it**.

### 1b. Create `ci-test` branch

Repeat with name `ci-test`, parent `production`. Used by `npm run test:int` in CI/local integration tests.

### 1c. Seed `staging` with realistic data

From a machine with `pg_restore` and the S0A backup (`backups/prod_20260724_041440.dump`):

```powershell
$env:Path = "C:\Program Files\PostgreSQL\18\bin;" + $env:Path
$env:STAGING_URL = "<paste Neon staging branch DATABASE_URL>"
pg_restore --clean --if-exists -d $env:STAGING_URL --no-owner --no-privileges "backups/prod_20260724_041440.dump"
psql $env:STAGING_URL -c "SELECT COUNT(*) FROM employees;"
# Expected: 682 (prod parity; see audit/groundtruth/facts.md §7 for caveats)
```

If no local backup exists, re-run `scripts/backup_prod.ps1` with production `DATABASE_URL` first.

**Optional:** Neon branch create from console already clones prod; the restore step ensures the backup file is validated end-to-end.

---

## 2. Git branch

```powershell
git checkout staging
git push -u origin staging
```

Remediation commits land on `staging` first. Merge to `main` only after staging verification.

---

## 3. Render services

Reference: root `render.yaml` (four services documented).

### 3a. Backend — `asil-hcm-staging`

1. Render Dashboard → **New** → **Web Service**.
2. Connect repo `shezad/ASILHCM`, branch **`staging`**, root directory **`backend`**.
3. Build: `npm ci` | Start: `npm start` | Plan: **Free** | Region: **Singapore**.
4. Health check path: `/health`
5. Environment variables — copy from production `asilhcm` **except**:

| Variable | Staging value |
|---|---|
| `DATABASE_URL` | Neon **`staging`** branch connection string |
| `FRONTEND_URL` | `https://asil-hcm-frontend-staging.onrender.com` |
| `BACKEND_URL` | `https://asil-hcm-staging.onrender.com` |
| `APP_BASE_URL` | `https://asil-hcm-staging.onrender.com` |
| `JOBS_RUNNER` | `web` |
| `EMAILS_ENABLED` | `false` |

**Leave UNSET** (staging must not contact real employees or Xero):

- `RESEND_API_KEY` (optional — email routes skip send when unset; boot no longer requires a placeholder)
- All `JAZZ_*`
- All `GMAIL_*` / `CLAIMS_EMAIL_*`
- All `INTAKE_EMAIL_*`
- All `XERO_*`
- `OPENAI_API_KEY` (optional — OCR returns 503 without it)

Copy `JWT_SECRET`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from prod (or use staging-specific OAuth client — see §4).

### 3b. Frontend — `asil-hcm-frontend-staging`

1. **New** → **Static Site**, branch **`staging`**, root **`frontend`**.
2. Build: `npm ci && npm run build` | Publish: `dist`
3. Add SPA rewrite: `/*` → `/index.html` (see `frontend/render.spa.yaml`).
4. Env: `VITE_API_URL=https://asil-hcm-staging.onrender.com`

---

## 4. Google OAuth (required for UI login)

1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → your OAuth 2.0 client.
2. **Authorized JavaScript origins** — add:
   - `https://asil-hcm-frontend-staging.onrender.com`
   - `https://asil-hcm-staging.onrender.com`
3. **Authorized redirect URIs** — add:
   - `https://asil-hcm-staging.onrender.com/auth/google/callback`

If OAuth is not updated, verify staging via API with a JWT from prod login against staging backend (not recommended for routine use).

---

## 5. Verification (after deploy)

```powershell
Invoke-RestMethod https://asil-hcm-staging.onrender.com/health
# Expected: status OK / HTTP 200

# Isolation test (requires staging JWT):
# POST a throwaway vendor via staging API, confirm row exists in staging DB only, then DELETE.
```

---

## 6. Rollback

- Delete Render services `asil-hcm-staging` and `asil-hcm-frontend-staging`.
- Delete Neon branches `staging` and `ci-test`.
- Production is untouched.

---

## 7. CI-test branch URL (for developers)

Store `ci-test` connection string as a GitHub Actions secret `DATABASE_URL_TEST` when S2A harness lands. Never use production URL in CI.
