'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, LogOut } from 'lucide-react';
import type { ParticipantMe, ParticipantRepresentation } from '@irm/shared';
import { Alert, Badge, Button, Panel, Skeleton } from '@irm/ui';
import { BrandMark } from '@/components/brand';
import { api, setCsrfToken } from '@/lib/api';
import { formatDate, formatShares } from '@/lib/format';
import { useMe } from '@/lib/session';

/** Home for shareholders, corporate representatives and proxies. */
export default function PortalPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const isParticipant = me.data?.user.kind === 'PARTICIPANT';
  const data = useQuery({ queryKey: ['participant-me'], queryFn: () => api.get<ParticipantMe[]>('/participant/me'), enabled: isParticipant });

  React.useEffect(() => {
    if (me.data && !isParticipant) router.replace('/dashboard');
  }, [me.data, isParticipant, router]);

  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrfToken(null);
      qc.clear();
      router.replace(data.data?.[0] ? `/join/${data.data[0].company.id}` : '/login');
    }
  };

  const first = data.data?.[0];
  return (
    <div className="min-h-dvh bg-canvas text-[0.9375rem]">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{first?.company.legalName ?? 'Shareholder portal'}</p>
              <p className="truncate text-xs text-ink-3">{me.data?.user.fullName}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut aria-hidden /> Sign out
          </Button>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        {me.isPending || data.isPending ? (
          <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>
        ) : data.isError ? (
          <Alert tone="danger">{data.error.message}</Alert>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Welcome, {me.data?.user.fullName}</h1>
            <p className="mt-1 text-ink-3">স্বাগতম। আপনার শেয়ারধারণ ও সভার তথ্য এখানে দেখুন।</p>

            <Panel className="mt-6">
              <div className="flex items-start gap-3 px-5 py-4">
                <CalendarClock className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                <div>
                  <p className="font-medium text-ink">Meetings</p>
                  <p className="text-sm text-ink-3">No meeting is open for registration yet. When the company publishes an AGM or EGM notice, it will appear here.</p>
                </div>
              </div>
            </Panel>

            {data.data.map((m) => (
              <section key={m.company.id} className="mt-8">
                <h2 className="mb-3 text-sm font-medium text-ink-3">
                  {data.data.length > 1 ? m.company.legalName : 'You can participate for'}
                </h2>
                {m.representations.length === 0 ? (
                  <Alert tone="warning">Your authorization is no longer active. Contact the company secretary.</Alert>
                ) : (
                  <div className="flex flex-col gap-4">
                    {m.representations.map((r, i) => <Representation key={i} r={r} />)}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

function Representation({ r }: { r: ParticipantRepresentation }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={r.kind === 'SHAREHOLDER' ? 'accent' : 'info'}>{r.label}</Badge>
            {r.scope && <Badge>{r.scope === 'ATTEND_AND_VOTE' ? 'May attend and vote' : 'May attend only'}</Badge>}
          </div>
          <p className="mt-2 text-base font-semibold text-ink">{r.shareholderName}</p>
          {r.meetingReference && <p className="text-sm text-ink-3">For: {r.meetingReference}</p>}
          {r.validUntil && <p className="text-sm text-ink-3">Valid until {formatDate(r.validUntil)}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-3">Total shares · মোট শেয়ার</p>
          <p className="text-2xl font-semibold tracking-tight text-ink tabular">{formatShares(r.totalShares)}</p>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {r.identities.map((i) => (
          <li key={i.value} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="text-ink-3">
              {i.kind === 'BO' ? 'BO ID' : 'Folio'} <span className="font-mono text-ink-2">{i.value}</span>
            </span>
            <span className="text-ink tabular">
              {i.shares.length === 0 ? '0' : i.shares.map((s) => `${formatShares(s.quantity)} ${s.shareClass}`).join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
