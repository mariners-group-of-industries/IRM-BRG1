import { assignmentCovers, type EffectiveAssignment, type ResourceScope } from './rbac.js';
import { ROLE_BY_KEY, type RoleKey } from './roles.js';

/**
 * True when the grantor holds an assignment that covers the target scope and
 * whose role lists `roleKey` in assignableRoles. A role assigned at company
 * scope can never grant at tenant or platform scope, because a company
 * assignment never covers a tenant-only or platform resource.
 */
export function canAssignRole(
  grantor: readonly EffectiveAssignment[],
  roleKey: RoleKey,
  target: ResourceScope & { scope: 'PLATFORM' | 'TENANT' | 'COMPANY' },
): boolean {
  return grantor.some((a) => {
    const def = ROLE_BY_KEY.get(a.roleKey as RoleKey);
    if (!def || !def.assignableRoles.includes(roleKey)) return false;
    if (!a.permissions.includes('role.assign')) return false;
    if (target.scope === 'PLATFORM') return a.scope === 'PLATFORM';
    if (target.scope === 'TENANT') return a.scope === 'PLATFORM' || (a.scope === 'TENANT' && a.tenantId === target.tenantId);
    return assignmentCovers(a, target);
  });
}

/** Role keys the grantor may assign somewhere (for building UI pickers). */
export function assignableRoleKeys(grantor: readonly EffectiveAssignment[]): RoleKey[] {
  const keys = new Set<RoleKey>();
  for (const a of grantor) {
    if (!a.permissions.includes('role.assign')) continue;
    ROLE_BY_KEY.get(a.roleKey as RoleKey)?.assignableRoles.forEach((k) => keys.add(k));
  }
  return [...keys];
}
