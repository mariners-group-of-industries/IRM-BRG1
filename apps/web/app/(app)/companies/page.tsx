'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Building2, Plus, Search } from 'lucide-react';
import type { CompanySummary, Paginated } from '@irm/shared';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Input,
  Panel,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@irm/ui';
import { CreateCompanyForm } from '@/components/company-form';
import { PageHeader } from '@/components/shell/app-shell';
import { CompanyStatusBadge } from '@/components/status';
import { api } from '@/lib/api';
import { companyTypeLabel, formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';

const col = createColumnHelper<CompanySummary>();

const columns = [
  col.accessor('legalName', {
    header: 'Company',
    cell: (c) => (
      <div className="min-w-48">
        <Link href={`/companies/${c.row.original.id}`} className="font-medium text-ink hover:text-accent focus-visible:underline focus-visible:outline-none">
          {c.getValue()}
        </Link>
        <p className="text-xs text-ink-3">{c.row.original.shortName}</p>
      </div>
    ),
  }),
  col.accessor('tradingCode', {
    header: 'Code',
    cell: (c) => (c.getValue() ? <span className="font-mono text-xs text-ink-2">{c.getValue()}</span> : <span className="text-ink-4">—</span>),
    meta: { className: 'hidden md:table-cell' },
  }),
  col.accessor('companyType', { header: 'Type', cell: (c) => companyTypeLabel(c.getValue()), meta: { className: 'hidden lg:table-cell' } }),
  col.accessor('tenantName', { header: 'Tenant', meta: { className: 'hidden sm:table-cell' } }),
  col.accessor('userCount', { header: 'Members', cell: (c) => <span className="tabular">{c.getValue()}</span>, meta: { className: 'hidden md:table-cell text-right' } }),
  col.accessor('createdAt', { header: 'Added', cell: (c) => <span className="tabular">{formatDate(c.getValue())}</span>, meta: { className: 'hidden xl:table-cell' } }),
  col.accessor('status', { header: 'Status', cell: (c) => <CompanyStatusBadge status={c.getValue()} /> }),
];

type ColumnMeta = { className?: string };

function CompaniesView() {
  const router = useRouter();
  const params = useSearchParams();
  const { canAnywhere } = useSession();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);
  const creating = params.get('new') === '1';

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const q = useQuery({
    queryKey: ['companies', debounced, page],
    queryFn: () => api.get<Paginated<CompanySummary>>(`/companies?q=${encodeURIComponent(debounced)}&page=${page}&pageSize=25`),
    placeholderData: keepPreviousData,
  });

  const table = useReactTable({ data: q.data?.items ?? [], columns, getCoreRowModel: getCoreRowModel() });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const setCreating = (open: boolean) => router.replace(open ? '/companies?new=1' : '/companies', { scroll: false });

  return (
    <>
      <PageHeader
        title="Companies"
        description="Legal entities that hold annual and extraordinary general meetings."
        actions={
          canAnywhere('company.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New company
            </Button>
          )
        }
      />

      <Panel>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input
              type="search"
              placeholder="Search name or trading code"
              aria-label="Search companies"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {q.data && (
            <p className="ml-auto text-xs text-ink-3 tabular" aria-live="polite">
              {q.data.total} {q.data.total === 1 ? 'company' : 'companies'}
            </p>
          )}
        </div>

        {q.isError ? (
          <div className="p-5">
            <Alert tone="danger">{q.error.message}</Alert>
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title={debounced ? 'No companies match your search' : 'No companies yet'}
            description={debounced ? 'Try a different name or trading code.' : 'Create the first company to start preparing meetings.'}
          />
        ) : (
          <Table>
            <THead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <TH key={h.id} className={(h.column.columnDef.meta as ColumnMeta | undefined)?.className}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TH>
                  ))}
                </tr>
              ))}
            </THead>
            <TBody>
              {table.getRowModel().rows.map((row) => (
                <TR key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TD key={cell.id} className={(cell.column.columnDef.meta as ColumnMeta | undefined)?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {q.data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-3 tabular">
              Page {page} of {totalPages}
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

      <Dialog open={creating && canAnywhere('company.create')} onOpenChange={setCreating}>
        <DialogContent title="New company" description="Add a company to a tenant. You can assign administrators afterwards.">
          <CreateCompanyForm onDone={(c) => router.push(`/companies/${c.id}`)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function CompaniesPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-64" />}>
      <CompaniesView />
    </React.Suspense>
  );
}
