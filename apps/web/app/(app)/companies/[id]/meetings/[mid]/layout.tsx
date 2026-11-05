'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, MapPin, Video } from 'lucide-react';
import type { MeetingDetail } from '@irm/shared';
import { Alert, Skeleton, cn } from '@irm/ui';
import { MeetingStateBadge } from '@/components/status';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../../company-context';
import { MeetingProvider, meetingKey } from './meeting-context';

export default function MeetingLayout({ children }: { children: React.ReactNode }) {
  const c = useCompany();
  const { can } = useSession();
  const { mid } = useParams<{ mid: string }>();
  const pathname = usePathname();
  const q = useQuery({ queryKey: meetingKey(c.id, mid), queryFn: () => api.get<MeetingDetail>(`/companies/${c.id}/meetings/${mid}`) });

  const back = (
    <Link href={`/companies/${c.id}/meetings`} className="mb-4 inline-flex items-center gap-1 rounded text-sm text-ink-3 hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden /> All meetings
    </Link>
  );
  if (q.isError) return (<>{back}<Alert tone="danger">{q.error.message}</Alert></>);
  if (q.isPending) return (<>{back}<Skeleton className="h-24" /></>);
  const m = q.data;
  const base = `/companies/${c.id}/meetings/${m.id}`;
  const tabs = [
    { href: base, label: 'Control' },
    { href: `${base}/details`, label: 'Notice & rules' },
    { href: `${base}/agenda`, label: 'Agenda' },
    { href: `${base}/documents`, label: 'Documents' },
    { href: `${base}/people`, label: 'People' },
    ...(can('shareholder.read', c.scope) ? [{ href: `${base}/snapshot`, label: 'Record date' }] : []),
  ];

  return (
    <MeetingProvider value={m}>
      {back}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{m.title}</h2>
            <MeetingStateBadge state={m.state} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-3">
            <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4" aria-hidden /> <span className="tabular">{formatDateTime(m.scheduledStart)}</span></span>
            <span className="inline-flex items-center gap-1.5">
              {m.mode === 'HYBRID' ? <MapPin className="size-4" aria-hidden /> : <Video className="size-4" aria-hidden />}
              {m.mode === 'HYBRID' ? `Hybrid · ${m.venue}` : 'Virtual'}
            </span>
            <span>Record date <span className="tabular">{formatDate(m.recordDate)}</span></span>
          </p>
        </div>
      </div>
      <nav aria-label="Meeting sections" className="mb-6 overflow-x-auto">
        <ul className="flex min-w-max gap-1 rounded-lg bg-subtle p-1">
          {tabs.map((t) => {
            const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
                    active ? 'bg-surface font-medium text-ink shadow-xs' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </MeetingProvider>
  );
}
