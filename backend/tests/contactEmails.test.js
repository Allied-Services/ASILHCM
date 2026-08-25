'use strict';

const {
    isUsableEmail,
    isPersonalEmail,
    isWorkEmail,
    isClaimsWorkMailbox,
    SADIA_SETUP_EMAIL,
    resolveFocalEmail,
    resolvePayslipRecipients,
    resolveClaimsEmployeeFillerEmail,
    hasPayslipEmailChannel,
} = require('../src/modules/employees/contactEmails');

describe('contactEmails', () => {
    test('isUsableEmail rejects placeholders', () => {
        expect(isUsableEmail('N/A')).toBe('');
        expect(isUsableEmail('-')).toBe('');
        expect(isUsableEmail('none')).toBe('');
        expect(isUsableEmail('a@wafi-energy.com')).toBe('a@wafi-energy.com');
    });

    test('personal domains are not work mailboxes', () => {
        expect(isPersonalEmail('emp@gmail.com')).toBe(true);
        expect(isPersonalEmail('emp@yahoo.com')).toBe(true);
        expect(isWorkEmail('emp@gmail.com')).toBe('');
        expect(isWorkEmail('emp@wafi-energy.com')).toBe('emp@wafi-energy.com');
    });

    test('payslip goes to employee and focal', () => {
        expect(resolvePayslipRecipients({
            email: 'emp@gmail.com',
            claim_authority: 'focal@wafi-energy.com',
        })).toEqual(['emp@gmail.com', 'focal@wafi-energy.com']);
    });

    test('payslip is focal only when the employee has no email', () => {
        expect(resolvePayslipRecipients({
            email: 'N/A',
            claim_authority: 'focal@wafi-energy.com',
        })).toEqual(['focal@wafi-energy.com']);
        expect(hasPayslipEmailChannel({ email: '-', claim_authority: 'focal@wafi-energy.com' })).toBe(true);
        expect(hasPayslipEmailChannel({ email: '', claim_authority: 'SELF' })).toBe(false);
    });

    test('payslip destEmail override wins', () => {
        expect(resolvePayslipRecipients({
            email: 'emp@gmail.com',
            claim_authority: 'focal@wafi-energy.com',
        }, 'qa@asil.com.pk')).toEqual(['qa@asil.com.pk']);
    });

    test('claims filler never uses a personal mailbox', () => {
        expect(resolveClaimsEmployeeFillerEmail({ email: 'emp@gmail.com' })).toBe('');
        expect(resolveClaimsEmployeeFillerEmail({ email: 'emp@wafi-energy.com' })).toBe('emp@wafi-energy.com');
        expect(resolveClaimsEmployeeFillerEmail({ email: 'iman.akbar@asil.com.pk' })).toBe('iman.akbar@asil.com.pk');
        expect(isClaimsWorkMailbox('emp@company.com')).toBe('');
        expect(SADIA_SETUP_EMAIL).toBe('sadia.komal@asil.com.pk');
        expect(resolveFocalEmail({ claim_authority: 'N/A' })).toBe('');
        expect(resolveFocalEmail({ claim_authority: 'focal@wafi-energy.com' })).toBe('focal@wafi-energy.com');
    });
});
