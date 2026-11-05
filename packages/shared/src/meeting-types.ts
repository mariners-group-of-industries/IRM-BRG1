import type {
  MeetingDocumentKind,
  MeetingMode,
  MeetingRules,
  MeetingState,
  MeetingType,
  ResolutionKind,
} from './meeting.js';
import type { ParticipantKind } from './shareholder.js';
import type { ShareCount } from './shareholder-types.js';

export interface MeetingSummary {
  id: string;
  companyId: string;
  type: MeetingType;
  title: string;
  state: MeetingState;
  scheduledStart: string;
  timezone: string;
  recordDate: string;
  mode: MeetingMode;
  venue: string | null;
  agendaCount: number;
  registrations: number;
  version: number;
  createdAt: string;
}

export interface MeetingDetail extends MeetingSummary {
  description: string | null;
  noticeText: string | null;
  rules: MeetingRules;
  snapshotTakenAt: string | null;
  publishedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Blocking checks prevent the transition; others are warnings. */
  blocking: boolean;
  detail?: string;
}

export interface MeetingTransitionOption {
  to: MeetingState;
  action: string;
  description: string;
  requiresReason: boolean;
  allowed: boolean;
  checks: ReadinessCheck[];
}

export interface MeetingControl {
  meeting: MeetingDetail;
  transitions: MeetingTransitionOption[];
  history: { id: string; from: MeetingState | null; to: MeetingState; actor: string | null; reason: string | null; at: string }[];
}

export interface AgendaItemDto {
  id: string;
  number: string;
  title: string;
  description: string | null;
  position: number;
  resolution: {
    kind: ResolutionKind;
    text: string;
    requiresProposal: boolean;
    requiresSeconding: boolean;
  } | null;
}

export interface MeetingDocumentDto {
  id: string;
  kind: MeetingDocumentKind;
  title: string;
  fileName: string;
  sizeBytes: number;
  published: boolean;
  agendaItemId: string | null;
  uploadedAt: string;
}

export interface MeetingStaffDto {
  boardMembers: { userId: string; fullName: string; email: string | null }[];
  moderators: { userId: string; fullName: string; email: string | null }[];
  candidates: { userId: string; fullName: string; email: string | null; roles: string[] }[];
}

export interface SnapshotSummary {
  takenAt: string | null;
  recordDate: string;
  holders: number;
  accounts: number;
  totalShares: ShareCount;
  totalVotes: ShareCount;
  byClass: { code: string; votesPerShare: number; shares: ShareCount; votes: ShareCount }[];
  registerAsOf: string | null;
}

export interface EntitlementDto {
  id: string;
  shareholderName: string;
  account: string;
  shareClass: string;
  shares: ShareCount;
  votes: ShareCount;
  registered: boolean;
}

export interface MeetingParticipantDto {
  id: string;
  kind: ParticipantKind;
  participantName: string;
  representing: string;
  votes: ShareCount;
  registeredAt: string;
}

/** What a shareholder or representative sees for one meeting. */
export interface PortalMeeting {
  id: string;
  companyId: string;
  companyName: string;
  type: MeetingType;
  title: string;
  state: MeetingState;
  scheduledStart: string;
  timezone: string;
  recordDate: string;
  mode: MeetingMode;
  venue: string | null;
  noticeText: string | null;
  agenda: AgendaItemDto[];
  documents: MeetingDocumentDto[];
  registrationOpen: boolean;
  /** One entry per thing the person may register for. */
  eligibility: {
    key: string;
    kind: ParticipantKind;
    label: string;
    shareholderName: string;
    votes: ShareCount;
    eligible: boolean;
    reason: string | null;
    registered: boolean;
  }[];
}
