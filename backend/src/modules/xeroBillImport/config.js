'use strict';

const DEFAULT_XERO_SITE_ACCOUNTS = {
    'FM-101': 'Aviation EJHD',
    'FM-102': 'Aviation ITP',
    'FM-103': 'Aviation Quetta',
    'FM-104': 'Aviation Sukkur',
    'FM-105': 'Aviation Nawabshah',
    'FM-106': 'Bhakkar',
    'FM-107': 'Chaklala',
    'FM-108': 'Daulatpur',
    'FM-109': 'Ghatti',
    'FM-110': 'Keamari',
    'FM-111': 'Mehmood Kot',
    'FM-112': 'Machike',
    'FM-113': 'Shershah',
    'FM-114': 'Shikarpur',
    'FM-115': 'Tarujabba',
    'FM-117': 'Vehari',
    'FM-118': 'LOBP',
    'FM-119': 'Shell-Procurement',
};

const DEFAULT_HBL_EXPORT_COLUMNS = {
    hbl_same: [
        'Beneficiary\u00a0Name',
        'Beneficiary Account Number',
        'Transaction Amount',
        'Customer Reference Number',
        'Contact Number',
        'Beneficiary Email Address',
        'Purpose of Payment',
        'Inovice Number',
        'Account Title',
    ],
    hbl_other: [
        'Beneficiary Name',
        'Beneficiary Account Number',
        'Transaction Amount',
        'Customer Reference No',
        'Bank Code',
        'Beneficary Contact No',
        'Beneficiary Email Address',
        'Pupose of Payment',
        'Reference # 3',
        'Invoice Number',
        'Account Title',
    ],
};

const DEFAULT_XERO_CLEARING_ACCOUNTS = {
    incomeTaxWht: '626',
    salesTaxWithheld: '627',
};

const OWNED_TRACKING_OPTIONS = new Set(['BPO', 'FM', 'Wafi Procurement']);

module.exports = {
    DEFAULT_XERO_SITE_ACCOUNTS,
    DEFAULT_HBL_EXPORT_COLUMNS,
    DEFAULT_XERO_CLEARING_ACCOUNTS,
    OWNED_TRACKING_OPTIONS,
};
