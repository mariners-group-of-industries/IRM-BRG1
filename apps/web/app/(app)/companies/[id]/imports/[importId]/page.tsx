'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ChevronLeft } from 'lucide-react';
import { IMPORT_FIELDS, type ImportDto, type ImportFieldKey, type ImportRowDto, type Paginated } from '@irm/shared';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Panel,
  PanelHeader,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  cn,
} from '@irm/ui';
import { ImportStatusBadge } from '@/components/status';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatNumber, formatShares } from '@/lib/format';
import { useCompany } from '../../company-context';

type Mode = 'FULL' | 'DELTA';

export default function ImportPage() {
  const c = useCompany();
  const { importId } = useParams<{ importId: string }>();
  const q = useQuery({ queryKey: ['register', c.id, 'import', importId], queryFn: () => api.get<ImportDto>(`/companies/${c.id}/imports/${importId}`) });

  const back = (
    <Link href={`/companies/${c.id}/imports`} className="mb-4 inline-flex items-center gap-1 rounded text-sm text-ink-3 hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden /> Import history
    </Link>
  );
  if (q.isError) return (<>{back}<Alert tone="danger">{q.error.message}</Alert></>);
  if (q.isPending) return (<>{back}<Skeleton className="h-64" /></>);
  const imp = q.data;

  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{imp.fileName}</h2>
          <p className="text-sm text-ink-3 tabular">
            {formatNumber(imp.totalRows)} rows · uploaded {formatDateTime(imp.createdAt)}
            {imp.createdBy && ` by ${imp.createdBy}`}
          </p>
        </div>
        <ImportStatusBadge status={imp.status} />
      </div>
      <Steps status={imp.status} />
      {imp.status === 'COMMITTED' ? (
        <Committed imp={imp} />
      ) : imp.status === 'CANCELLED' ? (
        <Alert tone="info" title="This import was cancelled">The register was not changed. Upload the file again to start over.</Alert>
      ) : (
        <>
          <MappingStep imp={imp} />
          {imp.status === 'VALIDATED' && <PreviewStep imp={imp} />}
        </>
      )}
    </>
  );
}

function Steps({ status }: { status: ImportDto['status'] }) {
  const current = status === 'UPLOADED' ? 1 : status === 'VALIDATED' ? 2 : 3;
  const steps = ['Map columns', 'Review changes', 'Committed'];
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" aria-label="Import progress">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current || status === 'COMMITTED';
        return (
          <li key={s} className="flex items-center gap-2" aria-current={n === current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                done ? 'bg-accent text-white' : n === current ? 'bg-accent-soft text-accent-ink ring-1 ring-accent' : 'bg-subtle text-ink-3',
              )}
            >
              {done ? '✓' : n}
            </span>
            <span className={n === current ? 'font-medium text-ink' : 'text-ink-3'}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function MappingStep({ imp }: { imp: ImportDto }) {
  const c = useCompany();
  const qc = useQueryClient();
  const [mapping, setMapping] = React.useState<Partial<Record<ImportFieldKey, string>>>(imp.mapping ?? imp.suggestedMapping);
  const [mode, setMode] = React.useState<Mode>(imp.mode ?? 'DELTA');
  const [asOfDate, setAsOfDate] = React.useState(imp.asOfDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()));
  const [error, setError] = React.useState<string | null>(null);

  const validate = useMutation({
    mutationFn: () => api.post<ImportDto>(`/companies/${c.id}/imports/${imp.id}/validate`, { mapping: clean(mapping), mode, asOfDate }),
    onSuccess: (d) => {
      qc.setQueryData(['register', c.id, 'import', imp.id], { ...d, sampleRows: imp.sampleRows });
      qc.invalidateQueries({ queryKey: ['register', c.id, 'import', imp.id, 'rows'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fieldErrors).flat()[0] ?? e.message) : 'Validation failed'),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/companies/${c.id}/imports/${imp.id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['register', c.id] }),
  });

  return (
    <Panel className="mb-6">
      <PanelHeader title="1. Map columns" description="Match each field to a column in your file. Suggested matches are filled in." />
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-3">
          {IMPORT_FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-3">
              <label htmlFor={`map-${f.key}`} className="text-sm text-ink-2">
                {f.label}
                {f.required && <span className="block text-xs text-ink-4">Required</span>}
              </label>
              <Select
                id={`map-${f.key}`}
                value={mapping[f.key] ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
              >
                <option value="">{f.required ? 'Select a column' : 'Not in file'}</option>
                {imp.headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </Select>
            </div>
          ))}
          <p className="text-xs text-ink-3">Map a BO ID or a folio column, plus the holder name and number of shares.</p>
        </div>

        <div className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">What does this file contain?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ['DELTA', 'Changes only', 'Only accounts in the file are added or updated.'],
                ['FULL', 'The full register', 'Accounts missing from the file have their holdings closed.'],
              ] as const).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40',
                    mode === value ? 'border-accent bg-accent-soft/50' : 'border-line-strong hover:bg-subtle/60',
                  )}
                >
                  <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-0.5 accent-[var(--color-accent)]" />
                  <span>
                    <span className="block font-medium text-ink">{title}</span>
                    <span className="text-xs text-ink-3">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Register date" htmlFor="asOfDate" hint="The date the register reflects, for example the record date of the export.">
            <Input id="asOfDate" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="max-w-48" />
          </Field>

          {imp.sampleRows.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">First rows of the file</p>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-subtle/60">
                    <tr>{imp.headers.map((h) => <th key={h} scope="col" className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-ink-3">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {imp.sampleRows.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {imp.headers.map((h) => <td key={h} className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">{r[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      {error && <div className="px-5 pb-4"><Alert tone="danger">{error}</Alert></div>}
      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => window.confirm('Cancel this import? The register will not change.') && cancel.mutate()} loading={cancel.isPending}>
          Cancel import
        </Button>
        <Button onClick={() => validate.mutate()} loading={validate.isPending}>
          {imp.status === 'VALIDATED' ? 'Check again' : 'Check rows'}
        </Button>
      </div>
    </Panel>
  );
}

const clean = (m: Partial<Record<ImportFieldKey, string>>) => Object.fromEntries(Object.entries(m).filter(([, v]) => !!v));

const FILTERS = [
  { key: '', label: 'All rows' },
  { key: 'ERROR', label: 'Errors' },
  { key: 'NEW', label: 'New' },
  { key: 'CHANGED', label: 'Changed' },
  { key: 'UNCHANGED', label: 'Unchanged' },
  { key: 'CLOSED', label: 'Closed' },
] as const;

function PreviewStep({ imp }: { imp: ImportDto }) {
  const c = useCompany();
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<string>(imp.errorRows > 0 ? 'ERROR' : '');
  const [page, setPage] = React.useState(1);
  const [acceptErrors, setAcceptErrors] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const s = imp.summary!;

  const rows = useQuery({
    queryKey: ['register', c.id, 'import', imp.id, 'rows', filter, page, imp.validatedAt],
    queryFn: () => api.get<Paginated<ImportRowDto>>(`/companies/${c.id}/imports/${imp.id}/rows?filter=${filter}&page=${page}`),
    placeholderData: keepPreviousData,
  });

  const commit = useMutation({
    mutationFn: () => api.post<ImportDto>(`/companies/${c.id}/imports/${imp.id}/commit`, { acceptErrors }),
    onSuccess: () => {
      toast.success('Register updated');
      qc.invalidateQueries({ queryKey: ['register', c.id] });
    },
    onError: (e) => setError(e.message),
  });

  const counts: Record<string, number> = { '': imp.totalRows + s.closed, ERROR: imp.errorRows, NEW: s.new, CHANGED: s.changed, UNCHANGED: s.unchanged, CLOSED: s.closed };
  const blocked = imp.errorRows > 0 && (imp.mode === 'FULL' || !acceptErrors);
  const nothingToDo = s.new + s.changed + s.closed === 0;
  const totalPages = rows.data ? Math.max(1, Math.ceil(rows.data.total / rows.data.pageSize)) : 1;

  return (
    <Panel>
      <PanelHeader title="2. Review changes" description={`Checked against the current register at ${formatDateTime(imp.validatedAt)}.`} />
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
        {[
          ['New accounts', s.new, 'accent'],
          ['Changed', s.changed, 'info'],
          ['Unchanged', s.unchanged, 'neutral'],
          ['Holdings closed', s.closed, 'warning'],
          ['Rows with errors', imp.errorRows, 'danger'],
        ].map(([label, n, tone]) => (
          <div key={label as string} className="bg-surface px-5 py-3">
            <p className="text-xs text-ink-3">{label}</p>
            <p className={cn('text-lg font-semibold tabular', tone === 'danger' && (n as number) > 0 ? 'text-danger' : 'text-ink')}>{formatNumber(n as number)}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="tablist" aria-label="Filter rows">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => (setFilter(f.key), setPage(1))}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
              filter === f.key ? 'bg-subtle font-medium text-ink' : 'text-ink-3 hover:text-ink',
            )}
          >
            {f.label} <span className="text-ink-4 tabular">{formatNumber(counts[f.key] ?? 0)}</span>
          </button>
        ))}
      </div>

      {rows.isPending ? (
        <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : rows.isError ? (
        <div className="p-5"><Alert tone="danger">{rows.error.message}</Alert></div>
      ) : rows.data.items.length === 0 ? (
        <EmptyState title="No rows in this view" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH className="w-16">Row</TH>
              <TH>Account</TH>
              <TH>Holder</TH>
              <TH className="text-right">Shares</TH>
              <TH>Result</TH>
            </tr>
          </THead>
          <TBody>
            {rows.data.items.map((r) => (
              <TR key={r.rowNumber} className={r.status === 'ERROR' ? 'bg-danger-soft/40' : undefined}>
                <TD className="tabular text-ink-3">{r.action === 'CLOSED' ? '—' : r.rowNumber}</TD>
                <TD className="font-mono text-xs">{r.identifier ?? '—'}</TD>
                <TD className="max-w-[14rem] truncate">{r.name ?? <span className="text-ink-4">—</span>}</TD>
                <TD className="text-right tabular">
                  {r.previousShares !== null && r.previousShares !== r.shares && (
                    <span className="mr-1 text-ink-4 line-through">{formatShares(r.previousShares)}</span>
                  )}
                  {formatShares(r.shares)}
                </TD>
                <TD className="min-w-[14rem]">
                  <RowResult row={r} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {rows.data && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
          <span className="text-ink-3 tabular">Page {page} of {formatNumber(totalPages)}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        {imp.errorRows > 0 && imp.mode === 'FULL' && (
          <Alert tone="warning" title="Fix the errors before committing a full register">
            A full register replaces the current one, so every row must be valid. Correct the file and upload it again.
          </Alert>
        )}
        {imp.errorRows > 0 && imp.mode === 'DELTA' && (
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={acceptErrors} onChange={(e) => setAcceptErrors(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
            Skip {imp.errorRows === 1 ? "1 row" : `${formatNumber(imp.errorRows)} rows`} with errors and import the rest.
          </label>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3">Committing records a new version of each changed holding. Earlier balances remain in history.</p>
          <Button
            disabled={blocked || nothingToDo}
            loading={commit.isPending}
            onClick={() => {
              const msg = `Apply ${formatNumber(s.new)} new, ${formatNumber(s.changed)} changed and ${formatNumber(s.closed)} closed holdings to the register?`;
              if (window.confirm(msg)) commit.mutate();
            }}
          >
            {nothingToDo ? 'No changes to commit' : 'Commit to register'}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function RowResult({ row }: { row: ImportRowDto }) {
  const badge = {
    NEW: <Badge tone="accent">New</Badge>,
    CHANGED: <Badge tone="info">Changed</Badge>,
    UNCHANGED: <Badge>Unchanged</Badge>,
    CLOSED: <Badge tone="warning">Closed</Badge>,
    NONE: <Badge tone="danger">Error</Badge>,
  }[row.action];
  return (
    <div className="flex flex-col gap-1">
      <div>{badge}</div>
      {row.errors.map((e) => <p key={e} className="text-xs text-danger">{e}</p>)}
      {row.warnings.map((w) => <p key={w} className="text-xs text-warning">{w}</p>)}
    </div>
  );
}

function Committed({ imp }: { imp: ImportDto }) {
  const c = useCompany();
  return (
    <Panel>
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <p className="mt-3 text-base font-semibold text-ink">Register updated</p>
        <p className="mt-1 max-w-md text-sm text-ink-3">
          Committed {formatDateTime(imp.committedAt)}{imp.committedBy && ` by ${imp.committedBy}`}.
          {imp.summary && ` ${formatNumber(imp.summary.new)} new, ${formatNumber(imp.summary.changed)} changed and ${formatNumber(imp.summary.closed)} closed holdings.`}
        </p>
        <Button asChild className="mt-5">
          <Link href={`/companies/${c.id}/shareholders`}>View shareholders</Link>
        </Button>
      </div>
    </Panel>
  );
}
