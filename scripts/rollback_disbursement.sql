-- Manual rollback for a World B disbursement batch.
-- ONLY valid BEFORE the bank payment file has been transmitted to the bank.
-- Do NOT use after funds have left the company account or if the batch was
-- reconciled in Xero / bank statements — reverse via finance adjustment instead.
--
-- Usage (replace placeholders):
--   \set batch_id 'PB-2026-06-HBLTestB-1234567890123'
--   \set source_run_id 42
--
-- Or run with psql -v batch_id='...' -v source_run_id=42 -f rollback_disbursement.sql

BEGIN;

DELETE FROM payment_ledger WHERE batch_id = :'batch_id';

DELETE FROM payment_batches WHERE id = :'batch_id';

UPDATE payroll_runs SET status = 'locked' WHERE id = :'source_run_id'::integer;

COMMIT;
