import { describe, expect, it } from 'vitest';
import { hasPermission, permissionsFor, type EffectiveAssignment } from './rbac.js';
import { ROLE_BY_KEY, ROLE_DEFINITIONS, type RoleKey } from './roles.js';
import { PERMISSIONS } from './permissions.js';

const perms = (key: RoleKey) => ROLE_BY_KEY.get(key)!.permissions;

const companyAdminA: EffectiveAssignment = {
  roleKey: 'COMPANY_ADMIN',
  scope: 'COMPANY',
  tenantId: 't1',
  companyId: 'cA',
  permissions: perms('COMPANY_ADMIN'),
};
const groupAdmin: EffectiveAssignment = {
  roleKey: 'COMPANY_ADMIN',
  scope: 'TENANT',
  tenantId: 't1',
  companyId: null,
  permissions: perms('COMPANY_ADMIN'),
};
const platform: EffectiveAssignment = {
  roleKey: 'PLATFORM_SUPER_ADMIN',
  scope: 'PLATFORM',
  tenantId: null,
  companyId: null,
  permissions: perms('PLATFORM_SUPER_ADMIN'),
};

describe('rbac', () => {
  it('company assignment covers only its own company', () => {
    expect(
      hasPermission([companyAdminA], PERMISSIONS.COMPANY_UPDATE, { tenantId: 't1', companyId: 'cA' }),
    ).toBe(true);
    expect(
      hasPermission([companyAdminA], PERMISSIONS.COMPANY_UPDATE, { tenantId: 't1', companyId: 'cB' }),
    ).toBe(false);
  });

  it('tenant assignment covers every company in the tenant but not other tenants', () => {
    expect(
      hasPermission([groupAdmin], PERMISSIONS.COMPANY_READ, { tenantId: 't1', companyId: 'cB' }),
    ).toBe(true);
    expect(
      hasPermission([groupAdmin], PERMISSIONS.COMPANY_READ, { tenantId: 't2', companyId: 'cX' }),
    ).toBe(false);
  });

  it('tenant assignment is not satisfied when the tenant id is missing', () => {
    expect(hasPermission([groupAdmin], PERMISSIONS.COMPANY_READ, { companyId: 'cB' })).toBe(false);
  });

  it('platform admin has no shareholder PII, ballot or voting permissions', () => {
    const scope = { tenantId: 't1', companyId: 'cA' };
    expect(hasPermission([platform], PERMISSIONS.SHAREHOLDER_PII_READ, scope)).toBe(false);
    expect(hasPermission([platform], PERMISSIONS.BALLOT_INDIVIDUAL_READ, scope)).toBe(false);
    expect(hasPermission([platform], PERMISSIONS.VOTE_CAST, scope)).toBe(false);
  });

  it('no role grants individual ballot access', () => {
    for (const r of ROLE_DEFINITIONS) {
      expect(r.permissions).not.toContain(PERMISSIONS.BALLOT_INDIVIDUAL_READ);
    }
  });

  it('company officials, moderators and board members cannot vote', () => {
    for (const key of ['COMPANY_OFFICIAL', 'MODERATOR', 'BOARD_MEMBER'] as const) {
      expect(perms(key)).not.toContain(PERMISSIONS.VOTE_CAST);
    }
  });

  it('permissionsFor unions only covering assignments', () => {
    const p = permissionsFor([companyAdminA, platform], { tenantId: 't2', companyId: 'cZ' });
    expect(p).toContain(PERMISSIONS.TENANT_MANAGE);
    expect(p).not.toContain(PERMISSIONS.SHAREHOLDER_IMPORT);
  });
});

import { canAssignRole } from './grants.js';

describe('role grants', () => {
  it('company admin can grant company staff roles in their company only', () => {
    expect(canAssignRole([companyAdminA], 'MODERATOR', { scope: 'COMPANY', tenantId: 't1', companyId: 'cA' })).toBe(true);
    expect(canAssignRole([companyAdminA], 'MODERATOR', { scope: 'COMPANY', tenantId: 't1', companyId: 'cB' })).toBe(false);
  });
  it('company admin cannot grant tenant, platform or participant roles', () => {
    expect(canAssignRole([companyAdminA], 'COMPANY_ADMIN', { scope: 'TENANT', tenantId: 't1' })).toBe(false);
    expect(canAssignRole([companyAdminA], 'PLATFORM_SUPER_ADMIN', { scope: 'PLATFORM' })).toBe(false);
    expect(canAssignRole([companyAdminA], 'SHAREHOLDER', { scope: 'COMPANY', tenantId: 't1', companyId: 'cA' })).toBe(false);
  });
  it('group admin can grant within any company of the group', () => {
    expect(canAssignRole([groupAdmin], 'MEETING_ADMIN', { scope: 'COMPANY', tenantId: 't1', companyId: 'cB' })).toBe(true);
    expect(canAssignRole([groupAdmin], 'MEETING_ADMIN', { scope: 'COMPANY', tenantId: 't2', companyId: 'cX' })).toBe(false);
  });
  it('platform admin can bootstrap company admins but not operational roles', () => {
    expect(canAssignRole([platform], 'COMPANY_ADMIN', { scope: 'COMPANY', tenantId: 't9', companyId: 'c9' })).toBe(true);
    expect(canAssignRole([platform], 'MEETING_ADMIN', { scope: 'COMPANY', tenantId: 't9', companyId: 'c9' })).toBe(false);
  });
});
