import {
  normalizeBdPhone,
  normalizeBoId,
  normalizeEmail,
  normalizeFolio,
  type ImportFieldKey,
  type ImportMode,
} from '@irm/shared';
import type { ParsedSheet } from './parse.js';

/** Current register state needed to classify each row. Loaded once per validation. */
export interface ExistingIdentity {
  identityId: string;
  shareholderId: string;
  shareholderName: string;
  holderType: 'INDIVIDUAL' | 'CORPORATE';
  /** Current holdings by share class code. */
  holdings: Map<string, { holdingId: string; quantity: bigint }>;
}

export interface RegisterState {
  identities: Map<string, ExistingIdentity>; // key "BO:1201..." or "FOLIO:F-1"
  corporateByName: Map<string, string>; // normalised name -> shareholderId
  shareClassCodes: Set<string>;
}

export interface NormalizedRow {
  kind: 'BO' | 'FOLIO';
  value: string;
  name: string;
  nameBn: string | null;
  holderType: 'INDIVIDUAL' | 'CORPORATE';
  shareClass: string;
  shares: string;
  phone: string | null;
  email: string | null;
  warnings: string[];
  existing: { identityId: string; shareholderId: string; holdingId: string | null; previousShares: string | null } | null;
  /** For new identities of corporate holders: link to this shareholder id, or group by name. */
  linkShareholderId: string | null;
  groupKey: string | null;
  nameChanged: boolean;
}

export interface RowResult {
  rowNumber: number;
  raw: Record<string, string>;
  status: 'VALID' | 'ERROR';
  action: 'NEW' | 'CHANGED' | 'UNCHANGED' | 'NONE';
  errors: string[];
  normalized: NormalizedRow | null;
}

export interface ClosedHolding {
  holdingId: string;
  identityKey: string;
  shareClass: string;
  shareholderName: string;
  previousShares: string;
}

export interface ValidationResult {
  rows: RowResult[];
  closed: ClosedHolding[];
  summary: { new: number; changed: number; unchanged: number; closed: number };
  validRows: number;
  errorRows: number;
  /** Share classes referenced that do not exist yet. Only ORD is created automatically. */
  autoCreateClasses: string[];
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function parseHolderType(raw: string): 'INDIVIDUAL' | 'CORPORATE' | null {
  const v = raw.trim().toLowerCase();
  if (v === '' || ['individual', 'ind', 'i', 'person', 'natural'].includes(v)) return 'INDIVIDUAL';
  if (['corporate', 'corp', 'c', 'company', 'institution', 'institutional', 'organisation', 'organization'].includes(v)) return 'CORPORATE';
  return null;
}

function parseShares(raw: string): bigint | null {
  const v = raw.replace(/[,\s]/g, '');
  if (!/^\d{1,18}(\.0+)?$/.test(v)) return null;
  return BigInt(v.split('.')[0]!);
}

/**
 * Pure classification of every row against the current register. No I/O, so it is
 * unit-testable and deterministic: the same file, mapping and state give the same result.
 */
export function validateRegister(
  sheet: ParsedSheet,
  mapping: Partial<Record<ImportFieldKey, string>>,
  mode: ImportMode,
  state: RegisterState,
): ValidationResult {
  const col = (f: ImportFieldKey) => (mapping[f] ? sheet.headers.indexOf(mapping[f]!) : -1);
  const idx = Object.fromEntries(
    (['boId', 'folio', 'name', 'nameBn', 'holderType', 'shareClass', 'shares', 'phone', 'email'] as const).map((f) => [f, col(f)]),
  ) as Record<ImportFieldKey, number>;
  const get = (r: string[], f: ImportFieldKey) => (idx[f] >= 0 ? (r[idx[f]] ?? '').trim() : '');

  const seen = new Map<string, number>(); // "identityKey|class" -> first row number
  const errorIdentities = new Set<string>();
  const autoCreate = new Set<string>();
  const rows: RowResult[] = [];

  sheet.rows.forEach((r, i) => {
    const rowNumber = i + 2; // header is row 1
    const raw = Object.fromEntries(sheet.headers.map((h, c) => [h, r[c] ?? '']));
    const errors: string[] = [];
    const warnings: string[] = [];

    // Identifier
    let kind: 'BO' | 'FOLIO' | null = null;
    let value: string | null = null;
    const boRaw = get(r, 'boId');
    const folioRaw = get(r, 'folio');
    if (boRaw) {
      if (idx.boId >= 0 && sheet.lossyNumericCells.has(`${i}:${idx.boId}`)) {
        errors.push('BO ID was stored as a number in Excel and may have lost its last digit. Format the column as text and re-export.');
      } else {
        value = normalizeBoId(boRaw);
        kind = 'BO';
        if (!value) errors.push(`BO ID "${boRaw}" must be 16 digits`);
      }
    } else if (folioRaw) {
      value = normalizeFolio(folioRaw);
      kind = 'FOLIO';
      if (!value) errors.push(`Folio "${folioRaw}" may contain only letters, digits, "/" and "-" (max 20)`);
    } else {
      errors.push('BO ID or folio number is required');
    }
    const identityKey = kind && value ? `${kind}:${value}` : null;

    // Name and type
    const name = get(r, 'name').replace(/\s+/g, ' ');
    if (!name) errors.push('Holder name is required');
    else if (name.length > 200) errors.push('Holder name is longer than 200 characters');
    const holderType = parseHolderType(get(r, 'holderType'));
    if (!holderType) errors.push(`Holder type "${get(r, 'holderType')}" is not "individual" or "corporate"`);

    // Share class
    const shareClass = (get(r, 'shareClass') || 'ORD').toUpperCase();
    if (!state.shareClassCodes.has(shareClass)) {
      if (shareClass === 'ORD') autoCreate.add('ORD');
      else errors.push(`Share class "${shareClass}" does not exist. Create it before importing.`);
    }

    // Shares
    const sharesRaw = get(r, 'shares');
    const shares = parseShares(sharesRaw);
    if (shares === null) errors.push(sharesRaw ? `Shares "${sharesRaw}" must be a whole number` : 'Number of shares is required');

    // Contacts: invalid contacts are dropped with a warning; they never block the holding.
    const phoneRaw = get(r, 'phone');
    const phone = phoneRaw ? normalizeBdPhone(phoneRaw) : null;
    if (phoneRaw && !phone) warnings.push(`Mobile "${phoneRaw}" is not a valid Bangladesh number and was skipped`);
    const emailRaw = get(r, 'email');
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    if (emailRaw && !email) warnings.push(`Email "${emailRaw}" is not valid and was skipped`);

    // Duplicates inside the file
    if (identityKey) {
      const dupKey = `${identityKey}|${shareClass}`;
      const first = seen.get(dupKey);
      if (first !== undefined) errors.push(`Duplicate of row ${first} (same account and share class)`);
      else seen.set(dupKey, rowNumber);
    }

    if (errors.length > 0 || !kind || !value || !holderType || shares === null) {
      if (identityKey) errorIdentities.add(identityKey);
      rows.push({ rowNumber, raw, status: 'ERROR', action: 'NONE', errors, normalized: null });
      return;
    }

    // Classify against the register
    const existing = state.identities.get(identityKey!);
    let action: RowResult['action'];
    let nameChanged = false;
    let linkShareholderId: string | null = null;
    let groupKey: string | null = null;
    let holdingId: string | null = null;
    let previous: bigint | null = null;

    if (existing) {
      const h = existing.holdings.get(shareClass);
      holdingId = h?.holdingId ?? null;
      previous = h?.quantity ?? null;
      nameChanged = normName(existing.shareholderName) !== normName(name);
      if (nameChanged) warnings.push(`Name changes from "${existing.shareholderName}"`);
      if (existing.holderType !== holderType) warnings.push(`Register lists this holder as ${existing.holderType.toLowerCase()}; type is not changed by imports`);
      action = previous === shares && !nameChanged ? 'UNCHANGED' : previous === null && shares === 0n && !nameChanged ? 'UNCHANGED' : 'CHANGED';
    } else {
      action = 'NEW';
      if (holderType === 'CORPORATE') {
        linkShareholderId = state.corporateByName.get(normName(name)) ?? null;
        groupKey = linkShareholderId ? null : `corp:${normName(name)}`;
        if (linkShareholderId) warnings.push('Linked to the existing corporate shareholder with the same name');
      }
    }

    rows.push({
      rowNumber,
      raw,
      status: 'VALID',
      action,
      errors: [],
      normalized: {
        kind,
        value,
        name,
        nameBn: get(r, 'nameBn') || null,
        holderType,
        shareClass,
        shares: shares.toString(),
        phone,
        email,
        warnings,
        existing: existing
          ? { identityId: existing.identityId, shareholderId: existing.shareholderId, holdingId, previousShares: previous?.toString() ?? null }
          : null,
        linkShareholderId,
        groupKey,
        nameChanged,
      },
    });
  });

  // FULL mode: a current holding is closed when no valid row covers its account and share
  // class. Accounts that appear on any error row are never closed, because the file's
  // intent for them is unknown.
  const closed: ClosedHolding[] = [];
  if (mode === 'FULL') {
    const validPairs = new Set(
      rows.filter((r) => r.normalized).map((r) => `${r.normalized!.kind}:${r.normalized!.value}|${r.normalized!.shareClass}`),
    );
    for (const [key, ident] of state.identities) {
      if (errorIdentities.has(key)) continue;
      for (const [cls, h] of ident.holdings) {
        if (h.quantity === 0n || validPairs.has(`${key}|${cls}`)) continue;
        closed.push({ holdingId: h.holdingId, identityKey: key, shareClass: cls, shareholderName: ident.shareholderName, previousShares: h.quantity.toString() });
      }
    }
  }

  const count = (a: RowResult['action']) => rows.filter((r) => r.action === a).length;
  const errorRows = rows.filter((r) => r.status === 'ERROR').length;
  return {
    rows,
    closed,
    summary: { new: count('NEW'), changed: count('CHANGED'), unchanged: count('UNCHANGED'), closed: closed.length },
    validRows: rows.length - errorRows,
    errorRows,
    autoCreateClasses: [...autoCreate],
  };
}
