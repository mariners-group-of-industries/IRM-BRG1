import type { Permission } from './permissions.js';
import type { RoleScope } from './roles.js';

export interface SessionAssignment {
  roleKey: string;
  roleName: string;
  scope: RoleScope;
  tenantId: string | null;
  tenantName: string | null;
  companyId: string | null;
  companyName: string | null;
  permissions: Permission[];
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  assignments: SessionAssignment[];
}

export interface MeResponse {
  user: SessionUser;
  csrfToken: string;
}

export interface CompanySummary {
  id: string;
  tenantId: string;
  tenantName: string;
  legalName: string;
  shortName: string;
  slug: string;
  companyType: string;
  tradingCode: string | null;
  registrationNumber: string | null;
  registeredAddress: string | null;
  contactEmail: string | null;
  timezone: string;
  status: string;
  createdAt: string;
  userCount: number;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  companyCount: number;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  companyName: string | null;
  outcome: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  scopeLabel: string;
  counts: {
    tenants: number | null;
    companies: number;
    users: number;
    roleAssignments: number;
  };
  companiesByType: { companyType: string; count: number }[];
  recentCompanies: CompanySummary[];
  recentAudit: AuditEntry[];
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  status: string;
  lastLoginAt: string | null;
  roles: { assignmentId: string; roleName: string; scope: RoleScope; scopeName: string | null }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}
