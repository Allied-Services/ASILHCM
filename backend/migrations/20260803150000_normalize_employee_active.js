'use strict';

/**
 * Normalize employees.active to canonical 'Yes' | 'No'.
 * Fixes YES/yes/true imports that showed INACTIVE in UI while backend treated them as active.
 */
exports.up = (pgm) => {
    pgm.sql(`
        UPDATE employees
        SET active = 'Yes', updated_at = NOW()
        WHERE active IS NOT NULL
          AND TRIM(active) <> ''
          AND LOWER(TRIM(active)) IN ('yes', 'true', '1', 'active')
          AND active <> 'Yes';

        UPDATE employees
        SET active = 'No', updated_at = NOW()
        WHERE active IS NOT NULL
          AND TRIM(active) <> ''
          AND LOWER(TRIM(active)) IN ('no', 'false', '0', 'inactive')
          AND active <> 'No';
    `);
};

exports.down = false;
