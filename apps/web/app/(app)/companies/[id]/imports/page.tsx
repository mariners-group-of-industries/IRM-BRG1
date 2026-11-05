'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, History, UploadCloud } from 'lucide-react';
import type { ImportDto } from '@irm/shared';
import { Alert, EmptyState, Panel, PanelHeader, Skeleton, Table, TBody, TD, TH, THead, TR, cn } from '@irm/ui';
import { ImportStatusBadge } from '@/components/status';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useCompany } from '../company-context';

const MAX_BYTES = 25 * 1024 * 1024;

export default function ImportsPage() {
  const c = useCompany();
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const history = useQuery({ queryKey: ['register', c.id, 'imports'], queryFn: () => api.get<ImportDto[]>(`/companies/${c.id}/imports`) });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<ImportDto>(`/companies/${c.id}/imports`, form);
    },
    onSuccess: (imp) => router.push(`/companies/${c.id}/imports/${imp.id}`),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Upload failed. Check your connection and try again.'),
  });

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setError('Choose a .csv or .xlsx file.');
    if (file.size > MAX_BYTES) return setError('The file is larger than 25 MB.');
    upload.mutate(file);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Panel className="xl:col-span-1">
        <PanelHeader title="Import a register" description="CDBL or registrar export, CSV (UTF-8) or Excel .xlsx" />
        <div className="p-5">
          <label
            htmlFor="register-file"
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-accent/40',
              dragging ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-subtle/60',
              upload.isPending && 'pointer-events-none opacity-60',
            )}
          >
            <UploadCloud className="size-6 text-ink-3" aria-hidden />
            <span className="mt-2 text-sm font-medium text-ink">{upload.isPending ? 'Uploading…' : 'Choose a file or drop it here'}</span>
            <span className="mt-1 text-xs text-ink-3">Up to 25 MB and 200,000 rows</span>
            <input
              ref={inputRef}
              id="register-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
          <ol className="mt-5 space-y-2 text-[0.8125rem] text-ink-3">
            <li><span className="font-medium text-ink-2">1. Upload.</span> Nothing changes yet.</li>
            <li><span className="font-medium text-ink-2">2. Map columns and preview.</span> Every row is checked against the current register.</li>
            <li><span className="font-medium text-ink-2">3. Commit.</span> Holdings are versioned; earlier balances stay in history.</li>
          </ol>
          <p className="mt-4 text-xs text-ink-3">
            Keep BO ID columns formatted as text in Excel. Numbers longer than 15 digits lose precision.
          </p>
        </div>
      </Panel>

      <Panel className="xl:col-span-2">
        <PanelHeader title="Import history" />
        {history.isPending ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : history.isError ? (
          <div className="p-5"><Alert tone="danger">{history.error.message}</Alert></div>
        ) : history.data.length === 0 ? (
          <EmptyState icon={<History />} title="No imports yet" description="Uploaded registers and their outcome appear here." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>File</TH>
                <TH className="hidden md:table-cell">Rows</TH>
                <TH className="hidden lg:table-cell">As of</TH>
                <TH className="hidden sm:table-cell">Uploaded</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {history.data.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link href={`/companies/${c.id}/imports/${i.id}`} className="inline-flex items-center gap-2 font-medium text-ink hover:text-accent">
                      <FileSpreadsheet className="size-4 shrink-0 text-ink-3" aria-hidden />
                      <span className="max-w-[16rem] truncate">{i.fileName}</span>
                    </Link>
                    <p className="text-xs text-ink-3">{formatBytes(i.fileSize)}{i.mode && ` · ${i.mode === 'FULL' ? 'Full register' : 'Changes only'}`}</p>
                  </TD>
                  <TD className="hidden md:table-cell tabular">
                    {formatNumber(i.totalRows)}
                    {i.errorRows > 0 && <span className="ml-1 text-danger">({formatNumber(i.errorRows)} errors)</span>}
                  </TD>
                  <TD className="hidden lg:table-cell tabular">{formatDate(i.asOfDate)}</TD>
                  <TD className="hidden sm:table-cell">
                    <span className="tabular">{formatDateTime(i.createdAt)}</span>
                    {i.createdBy && <p className="text-xs text-ink-3">{i.createdBy}</p>}
                  </TD>
                  <TD><ImportStatusBadge status={i.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
