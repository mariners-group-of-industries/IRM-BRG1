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
  'share_class.create': 'Share class created',
  'shareholder.pii_view': 'Shareholder details viewed',
  'register_import.upload': 'Register uploaded',
  'register_import.validate': 'Register validated',
  'register_import.commit': 'Register import committed',
  'register_import.cancel': 'Register import cancelled',
  'corporate_rep.create': 'Representative added',
  'corporate_rep.approve': 'Representative approved',
  'corporate_rep.reject': 'Representative rejected',
  'corporate_rep.revoke': 'Representative revoked',
  'proxy.create': 'Proxy added',
  'proxy.approve': 'Proxy approved',
  'proxy.reject': 'Proxy rejected',
  'proxy.revoke': 'Proxy revoked',
  'authorization.document_download': 'Authorization document downloaded',
  'participant.otp_request': 'Sign-in code requested',
  'participant.otp_verify': 'Sign-in code rejected',
  'participant.login': 'Shareholder sign-in',
  'participant.access_revoked': 'Participant access removed',
  'auth.login_password': 'Password accepted',
  'auth.mfa_verify': 'Two-step code checked',
  'auth.mfa_setup_started': 'Two-step setup started',
  'auth.mfa_enabled': 'Two-step verification on',
  'auth.mfa_disabled': 'Two-step verification off',
  'auth.mfa_disable': 'Two-step disable failed',
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

/** Share counts arrive as strings (they can exceed 2^53). Formatted with South Asian grouping. */
export function formatShares(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—';
  try {
    return new Intl.NumberFormat('en-IN').format(BigInt(s));
  } catch {
    return s;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
