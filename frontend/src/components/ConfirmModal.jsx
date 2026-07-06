import React, { useEffect, useState } from 'react';

const ConfirmModal = ({
    open,
    title,
    body,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    showInput = false,
    inputLabel = '',
    inputPlaceholder = '',
    inputDefault = '',
    fields = null,
    onConfirm,
    onCancel,
    danger = false,
}) => {
    const [value, setValue] = useState(inputDefault);
    const [fieldValues, setFieldValues] = useState({});

    useEffect(() => {
        if (open) {
            setValue(inputDefault);
            if (fields) {
                const init = {};
                fields.forEach(f => { init[f.name] = f.default ?? ''; });
                setFieldValues(init);
            }
        }
    }, [open, inputDefault, fields]);

    if (!open) return null;

    const handleConfirm = () => {
        if (fields) onConfirm(fieldValues);
        else if (showInput) onConfirm(value);
        else onConfirm();
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
            <div className="glass-card" style={{ maxWidth: 440, width: '100%' }}>
                <h3 style={{ marginTop: 0 }}>{title}</h3>
                {body && <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{body}</p>}
                {showInput && (
                    <label style={{ display: 'block', marginBottom: '1rem' }}>
                        {inputLabel}
                        <input
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            placeholder={inputPlaceholder}
                            style={{ width: '100%', marginTop: 6, background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }}
                        />
                    </label>
                )}
                {fields && fields.map(f => (
                    <label key={f.name} style={{ display: 'block', marginBottom: '0.75rem' }}>
                        {f.label}
                        <input
                            type={f.type || 'text'}
                            value={fieldValues[f.name] ?? ''}
                            onChange={e => setFieldValues(v => ({ ...v, [f.name]: e.target.value }))}
                            style={{ width: '100%', marginTop: 6, background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }}
                        />
                    </label>
                ))}
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
                    <button type="button" className={danger ? 'btn-secondary' : 'btn-primary'} onClick={handleConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
