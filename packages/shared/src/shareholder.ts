import { z } from 'zod';

// ─── Identifiers ───────────────────────────────────────────────────────

export const IDENTITY_KINDS = ['BO', 'FOLIO'] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

export const HOLDER_TYPES = ['INDIVIDUAL', 'CORPORATE'] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];

/** CDBL beneficial owner account numbers are 16 digits. Spaces and dashes are ignored. */
export function normalizeBoId(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '');
  return /^\d{16}$/.test(v) ? v : null;
}

/** Folio numbers are company-issued. Accept 1 to 20 letters, digits, slash or dash. */
export function normalizeFolio(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9/-]{1,20}$/.test(v) ? v : null;
}

/**
 * Bangladesh mobile numbers to E.164 (+8801XXXXXXXXX).
 * Accepts 01XXXXXXXXX, 8801XXXXXXXXX and +8801XXXXXXXXX. Operator prefixes 013 to 019.
 */
export function normalizeBdPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
  const local = digits.startsWith('880') ? digits.slice(2) : digits;
  return /^01[3-9]\d{8}$/.test(local) ? `+88${local}` : null;
}

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return z.string().email().max(254).safeParse(v).success ? v : null;
}

// ─── Masking (default for anyone without shareholder.pii.read) ─────────

export function maskIdentifier(value: string): string {
  if (value.length <= 6) return `${value.slice(0, 1)}${'•'.repeat(Math.max(0, value.length - 2))}${value.slice(-1)}`;
  return `${value.slice(0, 4)}${'•'.repeat(value.length - 8 > 0 ? value.length - 8 : 2)}${value.slice(-4)}`;
}

export function maskPhone(e164: string): string {
  return e164.length > 7 ? `${e164.slice(0, 6)}•••••${e164.slice(-2)}` : '•••';
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

// ─── Register import ───────────────────────────────────────────────────

/** Target fields a register column can map to. */
export const IMPORT_FIELDS = [
  { key: 'boId', label: 'BO ID', required: false, hint: '16-digit CDBL account number' },
  { key: 'folio', label: 'Folio number', required: false, hint: 'For physical share registers' },
  { key: 'name', label: 'Holder name', required: true, hint: 'As registered' },
  { key: 'nameBn', label: 'Holder name (Bangla)', required: false, hint: '' },
  { key: 'holderType', label: 'Holder type', required: false, hint: 'Individual or corporate. Defaults to individual.' },
  { key: 'shareClass', label: 'Share class code', required: false, hint: 'Defaults to ORD' },
  { key: 'shares', label: 'Number of shares', required: true, hint: 'Whole number' },
  { key: 'phone', label: 'Mobile number', required: false, hint: 'Used for sign-in codes' },
  { key: 'email', label: 'Email', required: false, hint: 'Used for sign-in codes' },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];

/** Header names commonly seen in CDBL and registrar exports, used to suggest a mapping. */
export const IMPORT_HEADER_ALIASES: Record<ImportFieldKey, string[]> = {
  boId: ['bo id', 'boid', 'bo account', 'bo account no', 'bo_id', 'bo no', 'bo number', 'beneficiary owner id'],
  folio: ['folio', 'folio no', 'folio number', 'folio_no'],
  name: ['name', 'holder name', 'shareholder name', 'account holder', 'name of shareholder', 'first holder name'],
  nameBn: ['name bn', 'bangla name', 'name (bangla)', 'name_bn', 'নাম'],
  holderType: ['holder type', 'type', 'account type', 'category'],
  shareClass: ['share class', 'class', 'share type'],
  shares: ['shares', 'no of shares', 'number of shares', 'holding', 'total shares', 'quantity', 'current balance', 'balance'],
  phone: ['phone', 'mobile', 'mobile no', 'mobile number', 'contact no', 'cell', 'phone number'],
  email: ['email', 'e-mail', 'email address', 'mail'],
};

export function suggestMapping(headers: string[]): Partial<Record<ImportFieldKey, string>> {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ');
  const out: Partial<Record<ImportFieldKey, string>> = {};
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => IMPORT_HEADER_ALIASES[field.key].includes(norm(h)));
    if (hit) out[field.key] = hit;
  }
  return out;
}

export const IMPORT_MODES = ['FULL', 'DELTA'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const importMappingSchema = z
  .object({
    mapping: z.record(z.string(), z.string().min(1)).refine((m) => !!m.name && !!m.shares, {
      message: 'Map at least the holder name and number of shares',
    }),
    /** FULL: the file is the whole register; holdings missing from it are closed. DELTA: only rows in the file change. */
    mode: z.enum(IMPORT_MODES),
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  })
  .refine((v) => !!v.mapping.boId || !!v.mapping.folio, {
    message: 'Map a BO ID or folio number column',
    path: ['mapping'],
  });
export type ImportMappingInput = z.infer<typeof importMappingSchema>;

export const shareClassSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/, 'Use 1 to 12 letters, digits, dash or underscore'),
  name: z.string().trim().min(2).max(80),
  votesPerShare: z.coerce.number().int().min(0).max(1000),
});
export type ShareClassInput = z.input<typeof shareClassSchema>;

// ─── Corporate representatives and proxies ─────────────────────────────

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optionalPhone = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || normalizeBdPhone(v) !== null, 'Enter a Bangladesh mobile number');

export const corporateRepSchema = z
  .object({
    shareholderId: z.string().uuid('Select a corporate shareholder'),
    fullName: z.string().trim().min(2).max(160),
    designation: z.string().trim().max(120).optional().or(z.literal('')),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
    phone: optionalPhone,
    identityIds: z.array(z.string().uuid()).min(1, 'Select at least one account'),
    validFrom: dateOnly,
    validUntil: dateOnly,
  })
  .refine((v) => v.validUntil >= v.validFrom, { message: 'End date must be on or after the start date', path: ['validUntil'] });
export type CorporateRepInput = z.input<typeof corporateRepSchema>;

export const PROXY_SCOPES = ['ATTEND', 'ATTEND_AND_VOTE'] as const;
export type ProxyScope = (typeof PROXY_SCOPES)[number];

export const proxySchema = z
  .object({
    grantorShareholderId: z.string().uuid('Select the shareholder granting the proxy'),
    fullName: z.string().trim().min(2).max(160),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
    phone: optionalPhone,
    scope: z.enum(PROXY_SCOPES),
    /** Free-text meeting reference until meetings exist (Phase C), then replaced by a meeting id. */
    meetingReference: z.string().trim().min(2, 'Name the meeting this proxy is for').max(160),
    validFrom: dateOnly,
    validUntil: dateOnly,
  })
  .refine((v) => v.validUntil >= v.validFrom, { message: 'End date must be on or after the start date', path: ['validUntil'] });
export type ProxyInput = z.input<typeof proxySchema>;

export const AUTHORIZATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

// ─── Participant sign-in ───────────────────────────────────────────────

export const PARTICIPANT_KINDS = ['SHAREHOLDER', 'CORPORATE_REPRESENTATIVE', 'PROXY_REPRESENTATIVE'] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export const participantOtpRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SHAREHOLDER'),
    companyId: z.string().uuid(),
    identifier: z.string().trim().min(1, 'Enter your BO ID or folio number').max(40),
  }),
  z.object({
    kind: z.literal('CORPORATE_REPRESENTATIVE'),
    companyId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  }),
  z.object({
    kind: z.literal('PROXY_REPRESENTATIVE'),
    companyId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  }),
]);
export type ParticipantOtpRequest = z.infer<typeof participantOtpRequestSchema>;

export const participantOtpVerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type ParticipantOtpVerify = z.infer<typeof participantOtpVerifySchema>;

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/, 'Enter the 6-digit code or a recovery code'),
});
