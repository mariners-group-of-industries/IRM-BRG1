'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, EyeOff } from 'lucide-react';
import type { HoldingDto, ShareholderDetail } from '@irm/shared';
import { Alert, Badge, EmptyState, Panel, PanelHeader, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatShares } from '@/lib/format';
import { useCompany } from '../../company-context';

export default function ShareholderPage() {
  const c = useCompany();
  const { sid } = useParams<{ sid: string }>();
  const q = useQuery({ queryKey: ['register', c.id, 'shareholder', sid], queryFn: () => api.get<ShareholderDetail>(`/companies/${c.id}/shareholders/${sid}`) });

  const back = (
    <Link href={`/companies/${c.id}/shareholders`} className="mb-4 inline-flex items-center gap-1 rounded text-sm text-ink-3 hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden /> All shareholders
    </Link>
  );
  if (q.isError) return (<>{back}<Alert tone="danger">{q.error.message}</Alert></>);
  if (q.isPending) return (<>{back}<Skeleton className="h-40" /></>);
  const s = q.data;

  return (
    <>
      {back}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{s.name}</h2>
          {s.nameBn && <p className="text-sm text-ink-3">{s.nameBn}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {s.type === 'CORPORATE' ? <Badge tone="info">Corporate</Badge> : <Badge>Individual</Badge>}
            {!s.piiVisible && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                <EyeOff className="size-3.5" aria-hidden /> Personal details are masked for your role
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-3">Current holding</p>
          <p className="text-2xl font-semibold tracking-tight text-ink tabular">{formatShares(s.totalShares)}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6">
          <Panel>
            <PanelHeader title="Accounts" description="BO accounts and folios" />
            <ul className="divide-y divide-line">
              {s.identities.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="text-ink-3">{i.kind === 'BO' ? 'BO ID' : 'Folio'}</span>
                  <span className="font-mono text-ink">{i.value}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title="Contacts" description="Where sign-in codes are sent" />
            {s.contacts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-3">No contact on the register. This shareholder cannot sign in until one is added.</p>
            ) : (
              <ul className="divide-y divide-line">
                {s.contacts.map((ct) => (
                  <li key={ct.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="text-ink-3">{ct.kind === 'PHONE' ? 'Mobile' : 'Email'}</span>
                    <span className="truncate text-ink">{ct.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <Panel>
            <PanelHeader title="Current holdings" />
            <HoldingsTable rows={s.currentHoldings} current />
          </Panel>
          <Panel>
            <PanelHeader title="History" description="Previous balances. History is kept permanently and cannot be edited." />
            {s.history.length === 0 ? <EmptyState title="No earlier balances" /> : <HoldingsTable rows={s.history} />}
          </Panel>
        </div>
      </div>
    </>
  );
}

function HoldingsTable({ rows, current }: { rows: HoldingDto[]; current?: boolean }) {
  if (rows.length === 0) return <EmptyState title="No current holding" />;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Account</TH>
          <TH>Class</TH>
          <TH className="text-right">Shares</TH>
          <TH className="hidden sm:table-cell">As of</TH>
          <TH className="hidden md:table-cell">{current ? 'Recorded' : 'Replaced'}</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((h) => (
          <TR key={h.id}>
            <TD className="font-mono text-xs">{h.identity}</TD>
            <TD>{h.shareClass}</TD>
            <TD className="text-right font-medium text-ink tabular">{formatShares(h.quantity)}</TD>
            <TD className="hidden sm:table-cell tabular">{formatDate(h.asOfDate)}</TD>
            <TD className="hidden md:table-cell tabular">{formatDateTime(current ? h.validFrom : h.validTo)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
