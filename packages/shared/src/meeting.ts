import { z } from 'zod';
import type { Permission } from './permissions.js';

// ─── State machine ─────────────────────────────────────────────────────

export const MEETING_STATES = ['DRAFT', 'SCHEDULED', 'REGISTRATION_OPEN', 'LIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

export const MEETING_STATE_LABELS: Record<MeetingState, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  REGISTRATION_OPEN: 'Registration open',
  LIVE: 'Live',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export interface TransitionRule {
  from: MeetingState;
  to: MeetingState;
  /** Button label for the action. */
  action: string;
  /** Any one of these permissions allows the transition. */
  permissions: readonly Permission[];
  /** Destructive or irreversible transitions need a typed reason. */
  requiresReason?: boolean;
  description: string;
}

/**
 * The only allowed transitions. Anything else is rejected by the API with 409.
 * Guards that depend on data (agenda present, record date passed, and so on) are
 * evaluated server-side by the readiness check.
 */
export const MEETING_TRANSITIONS: readonly TransitionRule[] = [
  { from: 'DRAFT', to: 'SCHEDULED', action: 'Publish notice', permissions: ['meeting.update'], description: 'Publishes the notice, agenda and documents to shareholders.' },
  { from: 'SCHEDULED', to: 'DRAFT', action: 'Return to draft', permissions: ['meeting.update'], requiresReason: true, description: 'Withdraws the published notice so it can be edited.' },
  { from: 'SCHEDULED', to: 'REGISTRATION_OPEN', action: 'Open registration', permissions: ['meeting.update', 'meeting.control'], description: 'Freezes holdings at the record date and lets eligible participants register.' },
  { from: 'REGISTRATION_OPEN', to: 'LIVE', action: 'Start meeting', permissions: ['meeting.control'], description: 'Starts the live meeting. Governance rules lock.' },
  { from: 'LIVE', to: 'PAUSED', action: 'Pause', permissions: ['meeting.control'], description: 'Pauses proceedings. Open stages stay as they are.' },
  { from: 'PAUSED', to: 'LIVE', action: 'Resume', permissions: ['meeting.control'], description: 'Resumes the live meeting.' },
  { from: 'LIVE', to: 'COMPLETED', action: 'End meeting', permissions: ['meeting.control'], requiresReason: false, description: 'Ends the meeting. This cannot be undone.' },
  { from: 'PAUSED', to: 'COMPLETED', action: 'End meeting', permissions: ['meeting.control'], description: 'Ends the meeting. This cannot be undone.' },
  { from: 'COMPLETED', to: 'ARCHIVED', action: 'Archive', permissions: ['meeting.update'], description: 'Archives the meeting record.' },
];

export function findTransition(from: MeetingState, to: MeetingState): TransitionRule | undefined {
  return MEETING_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function transitionsFrom(from: MeetingState): TransitionRule[] {
  return MEETING_TRANSITIONS.filter((t) => t.from === from);
}

/** States in which the notice, agenda and schedule may still be edited. */
export const EDITABLE_STATES: readonly MeetingState[] = ['DRAFT', 'SCHEDULED'];
/** States in which governance rules may still change. They lock when the meeting goes live. */
export const RULES_EDITABLE_STATES: readonly MeetingState[] = ['DRAFT', 'SCHEDULED', 'REGISTRATION_OPEN'];
/** States visible to shareholders. */
export const PUBLISHED_STATES: readonly MeetingState[] = ['SCHEDULED', 'REGISTRATION_OPEN', 'LIVE', 'PAUSED', 'COMPLETED'];
/** States in which participants may register. */
export const REGISTRATION_STATES: readonly MeetingState[] = ['REGISTRATION_OPEN', 'LIVE', 'PAUSED'];

// ─── Governance rules (see docs/VOTING_RULES.md) ───────────────────────

const fraction = z.object({ numerator: z.number().int().min(1), denominator: z.number().int().min(1) }).refine((f) => f.numerator <= f.denominator, 'Fraction must not exceed 1');

/**
 * Configurable governance rules. Defaults are conservative engineering defaults,
 * not legal advice: every company's configuration needs legal review.
 */
export const meetingRulesSchema = z.object({
  version: z.literal(1).default(1),
  votingMethod: z.enum(['SHARE_WEIGHTED', 'ONE_MEMBER_ONE_VOTE']).default('SHARE_WEIGHTED'),
  choices: z.array(z.enum(['FOR', 'AGAINST', 'ABSTAIN'])).min(2).default(['FOR', 'AGAINST', 'ABSTAIN']),
  abstainCountsInBase: z.boolean().default(false),
  allowVoteChange: z.boolean().default(false),
  ordinaryMajority: fraction.default({ numerator: 1, denominator: 2 }),
  /** Ordinary resolutions pass with MORE than this fraction; special with AT LEAST. */
  specialMajority: fraction.default({ numerator: 3, denominator: 4 }),
  quorum: z
    .object({ members: z.number().int().min(0).nullable().default(null), holdingPercent: z.number().min(0).max(100).nullable().default(null) })
    .default({ members: null, holdingPercent: null }),
  pollDemand: z
    .object({
      enabled: z.boolean().default(false),
      threshold: z.enum(['ANY_MEMBER', 'MEMBERS_COUNT', 'VOTING_RIGHTS_PERCENT']).default('ANY_MEMBER'),
      thresholdValue: z.number().min(0).nullable().default(null),
    })
    .default({ enabled: false, threshold: 'ANY_MEMBER', thresholdValue: null }),
  proposal: z
    .object({ mode: z.enum(['FIRST_ACCEPTED', 'COLLECT_ALL']).default('FIRST_ACCEPTED'), minHolding: z.number().int().min(0).default(0) })
    .default({ mode: 'FIRST_ACCEPTED', minHolding: 0 }),
  seconding: z.object({ excludeProposer: z.boolean().default(true) }).default({ excludeProposer: true }),
  proxy: z
    .object({
      allowed: z.boolean().default(true),
      lodgementDeadlineHours: z.number().int().min(0).max(720).default(72),
      maxPerProxy: z.number().int().min(1).nullable().default(null),
      canSpeak: z.boolean().default(false),
    })
    .default({ allowed: true, lodgementDeadlineHours: 72, maxPerProxy: null, canSpeak: false }),
  corporateRep: z.object({ requireBoardResolution: z.boolean().default(true) }).default({ requireBoardResolution: true }),
  results: z
    .object({ visibility: z.enum(['STAFF_AFTER_CLOSE', 'ALL_AFTER_RELEASE']).default('ALL_AFTER_RELEASE'), showWeights: z.boolean().default(true) })
    .default({ visibility: 'ALL_AFTER_RELEASE', showWeights: true }),
  audioQuestionMaxSeconds: z.number().int().min(120).max(180).default(150),
});
export type MeetingRules = z.output<typeof meetingRulesSchema>;
export const DEFAULT_MEETING_RULES: MeetingRules = meetingRulesSchema.parse({});

// ─── Inputs ────────────────────────────────────────────────────────────

export const MEETING_TYPES = ['AGM', 'EGM'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_MODES = ['VIRTUAL', 'HYBRID'] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const createMeetingSchema = z
  .object({
    type: z.enum(MEETING_TYPES),
    title: z.string().trim().min(5, 'At least 5 characters').max(200),
    /** ISO date-time with offset, e.g. 2026-12-20T10:30:00+06:00 */
    scheduledStart: z.string().datetime({ offset: true, message: 'Choose a date and time' }),
    timezone: z.string().trim().min(1).default('Asia/Dhaka'),
    recordDate: dateOnly,
    mode: z.enum(MEETING_MODES).default('VIRTUAL'),
    venue: z.string().trim().max(300).optional().or(z.literal('')),
  })
  .refine((v) => v.mode !== 'HYBRID' || !!v.venue, { message: 'A hybrid meeting needs a venue', path: ['venue'] })
  .refine((v) => v.recordDate <= v.scheduledStart.slice(0, 10), { message: 'The record date must be on or before the meeting date', path: ['recordDate'] });
export type CreateMeetingInput = z.input<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  title: z.string().trim().min(5).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  noticeText: z.string().trim().max(20000).optional(),
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  recordDate: dateOnly.optional(),
  mode: z.enum(MEETING_MODES).optional(),
  venue: z.string().trim().max(300).optional(),
});
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

export const transitionSchema = z.object({
  to: z.enum(MEETING_STATES),
  reason: z.string().trim().max(500).optional(),
  /** Optimistic concurrency: the version the user was looking at. */
  expectedVersion: z.number().int().min(1),
});

export const RESOLUTION_KINDS = ['ORDINARY', 'SPECIAL'] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

export const agendaItemSchema = z
  .object({
    number: z.string().trim().min(1, 'Required').max(10),
    title: z.string().trim().min(3, 'At least 3 characters').max(300),
    description: z.string().trim().max(5000).optional().or(z.literal('')),
    /** Items without a resolution are procedural (for example, the chair's address). */
    hasResolution: z.boolean(),
    resolutionKind: z.enum(RESOLUTION_KINDS).default('ORDINARY'),
    resolutionText: z.string().trim().max(10000).optional().or(z.literal('')),
    requiresProposal: z.boolean().default(true),
    requiresSeconding: z.boolean().default(true),
  })
  .refine((v) => !v.hasResolution || (v.resolutionText ?? '').length >= 10, { message: 'Enter the resolution text', path: ['resolutionText'] });
export type AgendaItemInput = z.input<typeof agendaItemSchema>;

export const MEETING_DOCUMENT_KINDS = ['NOTICE', 'ANNUAL_REPORT', 'FINANCIAL_STATEMENTS', 'PROXY_FORM', 'PRESENTATION', 'OTHER'] as const;
export type MeetingDocumentKind = (typeof MEETING_DOCUMENT_KINDS)[number];
export const MEETING_DOCUMENT_KIND_LABELS: Record<MeetingDocumentKind, string> = {
  NOTICE: 'Notice of meeting',
  ANNUAL_REPORT: 'Annual report',
  FINANCIAL_STATEMENTS: 'Financial statements',
  PROXY_FORM: 'Proxy form',
  PRESENTATION: 'Presentation',
  OTHER: 'Other',
};

export const meetingStaffSchema = z.object({
  boardMemberIds: z.array(z.string().uuid()).max(50),
  moderatorIds: z.array(z.string().uuid()).max(50),
});
