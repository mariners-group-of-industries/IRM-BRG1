import type { AuthorizationStatus, HolderType, IdentityKind, ImportFieldKey, ParticipantKind, ProxyScope } from './shareholder.js';

/** Share counts are serialised as strings because they can exceed 2^53. */
export type ShareCount = string;

export interface ShareClassDto {
  id: string;
  code: string;
  name: string;
  votesPerShare: number;
}

export interface IdentityDto {
  id: string;
  kind: IdentityKind;
  /** Masked unless the caller holds shareholder.pii.read. */
  value: string;
  masked: boolean;
}

export interface ShareholderListItem {
  id: string;
  type: HolderType;
  name: string;
  nameBn: string | null;
  status: string;
  identities: IdentityDto[];
  totalShares: ShareCount;
}

export interface HoldingDto {
  id: string;
  identityId: string;
  identity: string;
  shareClass: string;
  quantity: ShareCount;
  asOfDate: string;
  validFrom: string;
  validTo: string | null;
  importId: string | null;
}

export interface ContactDto {
  id: string;
  kind: 'PHONE' | 'EMAIL';
  value: string;
  source: string;
  masked: boolean;
}

export interface ShareholderDetail extends ShareholderListItem {
  contacts: ContactDto[];
  currentHoldings: HoldingDto[];
  history: HoldingDto[];
  piiVisible: boolean;
}

export interface RegisterSummary {
  shareholders: number;
  identities: number;
  byClass: { code: string; name: string; votesPerShare: number; totalShares: ShareCount; holders: number }[];
  lastImport: { id: string; committedAt: string; asOfDate: string | null } | null;
}

export interface ImportDto {
  id: string;
  status: 'UPLOADED' | 'VALIDATED' | 'COMMITTED' | 'CANCELLED' | 'FAILED';
  fileName: string;
  fileSize: number;
  mode: 'FULL' | 'DELTA' | null;
  asOfDate: string | null;
  headers: string[];
  mapping: Partial<Record<ImportFieldKey, string>> | null;
  suggestedMapping: Partial<Record<ImportFieldKey, string>>;
  sampleRows: Record<string, string>[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  summary: { new: number; changed: number; unchanged: number; closed: number } | null;
  createdBy: string | null;
  createdAt: string;
  validatedAt: string | null;
  committedBy: string | null;
  committedAt: string | null;
  failureMessage: string | null;
}

export interface ImportRowDto {
  rowNumber: number;
  status: 'VALID' | 'ERROR';
  action: 'NEW' | 'CHANGED' | 'UNCHANGED' | 'CLOSED' | 'NONE';
  errors: string[];
  warnings: string[];
  identifier: string | null;
  name: string | null;
  shares: ShareCount | null;
  previousShares: ShareCount | null;
}

export interface AuthorizationDocument {
  id: string;
  fileName: string;
  sizeBytes: number;
}

export interface CorporateRepDto {
  id: string;
  shareholderId: string;
  shareholderName: string;
  fullName: string;
  designation: string | null;
  email: string;
  phone: string | null;
  identities: IdentityDto[];
  validFrom: string;
  validUntil: string;
  status: AuthorizationStatus;
  effective: boolean;
  document: AuthorizationDocument | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ProxyDto {
  id: string;
  grantorShareholderId: string;
  grantorName: string;
  fullName: string;
  email: string;
  phone: string | null;
  scope: ProxyScope;
  meetingId: string | null;
  meetingReference: string;
  validFrom: string;
  validUntil: string;
  status: AuthorizationStatus;
  effective: boolean;
  document: AuthorizationDocument | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface PublicCompanyInfo {
  id: string;
  legalName: string;
  shortName: string;
}

export interface OtpRequestResponse {
  challengeId: string;
  expiresInSeconds: number;
  message: string;
}

export interface ParticipantRepresentation {
  kind: ParticipantKind;
  label: string;
  shareholderName: string;
  holderType: HolderType;
  identities: { kind: IdentityKind; value: string; shares: { shareClass: string; quantity: ShareCount }[] }[];
  totalShares: ShareCount;
  scope?: ProxyScope;
  meetingReference?: string;
  validUntil?: string;
}

export interface ParticipantMe {
  company: PublicCompanyInfo;
  fullName: string;
  representations: ParticipantRepresentation[];
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface LoginResponse {
  ok: boolean;
  mfaRequired?: boolean;
  mfaToken?: string;
  csrfToken?: string;
}
