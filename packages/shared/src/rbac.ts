import type { Permission } from './permissions.js';
import type { RoleScope } from './roles.js';

/** A role assignment, flattened with the permissions of its role. */
export interface EffectiveAssignment {
  roleKey: string;
  scope: RoleScope;
  tenantId: string | null;
  companyId: string | null;
  permissions: readonly Permission[];
}

/** The resource being acted upon. Omit ids for platform-level operations. */
export interface ResourceScope {
  tenantId?: string | null;
  companyId?: string | null;
}

/**
 * Pure RBAC decision function shared by the API guard and the web UI.
 *
 * Rules:
 * 1. PLATFORM assignments apply everywhere, but only carry platform permissions.
 *    The role catalogue never gives platform roles shareholder PII or ballots.
 * 2. TENANT assignments apply to the tenant itself and every company whose tenantId matches.
 * 3. COMPANY assignments apply only to that exact company.
 * 4. A company-scoped check must supply the company's tenantId so that tenant
 *    assignments can be evaluated. Callers resolve it from the database, never from the client.
 */
export function assignmentCovers(a: EffectiveAssignment, resource: ResourceScope): boolean {
  switch (a.scope) {
    case 'PLATFORM':
      return true;
    case 'TENANT':
      return a.tenantId !== null && resource.tenantId != null && a.tenantId === resource.tenantId;
    case 'COMPANY':
      return (
        a.companyId !== null && resource.companyId != null && a.companyId === resource.companyId
      );
    default:
      return false;
  }
}

export function hasPermission(
  assignments: readonly EffectiveAssignment[],
  permission: Permission,
  resource: ResourceScope = {},
): boolean {
  return assignments.some(
    (a) => a.permissions.includes(permission) && assignmentCovers(a, resource),
  );
}

/** True when the user holds the permission anywhere (used for navigation only, never for data access). */
export function hasPermissionAnywhere(
  assignments: readonly EffectiveAssignment[],
  permission: Permission,
): boolean {
  return assignments.some((a) => a.permissions.includes(permission));
}

/** Union of permissions the user holds for a given resource. */
export function permissionsFor(
  assignments: readonly EffectiveAssignment[],
  resource: ResourceScope = {},
): Permission[] {
  const set = new Set<Permission>();
  for (const a of assignments) {
    if (assignmentCovers(a, resource)) a.permissions.forEach((p) => set.add(p));
  }
  return [...set].sort();
}
