/**
 * Central permission catalogue. This is the single source of truth for every
 * permission key used by the API guards, the database seed and the web UI.
 *
 * Naming: <resource>.<action>. Adding a permission here requires updating
 * docs/ROLES_AND_PERMISSIONS.md and re-running the seed.
 */
export const PERMISSIONS = {
  // Platform
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',
  PLATFORM_AUDIT_READ: 'platform.audit.read',
  TENANT_READ: 'tenant.read',
  TENANT_MANAGE: 'tenant.manage',

  // Company
  COMPANY_READ: 'company.read',
  COMPANY_CREATE: 'company.create',
  COMPANY_UPDATE: 'company.update',

  // Users & access
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  ROLE_ASSIGN: 'role.assign',
  AUDIT_READ: 'audit.read',

  // Shareholders (Phase B)
  SHAREHOLDER_READ: 'shareholder.read',
  SHAREHOLDER_IMPORT: 'shareholder.import',
  SHAREHOLDER_PII_READ: 'shareholder.pii.read',
  /** Create, approve and revoke corporate representatives and proxies. */
  AUTHORIZATION_MANAGE: 'authorization.manage',

  // Meetings (Phase C)
  MEETING_READ: 'meeting.read',
  MEETING_CREATE: 'meeting.create',
  MEETING_UPDATE: 'meeting.update',
  MEETING_CONTROL: 'meeting.control',
  AGENDA_MANAGE: 'agenda.manage',
  DOCUMENT_MANAGE: 'document.manage',
  ANNOUNCEMENT_MANAGE: 'announcement.manage',
  ATTENDANCE_READ: 'attendance.read',
  MEETING_JOIN_BOARD: 'meeting.join.board',
  MEETING_JOIN_SHAREHOLDER: 'meeting.join.shareholder',

  // Participation (Phase D/E): always combined with entitlement checks
  PROPOSAL_SUBMIT: 'proposal.submit',
  SECONDING_SUBMIT: 'seconding.submit',
  POLL_DEMAND_SUBMIT: 'polldemand.submit',
  VOTE_CAST: 'vote.cast',
  QUESTION_SUBMIT: 'question.submit',

  // Moderation
  QUESTION_MODERATE: 'question.moderate',
  QUESTION_FORWARDED_READ: 'question.forwarded.read',

  // Voting administration
  VOTING_CONTROL: 'voting.control',
  VOTING_RESULTS_READ: 'voting.results.read',
  VOTING_RESULTS_RELEASE: 'voting.results.release',
  /** Never granted by a role. Only via an audited, time-boxed privileged-access grant. */
  BALLOT_INDIVIDUAL_READ: 'ballot.individual.read',

  // Reporting
  REPORT_GENERATE: 'report.generate',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'platform.settings.manage': 'Configure platform-wide settings',
  'platform.audit.read': 'Read platform operations audit log',
  'tenant.read': 'View organizational tenants',
  'tenant.manage': 'Create and update organizational tenants',
  'company.read': 'View company profile',
  'company.create': 'Create companies within a tenant',
  'company.update': 'Update company profile and settings',
  'user.read': 'View users in scope',
  'user.manage': 'Create, disable and update users in scope',
  'role.assign': 'Assign and revoke roles in scope',
  'audit.read': 'Read the audit log for a tenant or company',
  'shareholder.read': 'View shareholder register (masked identifiers)',
  'shareholder.import': 'Import shareholder registers',
  'shareholder.pii.read': 'View unmasked shareholder personal data',
  'authorization.manage': 'Manage corporate representatives and proxies',
  'meeting.read': 'View meetings',
  'meeting.create': 'Create AGM/EGM meetings',
  'meeting.update': 'Edit meeting configuration',
  'meeting.control': 'Change meeting state and run the live meeting',
  'agenda.manage': 'Manage agenda items and resolutions',
  'document.manage': 'Upload and remove meeting documents',
  'announcement.manage': 'Publish meeting announcements',
  'attendance.read': 'View attendance records',
  'meeting.join.board': 'Join the meeting as a board participant',
  'meeting.join.shareholder': 'Join the meeting as a shareholder participant',
  'proposal.submit': 'Propose a resolution when the stage is open',
  'seconding.submit': 'Second a resolution when the stage is open',
  'polldemand.submit': 'Demand a poll when permitted',
  'vote.cast': 'Cast a ballot for an eligible entitlement',
  'question.submit': 'Submit text or audio questions',
  'question.moderate': 'Approve, reject and forward questions',
  'question.forwarded.read': 'Read questions forwarded to the board',
  'voting.control': 'Open and close voting sessions',
  'voting.results.read': 'View aggregated voting results',
  'voting.results.release': 'Publish voting results to participants',
  'ballot.individual.read': 'View individual ballot choices (privileged grant only)',
  'report.generate': 'Generate and export reports',
};
