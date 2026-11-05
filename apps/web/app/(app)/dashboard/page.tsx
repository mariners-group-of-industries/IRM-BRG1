'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Building2, ScrollText } from 'lucide-react';
import type { DashboardSummary } from '@irm/shared';
import { Alert, Button, EmptyState, Panel, PanelHeader, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { CompanyStatusBadge } from '@/components/status';
import { api } from '@/lib/api';
import { auditLabel, companyTypeLabel, formatNumber, formatRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Dhaka' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user, canAnywhere } = useSession();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('/dashboard/summary') });
  const firstName = user.fullName.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={q.data ? <>Showing {q.data.scopeLabel.toLowerCase() === 'all tenants' ? 'all tenants on the platform' : q.data.scopeLabel}</> : 'Loading your workspace'}
        actions={
          canAnywhere('company.create') && (
            <Button asChild>
              <Link href="/companies?new=1">New company</Link>
            </Button>
          )
        }
      />

      {q.isError && <Alert tone="danger" title="Could not load the overview">{q.error.message}</Alert>}

      <Stats data={q.data} />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader
            title="Recently added companies"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/companies">
                  View all <ArrowUpRight aria-hidden />
                </Link>
              </Button>
            }
          />
          {!q.data ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : q.data.recentCompanies.length === 0 ? (
            <EmptyState icon={<Building2 />} title="No companies yet" description="Companies you administer will appear here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Company</TH>
                  <TH className="hidden md:table-cell">Type</TH>
                  <TH className="hidden sm:table-cell">Tenant</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {q.data.recentCompanies.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/companies/${c.id}`} className="font-medium text-ink hover:text-accent focus-visible:underline focus-visible:outline-none">
                        {c.legalName}
                      </Link>
                      {c.tradingCode && <span className="ml-2 font-mono text-xs text-ink-3">{c.tradingCode}</span>}
                    </TD>
                    <TD className="hidden md:table-cell">{companyTypeLabel(c.companyType)}</TD>
                    <TD className="hidden sm:table-cell">{c.tenantName}</TD>
                    <TD>
                      <CompanyStatusBadge status={c.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Companies by type" />
          <div className="p-5">
            {!q.data ? (
              <Skeleton className="h-24" />
            ) : q.data.companiesByType.length === 0 ? (
              <p className="text-sm text-ink-3">No companies in scope.</p>
            ) : (
              <TypeBreakdown rows={q.data.companiesByType} total={q.data.counts.companies} />
            )}
          </div>
        </Panel>
      </div>

      {(canAnywhere('audit.read') || canAnywhere('platform.audit.read')) && (
        <Panel className="mt-6">
          <PanelHeader
            title="Recent activity"
            description="From the append-only audit log"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/audit">
                  Open audit log <ArrowUpRight aria-hidden />
                </Link>
              </Button>
            }
          />
          {!q.data ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6" />)}</div>
          ) : q.data.recentAudit.length === 0 ? (
            <EmptyState icon={<ScrollText />} title="No activity recorded yet" />
          ) : (
            <ul className="divide-y divide-line">
              {q.data.recentAudit.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <OutcomeDot outcome={a.outcome} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-ink">{auditLabel(a.action)}</span>
                    <span className="text-ink-3"> · {a.actorEmail ?? 'System'}</span>
                    {a.companyName && <span className="text-ink-3"> · {a.companyName}</span>}
                  </span>
                  <time dateTime={a.createdAt} className="shrink-0 text-xs text-ink-3 tabular">
                    {formatRelative(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}

function Stats({ data }: { data?: DashboardSummary }) {
  const items: { label: string; value: number | null; hint: string }[] = data
    ? [
        ...(data.counts.tenants !== null ? [{ label: 'Tenants', value: data.counts.tenants, hint: 'Corporate groups' }] : []),
        { label: 'Companies', value: data.counts.companies, hint: 'In your scope' },
        { label: 'Users', value: data.counts.users, hint: 'With active roles' },
        { label: 'Role assignments', value: data.counts.roleAssignments, hint: 'Active grants' },
      ]
    : [];
  return (
    <Panel className="overflow-hidden">
      <dl className={`grid gap-px bg-line ${!data || items.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"}`}>
        {!data
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-surface px-5 py-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-3 h-7 w-12" />
              </div>
            ))
          : items.map((s) => (
              <div key={s.label} className="bg-surface px-5 py-4">
                <dt className="text-[0.8125rem] text-ink-3">{s.label}</dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tracking-tight text-ink tabular">{formatNumber(s.value ?? 0)}</span>
                  <span className="hidden text-xs text-ink-4 sm:inline">{s.hint}</span>
                </dd>
              </div>
            ))}
      </dl>
    </Panel>
  );
}

function TypeBreakdown({ rows, total }: { rows: { companyType: string; count: number }[]; total: number }) {
  return (
    <ul className="flex flex-col gap-4">
      {rows
        .slice()
        .sort((a, b) => b.count - a.count)
        .map((r) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          return (
            <li key={r.companyType}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-ink-2">{companyTypeLabel(r.companyType)}</span>
                <span className="font-medium text-ink tabular">{r.count}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-subtle" role="presentation">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
    </ul>
  );
}

function OutcomeDot({ outcome }: { outcome: string }) {
  const tone = outcome === 'SUCCESS' ? 'bg-success' : outcome === 'DENIED' ? 'bg-warning' : 'bg-danger';
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" title={outcome.toLowerCase()}>
      <span className={`size-1.5 rounded-full ${tone}`} />
      <span className="sr-only">{outcome.toLowerCase()}</span>
    </span>
  );
}

