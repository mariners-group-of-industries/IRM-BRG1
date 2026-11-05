import { Building2, LayoutDashboard, Network, ScrollText, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import type { Permission } from '@irm/shared';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user holds this permission anywhere. The API still enforces access per resource. */
  permission?: Permission;
  anyOf?: Permission[];
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
  {
    label: 'Organization',
    items: [
      { href: '/tenants', label: 'Tenants', icon: Network, permission: 'tenant.manage' },
      { href: '/companies', label: 'Companies', icon: Building2, permission: 'company.read' },
    ],
  },
  {
    label: 'Access',
    items: [
      { href: '/users', label: 'Users', icon: Users, permission: 'user.read' },
      { href: '/roles', label: 'Roles & permissions', icon: ShieldCheck },
      { href: '/audit', label: 'Audit log', icon: ScrollText, anyOf: ['audit.read', 'platform.audit.read'] },
    ],
  },
];
