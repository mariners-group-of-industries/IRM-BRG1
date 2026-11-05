import { COMPANY_TYPE_LABELS, type CompanyType } from '@irm/shared';

const TZ = 'Asia/Dhaka';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).format(
    new Date(iso),
  );
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return formatDate(iso);
}

export const formatNumber = (n: number) => new Intl.NumberFormat('en-IN').format(n);

export function companyTypeLabel(t: string): string {
  return COMPANY_TYPE_LABELS[t as CompanyType] ?? t;
}

/** Human labels for audit actions. Unknown actions fall back to the raw key. */
const AUDIT_LABELS: Record<string, string> = {
  'auth.login': 'Sign-in',
  'auth.logout': 'Sign-out',
  'access.denied': 'Access denied',
  'tenant.create': 'Tenant created',
  'tenant.update': 'Tenant updated',
  'company.create': 'Company created',
  'company.update': 'Company updated',
  'user.create': 'User created',
  'user.disable': 'User disabled',
  'role.assign': 'Role granted',
  'role.revoke': 'Role revoked',
};
export const auditLabel = (a: string) => AUDIT_LABELS[a] ?? a;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
