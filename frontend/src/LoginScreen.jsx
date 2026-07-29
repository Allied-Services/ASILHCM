import React from 'react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

export default function LoginScreen({ error }) {
    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            padding: '24px',
        }}>
            {/* Glow effect */}
            <div style={{
                position: 'absolute',
                width: '500px', height: '500px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
                pointerEvents: 'none',
            }} />

            {/* Card */}
            <div style={{
                background: 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '24px',
                padding: '56px 48px',
                maxWidth: '420px',
                width: '100%',
                textAlign: 'center',
                position: 'relative',
                boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
            }}>
                {/* Logo */}
                <img
                    src="/asil-logo.png"
                    alt="ASIL"
                    style={{ height: '64px', objectFit: 'contain', marginBottom: '28px' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                />

                <h1 style={{
                    color: '#f1f5f9',
                    fontSize: '1.6rem',
                    fontWeight: 700,
                    margin: '0 0 6px 0',
                    letterSpacing: '-0.5px',
                }}>
                    ASIL HCM System
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0 0 40px 0' }}>
                    Allied Services International (Pvt.) Ltd.
                </p>

                {/* Error message */}
                {error === 'unauthorized_domain' && (
                    <div style={{
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '10px',
                        padding: '12px 16px',
                        marginBottom: '24px',
                        color: '#fca5a5',
                        fontSize: '0.85rem',
                    }}>
                        ⛔ Access restricted to <strong>@asil.com.pk</strong> accounts only.
                    </div>
                )}
                {error === 'server_slow' && (
                    <div style={{
                        background: 'rgba(245,158,11,0.1)',
                        border: '1px solid rgba(245,158,11,0.35)',
                        borderRadius: '10px',
                        padding: '12px 16px',
                        marginBottom: '24px',
                        color: '#fcd34d',
                        fontSize: '0.85rem',
                        lineHeight: 1.45,
                    }}>
                        Server slow to wake — try Sign in again in a minute.
                    </div>
                )}

                {/* Google Sign-In Button */}
                <a
                    href={`${API}/auth/google`}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px',
                        background: '#ffffff',
                        color: '#1f2937',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '14px 24px',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textDecoration: 'none',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                        width: '100%',
                        boxSizing: 'border-box',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
                    }}
                >
                    {/* Google SVG */}
                    <svg width="20" height="20" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                    Sign in with Google
                </a>

                <p style={{ color: '#475569', fontSize: '0.78rem', marginTop: '28px', lineHeight: 1.5 }}>
                    Only <strong style={{ color: '#64748b' }}>@asil.com.pk</strong> Google Workspace accounts are permitted.
                    Contact IT if you need access.
                </p>
            </div>

            <p style={{ color: '#334155', fontSize: '0.75rem', marginTop: '32px' }}>
                ASIL HCM · Allied Services International · 2026
            </p>
        </div>
    );
}
