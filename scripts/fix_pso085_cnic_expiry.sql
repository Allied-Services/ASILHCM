-- Fix ASIL/PSO-085/25 CNIC expiry (16-Aug-32 → 2032-08-16).
-- DOB remains 1993-03-15 from master roster; do not set DOB to 1932.
-- Apply on staging first, then production after sign-off.

UPDATE employees
SET cnic_expiry = '2032-08-16'
WHERE id = 'ASIL/PSO-085/25';

-- Verify
SELECT id, name, dob, cnic_issue, cnic_expiry
FROM employees
WHERE id = 'ASIL/PSO-085/25';
