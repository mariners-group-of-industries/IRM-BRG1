'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText, UploadCloud } from 'lucide-react';
import { MEETING_DOCUMENT_KINDS, MEETING_DOCUMENT_KIND_LABELS, type AgendaItemDto, type MeetingDocumentDto } from '@irm/shared';
import { Alert, Badge, Button, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, Panel, PanelHeader, Select, Skeleton } from '@irm/ui';
import { api, ApiError } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../../../company-context';
import { useMeeting } from '../meeting-context';

export default function DocumentsPage() {
  const c = useCompany();
  const m = useMeeting();
  const { can } = useSession();
  const qc = useQueryClient();
  const key = ['meetings', c.id, m.id, 'documents'];
  const base = `/companies/${c.id}/meetings/${m.id}/documents`;
  const docs = useQuery({ queryKey: key, queryFn: () => api.get<MeetingDocumentDto[]>(base) });
  const agenda = useQuery({ queryKey: ['meetings', c.id, m.id, 'agenda'], queryFn: () => api.get<AgendaItemDto[]>(`/companies/${c.id}/meetings/${m.id}/agenda`) });
  const manage = can('document.manage', c.scope) && m.state !== 'ARCHIVED';

  const change = useMutation({
    mutationFn: (v: { id: string; published?: boolean; removed?: true }) => api.patch<MeetingDocumentDto[]>(`${base}/${v.id}`, { published: v.published, removed: v.removed }),
    onSuccess: (rows) => qc.setQueryData(key, rows),
    onError: (e) => toast.error(e.message),
  });
  const download = async (d: MeetingDocumentDto) => {
    const res = await fetch(`/api/v1${base}/${d.id}/download`, { credentials: 'same-origin' });
    if (!res.ok) return toast.error('Could not download the document');
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: d.fileName }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      {manage && <UploadPanel agenda={agenda.data ?? []} onUploaded={(rows) => qc.setQueryData(key, rows)} />}
      <Panel className={manage ? 'xl:col-span-2' : 'xl:col-span-3'}>
        <PanelHeader title="Documents" description="Only published documents are visible to shareholders." />
        {docs.isPending ? (
          <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : docs.isError ? (
          <div className="p-5"><Alert tone="danger">{docs.error.message}</Alert></div>
        ) : docs.data.length === 0 ? (
          <EmptyState icon={<FileText />} title="No documents" description="Upload the notice, annual report and proxy form as PDF." />
        ) : (
          <ul className="divide-y divide-line">
            {docs.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <FileText className="size-5 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{d.title}</p>
                  <p className="text-xs text-ink-3">
                    {MEETING_DOCUMENT_KIND_LABELS[d.kind]} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.uploadedAt)}
                    {d.agendaItemId && ` · Item ${agenda.data?.find((a) => a.id === d.agendaItemId)?.number ?? ''}`}
                  </p>
                </div>
                {d.published ? <Badge tone="success" dot>Published</Badge> : <Badge>Not published</Badge>}
                <Menu>
                  <MenuTrigger asChild><Button variant="ghost" size="sm" aria-label={`Actions for ${d.title}`}>Actions</Button></MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem onSelect={() => download(d)}><Download aria-hidden /> Download</MenuItem>
                    {manage && <MenuItem onSelect={() => change.mutate({ id: d.id, published: !d.published })}>{d.published ? 'Unpublish' : 'Publish to shareholders'}</MenuItem>}
                    {manage && <MenuItem onSelect={() => window.confirm(`Remove "${d.title}"? It is kept in the record but no longer listed.`) && change.mutate({ id: d.id, removed: true })}>Remove</MenuItem>}
                  </MenuContent>
                </Menu>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function UploadPanel({ agenda, onUploaded }: { agenda: AgendaItemDto[]; onUploaded: (rows: MeetingDocumentDto[]) => void }) {
  const c = useCompany();
  const m = useMeeting();
  const [file, setFile] = React.useState<File | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const formRef = React.useRef<HTMLFormElement>(null);
  const upload = useMutation({
    mutationFn: (f: FormData) => api.upload<MeetingDocumentDto[]>(`/companies/${c.id}/meetings/${m.id}/documents`, f),
    onSuccess: (rows) => {
      toast.success('Document uploaded. Publish it when it is final.');
      onUploaded(rows);
      setFile(null);
      formRef.current?.reset();
    },
    onError: (e) => (e instanceof ApiError && Object.keys(e.fieldErrors).length ? setErrors(e.fieldErrors) : toast.error(e.message)),
  });
  return (
    <Panel>
      <PanelHeader title="Upload" description="PDF only, up to 25 MB" />
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return toast.error('Choose a PDF file');
          const f = new FormData(e.currentTarget);
          f.set('file', file);
          setErrors({});
          upload.mutate(f);
        }}
      >
        <Field label="Type" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="NOTICE">
            {MEETING_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{MEETING_DOCUMENT_KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Title" htmlFor="doc-title" error={errors.title?.[0]}><Input id="doc-title" name="title" placeholder="e.g. Annual Report 2025-26" /></Field>
        <Field label="Agenda item" htmlFor="agendaItemId" optional>
          <Select id="agendaItemId" name="agendaItemId" defaultValue="">
            <option value="">Whole meeting</option>
            {agenda.map((a) => <option key={a.id} value={a.id}>{a.number}. {a.title}</option>)}
          </Select>
        </Field>
        <label htmlFor="doc-file" className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line-strong px-3 py-3 text-sm hover:bg-subtle/60 focus-within:ring-2 focus-within:ring-accent/40">
          <UploadCloud className="size-5 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 truncate text-ink-2">{file ? file.name : 'Choose a PDF'}</span>
          <input id="doc-file" type="file" accept="application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button type="submit" loading={upload.isPending}>Upload</Button>
      </form>
    </Panel>
  );
}
