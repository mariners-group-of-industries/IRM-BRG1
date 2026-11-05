'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import type { AuditEntry, Paginated } from '@irm/shared';
import { Alert, Button, EmptyState, Panel, Select, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { OutcomeBadge } from '@/components/status';
import { api } from '@/lib/api';
import { auditLabel, formatDateTime } from '@/lib/format';

const FILTERS = [
  { value: '', label: 'All events' },
  { value: 'auth.', label: 'Sign-in and sign-out' },
  { value: 'access.', label: 'Access denied' },
  { value: 'role.', label: 'Role changes' },
  { value: 'company.', label: 'Company changes' },
  { value: 'tenant.', label: 'Tenant changes' },
  { value: 'user.', label: 'User changes' },
];

export default function AuditPage() {
  const [action, setAction] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useQuery({
    queryKey: ['audit', action, page],
    queryFn: () => api.get<Paginated<AuditEntry>>(`/audit?page=${page}&action=${encodeURIComponent(action)}`),
    placeholderData: keepPreviousData,
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, permission denial and administrative change. Entries cannot be edited or deleted, including by administrators."
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Select
            aria-label="Filter events"
            className="w-auto min-w-52"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          {q.data && <p className="ml-auto text-xs text-ink-3 tabular">{q.data.total} events</p>}
        </div>
        {q.isError ? (
          <div className="p-5">
            <Alert tone="danger">{q.error.message}</Alert>
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No events" description="Nothing matches this filter in your scope." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Event</TH>
                <TH className="hidden md:table-cell">Actor</TH>
                <TH className="hidden lg:table-cell">Company</TH>
                <TH className="hidden xl:table-cell">IP address</TH>
                <TH>Outcome</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((a) => (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap tabular text-ink-3">{formatDateTime(a.createdAt)}</TD>
                  <TD>
                    <p className="font-medium text-ink">{auditLabel(a.action)}</p>
                    <p className="text-xs text-ink-3 md:hidden">{a.actorEmail ?? 'System'}</p>
                  </TD>
                  <TD className="hidden md:table-cell">{a.actorEmail ?? 'System'}</TD>
                  <TD className="hidden lg:table-cell">{a.companyName ?? <span className="text-ink-4">—</span>}</TD>
                  <TD className="hidden font-mono text-xs xl:table-cell">{a.ipAddress ?? '—'}</TD>
                  <TD>
                    <OutcomeBadge outcome={a.outcome} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {q.data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-3 tabular">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
