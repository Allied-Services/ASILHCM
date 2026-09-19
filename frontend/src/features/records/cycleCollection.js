const COLLECTED = new Set(['ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL']);

export function collectedTypes(raw) {
    const list = Array.isArray(raw) ? raw : [];
    return [...new Set(list.map((t) => String(t || '').trim().toUpperCase()).filter((t) => COLLECTED.has(t)))];
}

export function deriveCycleCollection(enabledTypes) {
    const types = collectedTypes(enabledTypes);
    const hasAtt = types.includes('ATTENDANCE');
    const hasOt = types.includes('OT');
    const hasClaims = types.includes('EXPENSE') || types.includes('MEDICAL');

    if (hasClaims && hasAtt) {
        return {
            collection_mode: 'mixed',
            attendance_input_mode: 'absent_only',
            uses_portal: true,
            uses_file: true,
            include_ot: hasOt,
            file_headers: hasOt
                ? ['employee_id', 'name', 'absent_days', 'ot2', 'ot3']
                : ['employee_id', 'name', 'absent_days'],
            summary: 'Portal for expense/medical; attendance file is absent days'
                + (hasOt ? ' plus OT hours' : ''),
        };
    }
    if (hasClaims) {
        return {
            collection_mode: 'monthly_form',
            attendance_input_mode: 'full_ledger',
            uses_portal: true,
            uses_file: false,
            include_ot: hasOt,
            file_headers: [],
            summary: 'Monthly form (portal fill)',
        };
    }
    if (hasAtt && hasOt) {
        return {
            collection_mode: 'machine_file',
            attendance_input_mode: 'absent_only',
            uses_portal: false,
            uses_file: true,
            include_ot: true,
            file_headers: ['employee_id', 'name', 'absent_days', 'ot2', 'ot3'],
            summary: 'Machine file: absent days + OT',
        };
    }
    if (hasAtt) {
        return {
            collection_mode: 'machine_file',
            attendance_input_mode: 'absent_only',
            uses_portal: false,
            uses_file: true,
            include_ot: false,
            file_headers: ['employee_id', 'name', 'absent_days'],
            summary: 'Machine file: absent days only',
        };
    }
    if (hasOt) {
        return {
            collection_mode: 'machine_file',
            attendance_input_mode: 'absent_only',
            uses_portal: false,
            uses_file: true,
            include_ot: true,
            file_headers: ['employee_id', 'name', 'ot2', 'ot3'],
            summary: 'Machine file: OT hours',
        };
    }
    return {
        collection_mode: 'monthly_form',
        attendance_input_mode: 'full_ledger',
        uses_portal: false,
        uses_file: false,
        include_ot: false,
        file_headers: [],
        summary: 'No monthly inputs declared',
    };
}
