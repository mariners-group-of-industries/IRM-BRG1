import { PERMISSIONS as P, type Permission } from './permissions.js';

/**
 * Where a role assignment applies.
 * - PLATFORM: the whole platform (no tenant/company id on the assignment)
 * - TENANT:   every company inside one tenant (corporate group)
 * - COMPANY:  a single company
 */
export type RoleScope = 'PLATFORM' | 'TENANT' | 'COMPANY';

export const ROLE_KEYS = {
  PLATFORM_SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  MEETING_ADMIN: 'MEETING_ADMIN',
  BOARD_MEMBER: 'BOARD_MEMBER',
  MODERATOR: 'MODERATOR',
  COMPANY_OFFICIAL: 'COMPANY_OFFICIAL',
  SHAREHOLDER: 'SHAREHOLDER',
  CORPORATE_REPRESENTATIVE: 'CORPORATE_REPRESENTATIVE',
  PROXY_REPRESENTATIVE: 'PROXY_REPRESENTATIVE',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  /** Scopes at which this role may be assigned. */
  allowedScopes: readonly RoleScope[];
  /** True for roles held by meeting participants rather than staff. */
  participant: boolean;
  permissions: readonly Permission[];
  /**
   * Roles a holder of this role may grant, within the holder's own scope.
   * Participant roles are never listed: they are created by the verification,
   * corporate-authorization and proxy flows, not by hand.
   */
  assignableRoles: readonly RoleKey[];
}

const COMPANY_STAFF_ROLES: readonly RoleKey[] = [
  'COMPANY_ADMIN',
  'MEETING_ADMIN',
  'BOARD_MEMBER',
  'MODERATOR',
  'COMPANY_OFFICIAL',
];

const SHAREHOLDER_PARTICIPATION: readonly Permission[] = [
  P.MEETING_READ,
  P.MEETING_JOIN_SHAREHOLDER,
  P.PROPOSAL_SUBMIT,
  P.SECONDING_SUBMIT,
  P.POLL_DEMAND_SUBMIT,
  P.VOTE_CAST,
  P.QUESTION_SUBMIT,
];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: 'PLATFORM_SUPER_ADMIN',
    name: 'Platform Super Admin',
    description:
      'Operates the platform: tenants, companies and platform users. Has no access to shareholder personal data or ballots.',
    allowedScopes: ['PLATFORM'],
    participant: false,
    // Platform operators may bootstrap a company's first administrator, nothing operational.
    assignableRoles: ['PLATFORM_SUPER_ADMIN', 'COMPANY_ADMIN'],
    permissions: [
      P.PLATFORM_SETTINGS_MANAGE,
      P.PLATFORM_AUDIT_READ,
      P.TENANT_READ,
      P.TENANT_MANAGE,
      P.COMPANY_READ,
      P.COMPANY_CREATE,
      P.COMPANY_UPDATE,
      P.USER_READ,
      P.USER_MANAGE,
      P.ROLE_ASSIGN,
      P.AUDIT_READ,
    ],
  },
  {
    key: 'COMPANY_ADMIN',
    name: 'Company Admin',
    description:
      'Administers a company, or every company in a corporate group when assigned at tenant scope.',
    allowedScopes: ['TENANT', 'COMPANY'],
    participant: false,
    assignableRoles: COMPANY_STAFF_ROLES,
    permissions: [
      P.COMPANY_READ,
      P.COMPANY_UPDATE,
      P.USER_READ,
      P.USER_MANAGE,
      P.ROLE_ASSIGN,
      P.AUDIT_READ,
      P.SHAREHOLDER_READ,
      P.SHAREHOLDER_IMPORT,
      P.SHAREHOLDER_PII_READ,
      P.AUTHORIZATION_MANAGE,
      P.MEETING_READ,
      P.MEETING_CREATE,
      P.MEETING_UPDATE,
      P.AGENDA_MANAGE,
      P.DOCUMENT_MANAGE,
      P.ATTENDANCE_READ,
      P.VOTING_RESULTS_READ,
      P.REPORT_GENERATE,
    ],
  },
  {
    key: 'MEETING_ADMIN',
    name: 'Meeting Admin',
    description: 'Runs live meetings: state changes, agenda stages, voting and results release.',
    allowedScopes: ['COMPANY'],
    participant: false,
    assignableRoles: [],
    permissions: [
      P.COMPANY_READ,
      P.MEETING_READ,
      P.MEETING_CONTROL,
      P.ANNOUNCEMENT_MANAGE,
      P.ATTENDANCE_READ,
      P.VOTING_CONTROL,
      P.VOTING_RESULTS_READ,
      P.VOTING_RESULTS_RELEASE,
      P.REPORT_GENERATE,
      P.SHAREHOLDER_READ,
    ],
  },
  {
    key: 'BOARD_MEMBER',
    name: 'Board Member',
    description: 'Joins the board video room, sees forwarded questions and released results.',
    allowedScopes: ['COMPANY'],
    participant: false,
    assignableRoles: [],
    permissions: [
      P.COMPANY_READ,
      P.MEETING_READ,
      P.MEETING_JOIN_BOARD,
      P.QUESTION_FORWARDED_READ,
      P.ATTENDANCE_READ,
      P.VOTING_RESULTS_READ,
    ],
  },
  {
    key: 'MODERATOR',
    name: 'Moderator',
    description: 'Reviews, approves, rejects and forwards shareholder questions.',
    allowedScopes: ['COMPANY'],
    participant: false,
    assignableRoles: [],
    permissions: [P.COMPANY_READ, P.MEETING_READ, P.QUESTION_MODERATE, P.QUESTION_FORWARDED_READ],
  },
  {
    key: 'COMPANY_OFFICIAL',
    name: 'Company Official',
    description: 'Read-only access to authorized meeting information. No voting rights.',
    allowedScopes: ['COMPANY'],
    participant: false,
    assignableRoles: [],
    permissions: [P.COMPANY_READ, P.MEETING_READ, P.ATTENDANCE_READ],
  },
  {
    key: 'SHAREHOLDER',
    name: 'Individual Shareholder',
    description: 'Participates and votes for their own verified holdings.',
    allowedScopes: ['COMPANY'],
    participant: true,
    assignableRoles: [],
    permissions: SHAREHOLDER_PARTICIPATION,
  },
  {
    key: 'CORPORATE_REPRESENTATIVE',
    name: 'Corporate Shareholder Representative',
    description: 'Participates on behalf of a corporate shareholder under a validated authorization.',
    allowedScopes: ['COMPANY'],
    participant: true,
    assignableRoles: [],
    permissions: SHAREHOLDER_PARTICIPATION,
  },
  {
    key: 'PROXY_REPRESENTATIVE',
    name: 'Proxy Representative',
    description: 'Participates under a valid, meeting-specific proxy authorization.',
    allowedScopes: ['COMPANY'],
    participant: true,
    assignableRoles: [],
    permissions: SHAREHOLDER_PARTICIPATION,
  },
];

export const ROLE_BY_KEY: ReadonlyMap<RoleKey, RoleDefinition> = new Map(
  ROLE_DEFINITIONS.map((r) => [r.key, r]),
);
