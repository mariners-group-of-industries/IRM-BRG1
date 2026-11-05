'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, ChevronLeft, Download, FileText, MapPin, Video } from 'lucide-react';
import { MEETING_DOCUMENT_KIND_LABELS, type MeetingDocumentDto, type PortalMeeting } from '@irm/shared';
import { Alert, Badge, Button, Panel, PanelHeader, Skeleton } from '@irm/ui';
import { BrandMark } from '@/components/brand';
import { api } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime, formatShares } from '@/lib/format';

/** One meeting as a shareholder or representative sees it: notice, agenda, documents and registration. */
export default function PortalMeetingPage() {
  const { mid } = useParams<{ mid: string }>();
  const qc = useQueryClient();
  const key = ['portal-meetings', mid];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<PortalMeeting>(`/participant/meetings/${mid}`) });
  const register = useMutation({
    mutationFn: (k: string) => api.post<PortalMeeting>(`/participant/meetings/${mid}/register`, { key: k }),
    onSuccess: (m) => {
      qc.setQueryData(key, m);
      qc.invalidateQueries({ queryKey: ['portal-meetings'] });
      toast.success('You are registered for the meeting');
    },
    onError: (e) => toast.error(e.message),
  });
  const download = async (d: MeetingDocumentDto) => {
    const res = await fetch(`/api/v1/participant/meetings/${mid}/documents/${d.id}`, { credentials: 'same-origin' });
    if (!res.ok) return toast.error('Could not download the document');
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: d.fileName }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-dvh bg-canvas text-[0.9375rem]">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <BrandMark />
          <p className="truncate font-semibold text-ink">{q.data?.companyName ?? 'Shareholder portal'}</p>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/portal" className="mb-5 inline-flex items-center gap-1 rounded text-sm text-ink-3 hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden /> Back to portal
        </Link>
        {q.isPending ? (
          <Skeleton className="h-64" />
        ) : q.isError ? (
          <Alert tone="danger">{q.error.message}</Alert>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{q.data.title}</h1>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
              <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-ink-3" aria-hidden /> <span className="tabular">{formatDateTime(q.data.scheduledStart)}</span> (Dhaka)</span>
              <span className="inline-flex items-center gap-1.5">
                {q.data.mode === 'HYBRID' ? <MapPin className="size-4 text-ink-3" aria-hidden /> : <Video className="size-4 text-ink-3" aria-hidden />}
                {q.data.mode === 'HYBRID' ? `Online and at ${q.data.venue}` : 'Online meeting'}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-3">Record date {formatDate(q.data.recordDate)} · রেকর্ড তারিখ</p>

            <Panel className="mt-6">
              <PanelHeader title="Your registration · নিবন্ধন" />
              {q.data.eligibility.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-3">You have no shareholding or authorization for this meeting.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {q.data.eligibility.map((e) => (
                    <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{e.label}</p>
                        <p className="text-sm text-ink-3">
                          {e.kind !== 'SHAREHOLDER' && `For ${e.shareholderName} · `}
                          {e.eligible ? `${formatShares(e.votes)} votes` : e.reason}
                        </p>
                      </div>
                      {e.registered ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success"><CheckCircle2 className="size-4" aria-hidden /> Registered</span>
                      ) : (
                        <Button size="lg" disabled={!e.eligible || !q.data.registrationOpen} loading={register.isPending && register.variables === e.key} onClick={() => register.mutate(e.key)}>
                          Register · নিবন্ধন করুন
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!q.data.registrationOpen && q.data.state === 'SCHEDULED' && (
                <p className="border-t border-line px-5 py-3 text-xs text-ink-3">Registration opens after the record date. You will be able to register here.</p>
              )}
            </Panel>

            <Panel className="mt-6">
              <PanelHeader title="Agenda · আলোচ্যসূচি" />
              <ol className="divide-y divide-line">
                {q.data.agenda.map((a) => (
                  <li key={a.id} className="flex gap-4 px-5 py-4">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-sm font-semibold text-ink-2">{a.number}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{a.title}</p>
                      {a.resolution && (
                        <>
                          <Badge tone={a.resolution.kind === 'SPECIAL' ? 'warning' : 'accent'} className="mt-1">{a.resolution.kind === 'SPECIAL' ? 'Special resolution' : 'Ordinary resolution'}</Badge>
                          <p className="mt-2 text-sm leading-relaxed text-ink-2">{a.resolution.text}</p>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>

            {q.data.documents.length > 0 && (
              <Panel className="mt-6">
                <PanelHeader title="Documents · নথি" />
                <ul className="divide-y divide-line">
                  {q.data.documents.map((d) => (
                    <li key={d.id}>
                      <button onClick={() => download(d)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-subtle/60 focus-visible:bg-subtle focus-visible:outline-none">
                        <FileText className="size-5 shrink-0 text-ink-3" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-ink">{d.title}</span>
                          <span className="text-xs text-ink-3">{MEETING_DOCUMENT_KIND_LABELS[d.kind]} · PDF · {formatBytes(d.sizeBytes)}</span>
                        </span>
                        <Download className="size-4 text-ink-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {q.data.noticeText && (
              <Panel className="mt-6">
                <PanelHeader title="Notice of meeting · সভার নোটিশ" />
                <div className="px-5 py-4 text-sm leading-relaxed whitespace-pre-line text-ink-2">{q.data.noticeText}</div>
              </Panel>
            )}
          </>
        )}
      </main>
    </div>
  );
}
