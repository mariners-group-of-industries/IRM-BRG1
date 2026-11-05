'use client';

import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Mail, Smartphone } from 'lucide-react';
import { Alert, EmptyState, Panel, PanelHeader, Skeleton } from '@irm/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface OutboxMessage {
  id: string;
  channel: 'PHONE' | 'EMAIL';
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
}

/**
 * DEVELOPMENT ONLY. Shows the SMS and email messages the platform would have sent.
 * The API returns 404 for this data in production.
 */
export default function DevOutboxPage() {
  const q = useQuery({ queryKey: ['dev-outbox'], queryFn: () => api.get<OutboxMessage[]>('/dev/outbox'), refetchInterval: 3000, retry: false });

  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-canvas px-4 py-10">
      <Alert tone="warning" title="Development outbox, not a real SMS or email service">
        No message on this page was actually sent. A real SMS and email provider must be configured before production, and this page is disabled there.
      </Alert>
      <Panel className="mt-6">
        <PanelHeader
          title={<span className="inline-flex items-center gap-2"><FlaskConical className="size-4 text-warning" aria-hidden /> Messages</span>}
          description="Newest first. Refreshes every 3 seconds."
        />
        {q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : q.isError ? (
          <div className="p-5">
            <Alert tone="danger">{q.error instanceof ApiError && q.error.status === 404 ? 'The development outbox is disabled on this server.' : q.error.message}</Alert>
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState title="No messages yet" description="Request a sign-in code on a company's /join page and it appears here." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((m) => (
              <li key={m.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-2 font-medium text-ink">
                    {m.channel === 'PHONE' ? <Smartphone className="size-4 text-ink-3" aria-hidden /> : <Mail className="size-4 text-ink-3" aria-hidden />}
                    {m.recipient}
                  </span>
                  <time className="text-xs text-ink-3 tabular" dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                </div>
                <p className="mt-1 text-sm text-ink-2" data-testid="outbox-body">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
