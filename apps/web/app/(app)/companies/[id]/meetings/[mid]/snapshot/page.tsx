'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Camera, Search } from 'lucide-react';
import type { EntitlementDto, Paginated, SnapshotSummary } from '@irm/shared';
import { Alert, Badge, Button, EmptyState, Input, Panel, PanelHeader, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber, formatShares } from '@/lib/format';
import { useCompany } from '../../../company-context';
import { useMeeting } from '../meeting-context';

export default function SnapshotPage() {
  const c = useCompany();
  const m = useMeeting();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => (setDebounced(search.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [search]);
  const base = `/companies/${c.id}/meetings/${m.id}`;
  const summary = useQuery({ queryKey: ['meetings', c.id, m.id, 'snapshot', m.version], queryFn: () => api.get<SnapshotSummary>(`${base}/snapshot`) });
  const ents = useQuery({
    queryKey: ['meetings', c.id, m.id, 'entitlements', debounced, page, m.version],
    queryFn: () => api.get<Paginated<EntitlementDto>>(`${base}/entitlements?q=${encodeURIComponent(debounced)}&page=${page}`),
    enabled: !!m.snapshotTakenAt,
    placeholderData: keepPreviousData,
  });
  const totalPages = ents.data ? Math.max(1, Math.ceil(ents.data.total / ents.data.pageSize)) : 1;

  if (summary.isPending) return <Skeleton className="h-40" />;
  if (summary.isError) return <Alert tone="danger">{summary.error.message}</Alert>;
  const s = summary.data;

  if (!s.takenAt) {
    return (
      <Panel>
        <EmptyState
          icon={<Camera />}
          title="No snapshot yet"
          description={`When registration opens, holdings on the record date (${formatDate(s.recordDate)}) are frozen here and become the voting entitlements for this meeting.${s.registerAsOf ? ` The latest register is dated ${formatDate(s.registerAsOf)}.` : ' No register has been imported yet.'}`}
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          {[
            ['Holders on record date', formatNumber(s.holders)],
            ['Accounts', formatNumber(s.accounts)],
            ['Shares', formatShares(s.totalShares)],
            ['Votes', formatShares(s.totalVotes)],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-5 py-4">
              <dt className="text-[0.8125rem] text-ink-3">{k}</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight text-ink tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line px-5 py-2.5 text-xs text-ink-3">
          Frozen {formatDateTime(s.takenAt)} from holdings dated on or before {formatDate(s.recordDate)}. This record cannot be changed.
          {s.byClass.length > 1 && ` ${s.byClass.map((b) => `${b.code}: ${b.votesPerShare} vote${b.votesPerShare === 1 ? '' : 's'} per share`).join(' · ')}`}
        </p>
      </Panel>

      <Panel>
        <PanelHeader title="Entitlements" description="One row per account and share class" />
        <div className="border-b border-line px-4 py-3">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input type="search" placeholder="Search holder name" aria-label="Search entitlements" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {ents.isPending ? <Skeleton className="m-5 h-24" /> : ents.isError ? <div className="p-5"><Alert tone="danger">{ents.error.message}</Alert></div> : ents.data.items.length === 0 ? (
          <EmptyState title="No matching entitlements" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Holder</TH>
                <TH className="hidden md:table-cell">Account</TH>
                <TH className="text-right">Shares</TH>
                <TH className="hidden sm:table-cell text-right">Votes</TH>
                <TH>Registered</TH>
              </tr>
            </THead>
            <TBody>
              {ents.data.items.map((e) => (
                <TR key={e.id}>
                  <TD className="font-medium text-ink">{e.shareholderName}</TD>
                  <TD className="hidden md:table-cell font-mono text-xs">{e.account} · {e.shareClass}</TD>
                  <TD className="text-right tabular">{formatShares(e.shares)}</TD>
                  <TD className="hidden sm:table-cell text-right tabular">{formatShares(e.votes)}</TD>
                  <TD>{e.registered ? <Badge tone="success" dot>Yes</Badge> : <span className="text-ink-4">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {ents.data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-3 tabular">Page {page} of {formatNumber(totalPages)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
