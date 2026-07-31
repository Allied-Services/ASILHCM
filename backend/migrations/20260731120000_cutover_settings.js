'use strict';

/** P0 — July 2026 soft cutover config seeds */
exports.up = (pgm) => {
    pgm.sql(`
        INSERT INTO system_config (key, value) VALUES
            ('cutover_period', '{"month":7,"year":2026}'::jsonb),
            ('show_pre_cutover_archive', 'false'::jsonb)
        ON CONFLICT (key) DO NOTHING;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DELETE FROM system_config WHERE key IN ('cutover_period', 'show_pre_cutover_archive');`);
};
