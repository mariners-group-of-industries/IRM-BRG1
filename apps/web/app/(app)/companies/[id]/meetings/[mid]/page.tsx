'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Circle, Lock, XCircle } from 'lucide-react';
import { MEETING_STATE_LABELS, type MeetingControl, type MeetingState, type MeetingTransitionOption } from '@irm/shared';
import { Alert, Button, Dialog, DialogClose, DialogContent, DialogFooter, Field, Panel, PanelHeader, Skeleton, Textarea, cn } from '@irm/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useCompany } from '../../company-context';
import { meetingKey, useMeeting } from './meeting-context';

const FLOW: MeetingState[] = ['DRAFT', 'SCHEDULED', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED', 'ARCHIVED'];

export default function MeetingControlPage() {
  const c = useCompany();
  const m = useMeeting();
  const q = useQuery({ queryKey: [...meetingKey(c.id, m.id), 'control', m.version], queryFn: () => api.get<MeetingControl>(`/companies/${c.id}/meetings/${m.id}/control`) });
  const [pending, setPending] = React.useState<MeetingTransitionOption | null>(null);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="flex flex-col gap-6 xl:col-span-2">
        <Panel>
          <PanelHeader title="Status" description="Every change is checked by the server and recorded in the history." />
          <ol className="flex flex-wrap gap-x-1 gap-y-3 px-5 py-4" aria-label="Meeting lifecycle">
            {FLOW.map((s, i) => {
              const at = FLOW.indexOf(m.state === 'PAUSED' ? 'LIVE' : m.state);
              const state = i < at ? 'done' : i === at ? 'current' : 'todo';
              return (
                <li key={s} className="flex items-center gap-1" aria-current={state === 'current' ? 'step' : undefined}>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium',
                      state === 'done' && 'bg-accent-soft text-accent-ink',
                      state === 'current' && 'bg-accent text-white',
                      state === 'todo' && 'bg-subtle text-ink-3',
                    )}
                  >
                    {s === 'LIVE' && m.state === 'PAUSED' ? 'Paused' : MEETING_STATE_LABELS[s]}
                  </span>
                  {i < FLOW.length - 1 && <span className="h-px w-3 bg-line-strong" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </Panel>

        {q.isPending ? (
          <Skeleton className="h-48" />
        ) : q.isError ? (
          <Alert tone="danger">{q.error.message}</Alert>
        ) : q.data.transitions.length === 0 ? (
          <Panel><p className="flex items-center gap-2 px-5 py-4 text-sm text-ink-3"><Lock className="size-4" aria-hidden /> This meeting is archived. No further changes are possible.</p></Panel>
        ) : (
          q.data.transitions.map((t) => (
            <Panel key={t.to}>
              <PanelHeader
                title={t.action}
                description={t.description}
                actions={
                  <Button variant={t.to === 'DRAFT' ? 'secondary' : 'primary'} size="sm" disabled={!t.allowed} onClick={() => setPending(t)}>
                    {t.action}
                  </Button>
                }
              />
              {t.checks.length > 0 && (
                <ul className="divide-y divide-line">
                  {t.checks.map((ch) => (
                    <li key={ch.key} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                      {ch.ok ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
                      ) : ch.blocking ? (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Required" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Recommended" />
                      )}
                      <span className="min-w-0">
                        <span className={ch.ok ? 'text-ink-2' : 'text-ink'}>{ch.label}</span>
                        {!ch.ok && <span className="ml-2 text-xs text-ink-3">{ch.blocking ? 'Required' : 'Recommended'}</span>}
                        {ch.detail && <span className="block text-xs text-ink-3">{ch.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))
        )}
      </div>

      <div className="flex flex-col gap-6">
        <Panel>
          <PanelHeader title="At a glance" />
          <dl className="divide-y divide-line text-sm">
            {[
              ['Agenda items', formatNumber(m.agendaCount)],
              ['Registered participants', formatNumber(m.registrations)],
              ['Record-date snapshot', m.snapshotTakenAt ? formatDateTime(m.snapshotTakenAt) : 'Not taken yet'],
              ['Published', m.publishedAt ? formatDateTime(m.publishedAt) : 'Not yet'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-5 py-2.5">
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-right text-ink tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="History" />
          {q.data ? (
            <ol className="divide-y divide-line">
              {q.data.history.map((h) => (
                <li key={h.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                  <Circle className="mt-1 size-2 shrink-0 fill-current text-accent" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-ink">{h.from ? `${MEETING_STATE_LABELS[h.from]} → ` : ''}{MEETING_STATE_LABELS[h.to]}</p>
                    <p className="text-xs text-ink-3 tabular">{formatDateTime(h.at)}{h.actor && ` · ${h.actor}`}</p>
                    {h.reason && <p className="mt-0.5 text-xs text-ink-2">“{h.reason}”</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Skeleton className="m-5 h-20" />
          )}
        </Panel>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        {pending && (
          <DialogContent title={`${pending.action}?`} description={pending.description}>
            <TransitionForm option={pending} onDone={() => setPending(null)} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function TransitionForm({ option, onDone }: { option: MeetingTransitionOption; onDone: () => void }) {
  const c = useCompany();
  const m = useMeeting();
  const qc = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const go = useMutation({
    mutationFn: () => api.post(`/companies/${c.id}/meetings/${m.id}/transition`, { to: option.to, reason: reason || undefined, expectedVersion: m.version }),
    onSuccess: () => {
      toast.success(`${option.action}: done`);
      qc.invalidateQueries({ queryKey: ['meetings', c.id] });
      onDone();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <form onSubmit={(e) => (e.preventDefault(), go.mutate())}>
      <div className="flex flex-col gap-4 px-5 py-5">
        {option.to === 'REGISTRATION_OPEN' && (
          <Alert tone="info">Holdings on the record date will be frozen for this meeting. The agenda and notice can no longer be edited.</Alert>
        )}
        {(option.to === 'COMPLETED' || option.to === 'ARCHIVED') && <Alert tone="warning">This cannot be undone.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason" htmlFor="reason" optional={!option.requiresReason} hint="Recorded in the meeting history and audit log">
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
        <Button type="submit" loading={go.isPending} disabled={option.requiresReason && !reason.trim()}>{option.action}</Button>
      </DialogFooter>
    </form>
  );
}
