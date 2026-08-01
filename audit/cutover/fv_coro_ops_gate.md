# FV CORO staging / prod gate

**Status (2026-08-01):** Code + scripts ready. Live DB apply blocked in cloud agent — no `STAGING_DATABASE_URL` / `DATABASE_URL`.

## Offline verification (passed)

- CORO line sum **4,136,919.94**
- Punjab ST 16% → **661,907.19**
- Grand → **4,798,827.13** (`node scripts/smoke_coro_invoice.js`)
- Assign dry-run finds **64** CORO rows (`PSO CORO OPS - SS94 M.A`)
- Unit tests: `dateParse` + `serviceOrders` CORO fixtures green

## Staging apply (when credentials available)

```bash
cd backend && npm run migrate
# optional NZ re-sync (overwrites SO rates from JSON):
# curl -X POST .../api/fixed-value/contracts/CTR-PSO-NORTH-ZONE/resync-seed -d '{"confirm":true}'
node scripts/seed_pso_coro_ma.js
node scripts/assign_coro_employees.js --apply
psql "$STAGING_DATABASE_URL" -f scripts/fix_pso085_cnic_expiry.sql
# or one-shot:
STAGING_DATABASE_URL=... node scripts/run_fv_coro_staging_ops.js --apply
```

## Prod (after staging sign-off)

Same sequence against prod `DATABASE_URL`. Do **not** merge until staging invoice compute for July 2026 matches expected grand and 64 employees show `contract_id=CTR-PSO-CORO-MA`, `site=SS94`.
