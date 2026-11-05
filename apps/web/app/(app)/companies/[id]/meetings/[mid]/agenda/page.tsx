'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ListOrdered, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { EDITABLE_STATES, type AgendaItemDto } from '@irm/shared';
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
  PanelHeader,
  Select,
  Skeleton,
  Textarea,
} from '@irm/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCompany } from '../../../company-context';
import { useMeeting } from '../meeting-context';

export default function AgendaPage() {
  const c = useCompany();
  const m = useMeeting();
  const { can } = useSession();
  const qc = useQueryClient();
  const key = ['meetings', c.id, m.id, 'agenda'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<AgendaItemDto[]>(`/companies/${c.id}/meetings/${m.id}/agenda`) });
  const editable = EDITABLE_STATES.includes(m.state) && can('agenda.manage', c.scope);
  const [editing, setEditing] = React.useState<AgendaItemDto | 'new' | null>(null);

  const after = (rows: AgendaItemDto[]) => {
    qc.setQueryData(key, rows);
    qc.invalidateQueries({ queryKey: ['meetings', c.id, m.id] });
  };
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post<AgendaItemDto[]>(`/companies/${c.id}/meetings/${m.id}/agenda/order`, { ids }),
    onSuccess: after,
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<AgendaItemDto[]>(`/companies/${c.id}/meetings/${m.id}/agenda/${id}`),
    onSuccess: (rows) => (toast.success('Agenda item removed'), after(rows)),
    onError: (e) => toast.error(e.message),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = q.data!.map((a) => a.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <Panel>
      <PanelHeader
        title="Agenda"
        description="Items in the order they will be taken. Items with a resolution can be proposed, seconded and voted on."
        actions={editable && <Button size="sm" onClick={() => setEditing('new')}><Plus aria-hidden /> Add item</Button>}
      />
      {!EDITABLE_STATES.includes(m.state) && (
        <p className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-xs text-ink-3"><Lock className="size-3.5" aria-hidden /> The agenda is locked once registration opens.</p>
      )}
      {q.isPending ? (
        <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : q.isError ? (
        <div className="p-5"><Alert tone="danger">{q.error.message}</Alert></div>
      ) : q.data.length === 0 ? (
        <EmptyState icon={<ListOrdered />} title="No agenda items" description="Add the ordinary and special business of the meeting." />
      ) : (
        <ol className="divide-y divide-line">
          {q.data.map((a, i) => (
            <li key={a.id} className="flex gap-4 px-5 py-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-sm font-semibold text-ink-2 tabular">{a.number}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{a.title}</p>
                  {a.resolution ? (
                    <Badge tone={a.resolution.kind === 'SPECIAL' ? 'warning' : 'accent'}>{a.resolution.kind === 'SPECIAL' ? 'Special resolution' : 'Ordinary resolution'}</Badge>
                  ) : (
                    <Badge>No vote</Badge>
                  )}
                </div>
                {a.description && <p className="mt-1 text-sm text-ink-3">{a.description}</p>}
                {a.resolution && (
                  <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-ink-2">{a.resolution.text}</blockquote>
                )}
                {a.resolution && (
                  <p className="mt-2 text-xs text-ink-3">
                    {[a.resolution.requiresProposal && 'Needs a proposer', a.resolution.requiresSeconding && 'Needs a seconder'].filter(Boolean).join(' · ') || 'No proposer or seconder needed'}
                  </p>
                )}
              </div>
              {editable && (
                <div className="flex shrink-0 items-start gap-0.5">
                  <Button variant="ghost" size="icon" aria-label={`Move item ${a.number} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Move item ${a.number} down`} disabled={i === q.data.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit item ${a.number}`} onClick={() => setEditing(a)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove item ${a.number}`} onClick={() => window.confirm(`Remove item ${a.number}, "${a.title}"?`) && remove.mutate(a.id)}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={editing === 'new' ? 'Add agenda item' : `Edit item ${editing.number}`}>
            <AgendaForm item={editing === 'new' ? null : editing} nextNumber={String((q.data?.length ?? 0) + 1)} onDone={(rows) => (after(rows), setEditing(null))} />
          </DialogContent>
        )}
      </Dialog>
    </Panel>
  );
}

function AgendaForm({ item, nextNumber, onDone }: { item: AgendaItemDto | null; nextNumber: string; onDone: (rows: AgendaItemDto[]) => void }) {
  const c = useCompany();
  const m = useMeeting();
  const [hasResolution, setHasResolution] = React.useState(item ? !!item.resolution : true);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const save = useMutation({
    mutationFn: (body: object) =>
      item ? api.patch<AgendaItemDto[]>(`/companies/${c.id}/meetings/${m.id}/agenda/${item.id}`, body) : api.post<AgendaItemDto[]>(`/companies/${c.id}/meetings/${m.id}/agenda`, body),
    onSuccess: (rows) => (toast.success('Agenda saved'), onDone(rows)),
    onError: (e) => (e instanceof ApiError && Object.keys(e.fieldErrors).length ? setErrors(e.fieldErrors) : toast.error(e.message)),
  });
  const err = (k: string) => errors[k]?.[0];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setErrors({});
        save.mutate({
          number: String(f.get('number')),
          title: String(f.get('title')),
          description: String(f.get('description') ?? ''),
          hasResolution,
          resolutionKind: String(f.get('resolutionKind') ?? 'ORDINARY'),
          resolutionText: String(f.get('resolutionText') ?? ''),
          requiresProposal: f.get('requiresProposal') === 'on',
          requiresSeconding: f.get('requiresSeconding') === 'on',
        });
      }}
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
          <Field label="No." htmlFor="number" error={err('number')}><Input id="number" name="number" defaultValue={item?.number ?? nextNumber} /></Field>
          <Field label="Title" htmlFor="title" error={err('title')}><Input id="title" name="title" defaultValue={item?.title ?? ''} /></Field>
        </div>
        <Field label="Explanatory note" htmlFor="description" optional><Textarea id="description" name="description" rows={2} defaultValue={item?.description ?? ''} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={hasResolution} onChange={(e) => setHasResolution(e.target.checked)} className="accent-[var(--color-accent)]" />
          This item has a resolution to vote on
        </label>
        {hasResolution && (
          <>
            <Field label="Resolution type" htmlFor="resolutionKind">
              <Select id="resolutionKind" name="resolutionKind" defaultValue={item?.resolution?.kind ?? 'ORDINARY'}>
                <option value="ORDINARY">Ordinary resolution</option>
                <option value="SPECIAL">Special resolution</option>
              </Select>
            </Field>
            <Field label="Resolution text" htmlFor="resolutionText" error={err('resolutionText')}>
              <Textarea id="resolutionText" name="resolutionText" rows={4} defaultValue={item?.resolution?.text ?? 'RESOLVED that '} />
            </Field>
            <div className="flex flex-col gap-2 text-sm text-ink-2">
              <label className="flex items-center gap-2"><input type="checkbox" name="requiresProposal" defaultChecked={item?.resolution?.requiresProposal ?? true} className="accent-[var(--color-accent)]" /> Needs a proposer</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="requiresSeconding" defaultChecked={item?.resolution?.requiresSeconding ?? true} className="accent-[var(--color-accent)]" /> Needs a seconder</label>
            </div>
          </>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
        <Button type="submit" loading={save.isPending}>Save item</Button>
      </DialogFooter>
    </form>
  );
}
