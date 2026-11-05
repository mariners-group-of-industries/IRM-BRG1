import { describe, expect, it } from 'vitest';
import {
  maskEmail,
  maskIdentifier,
  maskPhone,
  normalizeBdPhone,
  normalizeBoId,
  normalizeFolio,
  suggestMapping,
  importMappingSchema,
} from './shareholder.js';

describe('identifier normalisation', () => {
  it('accepts 16-digit BO ids with separators', () => {
    expect(normalizeBoId('1201 9500-1234 5678')).toBe('1201950012345678');
    expect(normalizeBoId('12019500123456')).toBeNull();
    expect(normalizeBoId('120195001234567X')).toBeNull();
  });

  it('normalises folio numbers', () => {
    expect(normalizeFolio(' f-00123 ')).toBe('F-00123');
    expect(normalizeFolio('bad folio!')).toBeNull();
  });

  it('normalises Bangladesh mobile numbers to E.164', () => {
    expect(normalizeBdPhone('01712-345678')).toBe('+8801712345678');
    expect(normalizeBdPhone('+880 1912 345678')).toBe('+8801912345678');
    expect(normalizeBdPhone('8801512345678')).toBe('+8801512345678');
    expect(normalizeBdPhone('01212345678')).toBeNull();
    expect(normalizeBdPhone('0171234567')).toBeNull();
  });
});

describe('masking', () => {
  it('keeps only the ends of identifiers', () => {
    expect(maskIdentifier('1201950012345678')).toBe('1201••••••••5678');
    expect(maskIdentifier('F-0012')).toBe('F••••2');
  });
  it('masks phones and emails', () => {
    expect(maskPhone('+8801712345678')).toBe('+88017•••••78');
    expect(maskEmail('rahim@example.com')).toBe('r••••@example.com');
  });
});

describe('import mapping', () => {
  it('suggests columns from common registrar headers', () => {
    expect(suggestMapping(['BO ID', 'Name of Shareholder', 'Current Balance', 'Mobile No', 'Folio No'])).toEqual({
      boId: 'BO ID',
      name: 'Name of Shareholder',
      shares: 'Current Balance',
      phone: 'Mobile No',
      folio: 'Folio No',
    });
  });

  it('requires an identifier column, name and shares', () => {
    expect(importMappingSchema.safeParse({ mapping: { name: 'n', shares: 's' }, mode: 'FULL', asOfDate: '2026-11-01' }).success).toBe(false);
    expect(importMappingSchema.safeParse({ mapping: { boId: 'b', shares: 's' }, mode: 'FULL', asOfDate: '2026-11-01' }).success).toBe(false);
    expect(importMappingSchema.safeParse({ mapping: { boId: 'b', name: 'n', shares: 's' }, mode: 'FULL', asOfDate: '2026-11-01' }).success).toBe(true);
  });
});
