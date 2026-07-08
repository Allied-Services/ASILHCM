#!/usr/bin/env python3
"""Production Xero smoke (read-only sync + counts). Stdlib urllib only."""
from __future__ import annotations
import json, os, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get('ASIL_HCM_BASE', 'https://asilhcm.onrender.com')
JWT_PATH = os.environ.get('ASIL_HCM_JWT', r'C:\\temp\\hcm_jwt.txt')
WAFI_CLIENT = 'Wafi Energy Pakistan Pvt Ltd'


class ApiError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f'HTTP {status}: {body[:500]}')
        self.status = status
        self.body = body


def api(method: str, path: str, token: str, body=None):
    url = BASE.rstrip('/') + path
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json'}
    data = json.dumps(body).encode() if body is not None else None
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode(errors='replace')) from e


def main() -> int:
    token = open(JWT_PATH, encoding='utf-8').read().strip()
    now = datetime.now(timezone.utc)
    modified_since = (now - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ')
    month, year = now.month, now.year

    print('=== production_smoke_xero ===', flush=True)
    print('base', BASE, flush=True)
    try:
        me = api('GET', '/auth/me', token)
        print('auth', me.get('user', {}).get('email'), flush=True)
    except ApiError as e:
        print('FAIL auth', e, flush=True)
        return 1

    health = api('GET', '/health', token)
    print('health', health, flush=True)

    xero_status = api('GET', '/api/xero/status', token)
    print('xero_status', json.dumps(xero_status, sort_keys=True), flush=True)

    sync = api('POST', '/api/xero/bills/sync', token, {'modifiedSince': modified_since})
    print('sync', json.dumps(sync, sort_keys=True), flush=True)

    review = api('GET', '/api/xero/bills/review-queue', token)
    bills = review.get('bills') or []
    print('review_queue_count', len(bills), flush=True)

    q = urllib.parse.urlencode({
        'client': WAFI_CLIENT,
        'period_month': month,
        'period_year': year,
    })
    billable = api('GET', f'/api/client-invoices/billable-candidates?{q}', token)
    cand = billable.get('bills') or []
    print('billable_candidates_count', len(cand), flush=True)
    print('billable_period', f'{year}-{month:02d}', flush=True)

    print('PASS production_smoke_xero (no invoice/receipt/xero AR push)', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
