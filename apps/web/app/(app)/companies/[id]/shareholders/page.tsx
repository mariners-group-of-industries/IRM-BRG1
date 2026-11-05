'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EyeOff, Search, Upload, Users } from 'lucide-react';
import type { Paginated, RegisterSummary, ShareholderListItem } from '@irm/shared';
import { Alert, Badge, Button, EmptyState, Input, Panel, Select, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { api } from '@/lib/api';
import { formatDate, formatNumber, formatShares } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../company-context';

export default function ShareholdersPage() {
  const c = useCompany();
  const { can } = useSession();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [type, setType] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const summary = useQuery({ queryKey: ['register', c.id, 'summary'], queryFn: () => api.get<RegisterSummary>(`/companies/${c.id}/register/summary`) });
  const q = useQuery({
    queryKey: ['register', c.id, 'shareholders', debounced, type, page],
    queryFn: () =>
      api.get<Paginated<ShareholderListItem>>(`/companies/${c.id}/shareholders?q=${encodeURIComponent(debounced)}&type=${type}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const masked = q.data?.items.some((s) => s.identities.some((i) => i.masked));

  return (
    <>
      <RegisterStats summary={summary.data} />

      <Panel className="mt-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input
              type="search"
              placeholder="Name, BO ID or folio"
              aria-label="Search shareholders"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select aria-label="Holder type" className="w-auto min-w-40" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
            <option value="">All holders</option>
            <option value="INDIVIDUAL">Individuals</option>
            <option value="CORPORATE">Corporate</option>
          </Select>
          {masked && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
              <EyeOff className="size-3.5" aria-hidden /> Account numbers are masked for your role
            </span>
          )}
          {q.data && <p className="ml-auto text-xs text-ink-3 tabular">{formatNumber(q.data.total)} shareholders</p>}
        </div>

        {q.isError ? (
          <div className="p-5">
            <Alert tone="danger">{q.error.message}</Alert>
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={debounced || type ? 'No shareholders match' : 'The register is empty'}
            description={debounced || type ? 'Try another name or account number.' : 'Import the shareholder register to get started.'}
            action={
              !debounced && !type && can('shareholder.import', c.scope) ? (
                <Button asChild>
                  <Link href={`/companies/${c.id}/imports`}>
                    <Upload aria-hidden /> Import register
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Shareholder</TH>
                <TH className="hidden md:table-cell">Accounts</TH>
                <TH className="hidden sm:table-cell">Type</TH>
                <TH className="text-right">Shares</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <Link
                      href={`/companies/${c.id}/shareholders/${s.id}`}
                      className="font-medium text-ink hover:text-accent focus-visible:underline focus-visible:outline-none"
                    >
                      {s.name}
                    </Link>
                    {s.nameBn && <p className="text-xs text-ink-3">{s.nameBn}</p>}
                  </TD>
                  <TD className="hidden md:table-cell">
                    <ul className="flex flex-col gap-0.5">
                      {s.identities.slice(0, 3).map((i) => (
                        <li key={i.id} className="font-mono text-xs text-ink-2">
                          <span className="text-ink-4">{i.kind === 'BO' ? 'BO' : 'Folio'}</span> {i.value}
                        </li>
                      ))}
                      {s.identities.length > 3 && <li className="text-xs text-ink-3">+{s.identities.length - 3} more</li>}
                    </ul>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {s.type === 'CORPORATE' ? <Badge tone="info">Corporate</Badge> : <span className="text-ink-3">Individual</span>}
                  </TD>
                  <TD className="text-right font-medium text-ink tabular">{formatShares(s.totalShares)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {q.data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-3 tabular">
              Page {page} of {formatNumber(totalPages)}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}

function RegisterStats({ summary }: { summary?: RegisterSummary }) {
  const ord = summary?.byClass ?? [];
  const totalShares = ord.reduce((sum, c) => sum + BigInt(c.totalShares), 0n).toString();
  const items = summary
    ? [
        { label: 'Shareholders', value: formatNumber(summary.shareholders) },
        { label: 'BO / folio accounts', value: formatNumber(summary.identities) },
        { label: 'Shares on register', value: formatShares(totalShares) },
        { label: 'Register as of', value: summary.lastImport?.asOfDate ? formatDate(summary.lastImport.asOfDate) : '—' },
      ]
    : [];
  return (
    <Panel className="overflow-hidden">
      <dl className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
        {!summary
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-surface px-5 py-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-6 w-16" />
              </div>
            ))
          : items.map((s) => (
              <div key={s.label} className="bg-surface px-5 py-4">
                <dt className="text-[0.8125rem] text-ink-3">{s.label}</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight text-ink tabular">{s.value}</dd>
              </div>
            ))}
      </dl>
    </Panel>
  );
}
