'use strict';

const { normalizeEnabledTypes, normalizeCollectionMode } = require('./claimsPolicy');

const TYPE_LABELS = {
    ATTENDANCE: 'Attendance',
    OT: 'Overtime',
    EXPENSE: 'Expense Reimbursement',
    MEDICAL: 'Medical reimbursement',
};

function fillExperienceFromPack(pack = {}) {
    const enabledTypes = normalizeEnabledTypes(pack.enabled_types || pack.enabledTypes);
    const collectionMode = normalizeCollectionMode(pack.collection_mode || pack.collectionMode);
    const fileOnly = collectionMode === 'machine_file';
    const typeLabels = enabledTypes.map((t) => TYPE_LABELS[t] || t);
    return {
        enabledTypes,
        collectionMode,
        fileOnly,
        showOnScreen: !fileOnly,
        typeLabels,
        typeList: typeLabels.join(', '),
        hasAttendance: enabledTypes.includes('ATTENDANCE'),
        hasOt: enabledTypes.includes('OT'),
        hasExpense: enabledTypes.includes('EXPENSE'),
        hasMedical: enabledTypes.includes('MEDICAL'),
    };
}

function inviteHowToHtml(experience, { fillCloseDay } = {}) {
    const types = experience.typeList || 'the claim types enabled on this contract';
    const close = fillCloseDay != null ? ` (by day ${fillCloseDay})` : '';
    if (experience.fileOnly) {
        const supports = (experience.hasExpense || experience.hasMedical)
            ? `<li>If the file has Expense or Medical amounts, upload those support files before submit.</li>`
            : '';
        return `<ol style="margin:0 0 16px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">
      <li>Open the secure page (no password — this link is personal to you).</li>
      <li>Download <em>your</em> file — employee codes and names are already filled.</li>
      <li>Complete the sheets for <strong>${types}</strong> only, then upload the same file${close}.</li>
      ${supports}
      <li>If there is nothing to claim for an employee, tap <strong>Confirm No Claims</strong>.</li>
      <li>Submit — your Line Manager will review where this contract requires it.</li>
    </ol>`;
    }
    const optionB = experience.showOnScreen
        ? `<br/><strong>Option B:</strong> Enter ${types} on screen for each employee.`
        : '';
    const supports = (experience.hasExpense || experience.hasMedical)
        ? `<li>Upload support files if you claimed Expense or Medical.</li>`
        : '';
    return `<ol style="margin:0 0 16px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">
      <li>Open the secure form (no password — this link is personal to you).</li>
      <li><strong>Option A:</strong> Download <em>your</em> Excel (Code/Name already filled), complete ${types} columns only, and upload it.${optionB}</li>
      ${supports}
      <li>If there is nothing to claim for an employee, tap <strong>Confirm No Claims</strong>.</li>
      <li>Submit — your Line Manager will review where this contract requires it.</li>
    </ol>`;
}

function inviteWhyHtml(experience) {
    const types = experience.typeList || 'monthly claims';
    return `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#475569">
      We collect <strong>${types}</strong> for this contract in one place so payroll is not delayed by missing or mismatched files.
    </p>`;
}

module.exports = {
    fillExperienceFromPack,
    inviteHowToHtml,
    inviteWhyHtml,
    TYPE_LABELS,
};
