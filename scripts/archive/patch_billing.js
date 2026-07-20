const fs = require('fs');
const file = 'G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx';
let src = fs.readFileSync(file, 'utf8');

const FIND = '                    {/* Xero stub — visible to approvers when Approved */}';

const NEW_SECTION = `                    {/* Create Invoice — for billable bill types with a client assigned */}\r\n                    {['Debit Note / Imprest', 'Client Procurement', 'Contractual Purchasing'].includes(bill.billType) && bill.billable !== false && bill.client && (\r\n                        <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.28)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>\r\n                            <div style={{ fontSize: '0.83rem' }}>\r\n                                <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: '2px' }}>🧾 Ready to Invoice</div>\r\n                                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Billable {bill.billType} for <strong>{bill.client}</strong>. Auto-create a draft client invoice from this bill.</div>\r\n                            </div>\r\n                            <button onClick={() => { onCreateInvoice && onCreateInvoice(bill); onClose(); }}\r\n                                style={{ background: '#22c55e', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>\r\n                                🧾 Create Invoice\r\n                            </button>\r\n                        </div>\r\n                    )}\r\n\r\n                    {/* Xero stub — visible to approvers when Approved */}`;

if (!src.includes(FIND)) {
    console.error('FAIL: Xero stub marker not found');
    process.exit(1);
}
if (src.includes('Create Invoice — for billable bill types')) {
    console.log('SKIP: Create Invoice section already exists');
    process.exit(0);
}
src = src.replace(FIND, NEW_SECTION);
fs.writeFileSync(file, src, 'utf8');
console.log('OK: Create Invoice section added to BillDetailModal');
