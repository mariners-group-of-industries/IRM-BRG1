'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import type { MeetingDetail, MeetingSummary } from '@irm/shared';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  Panel,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@irm/ui';
import { MeetingStateBadge } from '@/components/status';
import { api, ApiError } from '@/lib/api';
import { dhakaLocalToIso, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../company-context';

export default function MeetingsPage() {
  const c = useCompany();
  const { can } = useSession();
  const [creating, setCreating] = React.useState(false);
  const q = useQuery({ queryKey: ['meetings', c.id], queryFn: () => api.get<MeetingSummary[]>(`/companies/${c.id}/meetings`) });

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Annual and extraordinary general meetings of {c.shortName}.</p>
        {can('meeting.create', c.scope) && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New meeting
          </Button>
        )}
      </div>
      <Panel>
        {q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.isError ? (
          <div className="p-5"><Alert tone="danger">{q.error.message}</Alert></div>
        ) : q.data.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title="No meetings yet" description="Create an AGM or EGM to prepare its notice, agenda and documents." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Meeting</TH>
                <TH className="hidden md:table-cell">Date</TH>
                <TH className="hidden lg:table-cell">Record date</TH>
                <TH className="hidden sm:table-cell text-right">Registered</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {q.data.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <Link href={`/companies/${c.id}/meetings/${m.id}`} className="font-medium text-ink hover:text-accent focus-visible:underline focus-visible:outline-none">
                      {m.title}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                      <Badge tone="neutral">{m.type}</Badge>
                      {m.mode === 'HYBRID' ? 'Hybrid' : 'Virtual'} · {formatNumber(m.agendaCount)} agenda items
                    </p>
                  </TD>
                  <TD className="hidden md:table-cell tabular">{formatDateTime(m.scheduledStart)}</TD>
                  <TD className="hidden lg:table-cell tabular">{formatDate(m.recordDate)}</TD>
                  <TD className="hidden sm:table-cell text-right tabular">{formatNumber(m.registrations)}</TD>
                  <TD><MeetingStateBadge state={m.state} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New meeting" description="Start as a draft. You can add the notice, agenda and documents before publishing.">
          <CreateMeetingForm />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateMeetingForm() {
  const c = useCompany();
  const router = useRouter();
  const qc = useQueryClient();
  const [type, setType] = React.useState<'AGM' | 'EGM'>('AGM');
  const [mode, setMode] = React.useState<'VIRTUAL' | 'HYBRID'>('VIRTUAL');
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: object) => api.post<MeetingDetail>(`/companies/${c.id}/meetings`, body),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['meetings', c.id] });
      router.push(`/companies/${c.id}/meetings/${m.id}`);
    },
    onError: (e) => {
      setErrors(e instanceof ApiError ? e.fieldErrors : {});
      setMessage(e.message);
    },
  });
  const err = (k: string) => errors[k]?.[0];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setErrors({});
        setMessage(null);
        create.mutate({
          type,
          title: String(f.get('title') ?? ''),
          scheduledStart: dhakaLocalToIso(String(f.get('scheduledStart') ?? '')),
          recordDate: String(f.get('recordDate') ?? ''),
          mode,
          venue: String(f.get('venue') ?? ''),
        });
      }}
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        {message && Object.keys(errors).length === 0 && <Alert tone="danger">{message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="type">
            <Select id="type" value={type} onChange={(e) => setType(e.target.value as 'AGM' | 'EGM')}>
              <option value="AGM">Annual General Meeting</option>
              <option value="EGM">Extraordinary General Meeting</option>
            </Select>
          </Field>
          <Field label="Format" htmlFor="mode">
            <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'VIRTUAL' | 'HYBRID')}>
              <option value="VIRTUAL">Virtual</option>
              <option value="HYBRID">Hybrid (venue and online)</option>
            </Select>
          </Field>
        </div>
        <Field label="Title" htmlFor="title" error={err('title')}>
          <Input id="title" name="title" placeholder={type === 'AGM' ? 'e.g. 37th Annual General Meeting 2027' : 'e.g. Extraordinary General Meeting 2027'} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date and time (Dhaka)" htmlFor="scheduledStart" error={err('scheduledStart')}>
            <Input id="scheduledStart" name="scheduledStart" type="datetime-local" />
          </Field>
          <Field label="Record date" htmlFor="recordDate" hint="Holdings on this date decide who may vote" error={err('recordDate')}>
            <Input id="recordDate" name="recordDate" type="date" />
          </Field>
        </div>
        {mode === 'HYBRID' && (
          <Field label="Venue" htmlFor="venue" error={err('venue')}>
            <Input id="venue" name="venue" placeholder="Hall and address" />
          </Field>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
        <Button type="submit" loading={create.isPending}>Create draft</Button>
      </DialogFooter>
    </form>
  );
}
