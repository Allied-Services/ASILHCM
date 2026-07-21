/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.addColumn('portal_claim_attachments', {
        category: { type: 'text', default: 'other' },
    });
    pgm.createIndex('portal_claim_attachments', ['submission_id', 'category']);
};

exports.down = (pgm) => {
    pgm.dropIndex('portal_claim_attachments', ['submission_id', 'category']);
    pgm.dropColumn('portal_claim_attachments', 'category');
};
