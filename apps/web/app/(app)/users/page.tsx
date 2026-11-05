'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import type { Paginated, UserSummary } from '@irm/shared';
import { Alert, Button, EmptyState, Input, Panel, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { ScopeBadge, UserStatusBadge } from '@/components/status';
import { api } from '@/lib/api';
import { formatDateTime, initials } from '@/lib/format';

export default function UsersPage() {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const q = useQuery({
    queryKey: ['users', debounced, page],
    queryFn: () => api.get<Paginated<UserSummary>>(`/users?q=${encodeURIComponent(debounced)}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts with a role in your scope. Add members from a company page."
      />
      <Panel>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input type="search" placeholder="Search name or email" aria-label="Search users" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {q.data && <p className="ml-auto text-xs text-ink-3 tabular">{q.data.total} users</p>}
        </div>
        {q.isError ? (
          <div className="p-5">
            <Alert tone="danger">{q.error.message}</Alert>
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<Users />} title="No users found" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Roles</TH>
                <TH className="hidden lg:table-cell">Last sign-in</TH>
                <TH className="hidden sm:table-cell">Status</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.items.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-ink-2 sm:flex">
                        {initials(u.fullName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{u.fullName}</p>
                        <p className="truncate text-xs text-ink-3">{u.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    {u.roles.length === 0 ? (
                      <span className="text-ink-4">No active role</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {u.roles.map((r) => (
                          <li key={r.assignmentId} className="flex flex-wrap items-center gap-1.5">
                            <ScopeBadge scope={r.scope} />
                            <span className="text-ink-2">{r.roleName}</span>
                            {r.scopeName && <span className="text-ink-3">· {r.scopeName}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell tabular">{formatDateTime(u.lastLoginAt)}</TD>
                  <TD className="hidden sm:table-cell">
                    <UserStatusBadge status={u.status} />
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
