'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import type { CompanySummary } from '@irm/shared';
import { Alert, Skeleton, cn } from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { CompanyStatusBadge } from '@/components/status';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { CompanyProvider } from './company-context';

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['companies', 'detail', id], queryFn: () => api.get<CompanySummary>(`/companies/${id}`) });

  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <BackLink />
        <Alert tone="danger" title={notFound ? 'Company not found' : 'Could not load company'}>
          {notFound ? 'It may not exist, or you may not have access to it.' : q.error.message}
        </Alert>
      </>
    );
  }
  if (q.isPending) {
    return (
      <>
        <BackLink />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="mt-8 h-48" />
      </>
    );
  }

  const c = q.data;
  const scope = { tenantId: c.tenantId, companyId: c.id };
  const base = `/companies/${c.id}`;
  const tabs = [
    { href: base, label: 'Overview', show: true },
    { href: `${base}/shareholders`, label: 'Shareholders', show: can('shareholder.read', scope) },
    { href: `${base}/imports`, label: 'Register imports', show: can('shareholder.import', scope) },
    { href: `${base}/authorizations`, label: 'Representatives & proxies', show: can('shareholder.read', scope) },
  ].filter((t) => t.show);

  return (
    <CompanyProvider value={c}>
      <BackLink />
      <PageHeader
        title={c.legalName}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {c.tenantName}
            {c.tradingCode && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{c.tradingCode}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <CompanyStatusBadge status={c.status} />
          </span>
        }
      />
      {tabs.length > 1 && (
        <nav aria-label="Company sections" className="-mt-3 mb-6 overflow-x-auto border-b border-line">
          <ul className="flex min-w-max gap-1">
            {tabs.map((t) => {
              const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
              return (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
                      active ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink',
                    )}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {children}
    </CompanyProvider>
  );
}

function BackLink() {
  return (
    <Link
      href="/companies"
      className="mb-4 inline-flex items-center gap-1 rounded text-sm text-ink-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
    >
      <ChevronLeft className="size-4" aria-hidden /> Companies
    </Link>
  );
}
