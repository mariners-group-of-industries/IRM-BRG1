import type { CompanySummary, TenantSummary } from '@irm/shared';

type CompanyRow = {
  id: string;
  tenantId: string;
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
  createdAt: Date;
  tenant: { name: string };
  _count?: { assignments: number };
};

export const companyInclude = {
  tenant: { select: { name: true } },
  _count: { select: { assignments: { where: { revokedAt: null } } } },
} as const;

export function toCompanySummary(c: CompanyRow): CompanySummary {
  return {
    id: c.id,
    tenantId: c.tenantId,
    tenantName: c.tenant.name,
    legalName: c.legalName,
    shortName: c.shortName,
    slug: c.slug,
    companyType: c.companyType,
    tradingCode: c.tradingCode,
    registrationNumber: c.registrationNumber,
    registeredAddress: c.registeredAddress,
    contactEmail: c.contactEmail,
    timezone: c.timezone,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    userCount: c._count?.assignments ?? 0,
  };
}

export function toTenantSummary(t: {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  _count: { companies: number };
}): TenantSummary {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    companyCount: t._count.companies,
    createdAt: t.createdAt.toISOString(),
  };
}
