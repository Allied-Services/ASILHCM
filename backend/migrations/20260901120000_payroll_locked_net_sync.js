'use strict';

/**
 * Keep AP's frozen amount tied to the locked sheet.
 * After lock, GO RED / SQL patches were updating `net` and leaving `locked_net`
 * stale, so Accounts Payable showed a different total than Payroll.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        CREATE OR REPLACE FUNCTION sync_payroll_locked_net()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
            IF NEW.locked IS TRUE THEN
                NEW.locked_net := ROUND(COALESCE(NEW.net, 0));
            END IF;
            RETURN NEW;
        END;
        $fn$;
    `);
    pgm.sql(`
        DROP TRIGGER IF EXISTS trg_sync_payroll_locked_net ON payroll_transactions;
        CREATE TRIGGER trg_sync_payroll_locked_net
        BEFORE INSERT OR UPDATE OF net, locked, locked_net
        ON payroll_transactions
        FOR EACH ROW
        EXECUTE PROCEDURE sync_payroll_locked_net();
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_sync_payroll_locked_net ON payroll_transactions`);
    pgm.sql(`DROP FUNCTION IF EXISTS sync_payroll_locked_net()`);
};
