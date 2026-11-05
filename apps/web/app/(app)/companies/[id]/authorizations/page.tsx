'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText, Plus, UserCheck } from 'lucide-react';
import {
  PROXY_SCOPES,
  type CorporateRepDto,
  type Paginated,
  type ProxyDto,
  type ShareholderListItem,
} from '@irm/shared';
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Panel,
  PanelHeader,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@irm/ui';
import { AuthorizationStatusBadge } from '@/components/status';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../company-context';

type Kind = 'corporate-representatives' | 'proxies';

export default function AuthorizationsPage() {
  const c = useCompany();
  const { can } = useSession();
  const manage = can('authorization.manage', c.scope);
  const [adding, setAdding] = React.useState<Kind | null>(null);
  const reps = useQuery({ queryKey: ['register', c.id, 'reps'], queryFn: () => api.get<CorporateRepDto[]>(`/companies/${c.id}/corporate-representatives`) });
  const proxies = useQuery({ queryKey: ['register', c.id, 'proxies'], queryFn: () => api.get<ProxyDto[]>(`/companies/${c.id}/proxies`) });

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info">
        People listed here sign in with a one-time code sent to the email on their authorization. A record created by one administrator must be approved by another.
      </Alert>

      <Panel>
        <PanelHeader
          title="Corporate representatives"
          description="Act for a corporate shareholder across the accounts listed"
          actions={manage && <Button size="sm" variant="secondary" onClick={() => setAdding('corporate-representatives')}><Plus aria-hidden /> Add representative</Button>}
        />
        {reps.isPending ? <Loading /> : reps.isError ? <div className="p-5"><Alert tone="danger">{reps.error.message}</Alert></div> : reps.data.length === 0 ? (
          <EmptyState icon={<UserCheck />} title="No corporate representatives" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Representative</TH>
                <TH className="hidden md:table-cell">For</TH>
                <TH className="hidden lg:table-cell">Valid</TH>
                <TH>Status</TH>
                {manage && <TH className="text-right"><span className="sr-only">Actions</span></TH>}
              </tr>
            </THead>
            <TBody>
              {reps.data.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <p className="font-medium text-ink">{r.fullName}</p>
                    <p className="text-xs text-ink-3">{[r.designation, r.email].filter(Boolean).join(' · ')}</p>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <p className="text-ink-2">{r.shareholderName}</p>
                    <p className="font-mono text-xs text-ink-3">{r.identities.map((i) => i.value).join(', ')}</p>
                  </TD>
                  <TD className="hidden lg:table-cell tabular">{formatDate(r.validFrom)} – {formatDate(r.validUntil)}</TD>
                  <TD><AuthorizationStatusBadge status={r.status} effective={r.effective} /></TD>
                  {manage && <TD className="text-right"><Actions kind="corporate-representatives" item={r} /></TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Proxies"
          description="Attend, and vote where allowed, for a shareholder at a named meeting"
          actions={manage && <Button size="sm" variant="secondary" onClick={() => setAdding('proxies')}><Plus aria-hidden /> Add proxy</Button>}
        />
        {proxies.isPending ? <Loading /> : proxies.isError ? <div className="p-5"><Alert tone="danger">{proxies.error.message}</Alert></div> : proxies.data.length === 0 ? (
          <EmptyState icon={<UserCheck />} title="No proxies" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Proxy</TH>
                <TH className="hidden md:table-cell">For</TH>
                <TH className="hidden lg:table-cell">Meeting and scope</TH>
                <TH>Status</TH>
                {manage && <TH className="text-right"><span className="sr-only">Actions</span></TH>}
              </tr>
            </THead>
            <TBody>
              {proxies.data.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <p className="font-medium text-ink">{p.fullName}</p>
                    <p className="text-xs text-ink-3">{p.email}</p>
                  </TD>
                  <TD className="hidden md:table-cell">{p.grantorName}</TD>
                  <TD className="hidden lg:table-cell">
                    <p className="text-ink-2">{p.meetingReference}</p>
                    <p className="text-xs text-ink-3">
                      {p.scope === 'ATTEND_AND_VOTE' ? 'Attend and vote' : 'Attend only'} · until {formatDate(p.validUntil)}
                    </p>
                  </TD>
                  <TD><AuthorizationStatusBadge status={p.status} effective={p.effective} /></TD>
                  {manage && <TD className="text-right"><Actions kind="proxies" item={p} /></TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Dialog open={adding === 'corporate-representatives'} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent title="Add corporate representative" description="Record who may act for a corporate shareholder. Another administrator approves it.">
          <RepForm onDone={() => setAdding(null)} />
        </DialogContent>
      </Dialog>
      <Dialog open={adding === 'proxies'} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent title="Add proxy" description="Record a proxy lodged by a shareholder. Another administrator approves it.">
          <ProxyForm onDone={() => setAdding(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Loading() {
  return <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
}

function Actions({ kind, item }: { kind: Kind; item: CorporateRepDto | ProxyDto }) {
  const c = useCompany();
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (v: { decision: 'APPROVE' | 'REJECT' | 'REVOKE'; note?: string }) =>
      api.post(`/companies/${c.id}/${kind}/${item.id}/decision`, v),
    onSuccess: (_, v) => {
      toast.success(v.decision === 'APPROVE' ? 'Approved' : v.decision === 'REJECT' ? 'Rejected' : 'Revoked. Their access ended immediately.');
      qc.invalidateQueries({ queryKey: ['register', c.id] });
    },
    onError: (e) => toast.error(e.message),
  });
  const download = async () => {
    const res = await fetch(`/api/v1/companies/${c.id}/${kind}/${item.id}/document`, { credentials: 'same-origin' });
    if (!res.ok) return toast.error('Could not download the document');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: item.document?.fileName ?? 'document' });
    a.click();
    URL.revokeObjectURL(url);
  };
  const ask = (decision: 'REJECT' | 'REVOKE') => {
    const note = window.prompt(decision === 'REJECT' ? 'Reason for rejecting (shown in the audit log)' : 'Reason for revoking. Access ends immediately.');
    if (note !== null) decide.mutate({ decision, note: note || undefined });
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" loading={decide.isPending}>Actions</Button>
      </MenuTrigger>
      <MenuContent align="end">
        {item.status === 'PENDING' && (
          <>
            <MenuItem onSelect={() => decide.mutate({ decision: 'APPROVE' })}>Approve</MenuItem>
            <MenuItem onSelect={() => ask('REJECT')}>Reject</MenuItem>
          </>
        )}
        {item.status === 'APPROVED' && <MenuItem onSelect={() => ask('REVOKE')}>Revoke</MenuItem>}
        {item.document && (
          <MenuItem onSelect={download}>
            <Download aria-hidden /> Download document
          </MenuItem>
        )}
        {item.status !== 'PENDING' && item.status !== 'APPROVED' && !item.document && (
          <MenuItem disabled>No actions available</MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

/** Finds a shareholder by name or account number. */
function ShareholderPicker({ type, value, onChange }: { type?: 'CORPORATE'; value: ShareholderListItem | null; onChange: (s: ShareholderListItem | null) => void }) {
  const c = useCompany();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({
    queryKey: ['register', c.id, 'picker', type, debounced],
    queryFn: () => api.get<Paginated<ShareholderListItem>>(`/companies/${c.id}/shareholders?q=${encodeURIComponent(debounced)}&type=${type ?? ''}`),
    enabled: debounced.length >= 2 && !value,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-line-strong px-3 py-2 text-sm">
        <span className="font-medium text-ink">{value.name}</span>
        <Button type="button" variant="link" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div>
      <Input placeholder={type === 'CORPORATE' ? 'Search corporate shareholders' : 'Search by name or account number'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shareholders" />
      {debounced.length >= 2 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-line" role="listbox">
          {results.isPending ? <li className="px-3 py-2 text-sm text-ink-3">Searching…</li> : results.data?.items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-3">No matches</li>
          ) : (
            results.data?.items.map((s) => (
              <li key={s.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => onChange(s)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none">
                  <span className="text-ink">{s.name}</span>
                  <span className="font-mono text-xs text-ink-3">{s.identities[0]?.value}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function DocumentInput({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  return (
    <Field label="Authorization document" htmlFor="doc" optional hint="Board resolution, letter of authority or proxy form. PDF, PNG or JPEG, up to 10 MB.">
      <div className="flex items-center gap-3">
        <label htmlFor="doc" className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 text-sm text-ink hover:bg-subtle focus-within:ring-2 focus-within:ring-accent/40">
          <FileText className="size-4 text-ink-3" aria-hidden /> {file ? 'Replace file' : 'Choose file'}
          <input id="doc" type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
        {file && <span className="truncate text-sm text-ink-2">{file.name}</span>}
      </div>
    </Field>
  );
}

const thisYear = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

function useAuthorizationSubmit(kind: Kind, onDone: () => void) {
  const c = useCompany();
  const qc = useQueryClient();
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: (form: FormData) => api.upload(`/companies/${c.id}/${kind}`, form),
    onSuccess: () => {
      toast.success('Saved. It now needs approval by another administrator.');
      qc.invalidateQueries({ queryKey: ['register', c.id] });
      onDone();
    },
    onError: (e) => {
      setErrors(e instanceof ApiError ? e.fieldErrors : {});
      setMessage(e.message);
    },
  });
  return { submit: (f: FormData) => (setErrors({}), setMessage(null), m.mutate(f)), pending: m.isPending, errors, message };
}

function RepForm({ onDone }: { onDone: () => void }) {
  const [holder, setHolder] = React.useState<ShareholderListItem | null>(null);
  const [ids, setIds] = React.useState<string[]>([]);
  const [file, setFile] = React.useState<File | null>(null);
  const { submit, pending, errors, message } = useAuthorizationSubmit('corporate-representatives', onDone);
  const err = (k: string) => errors[k]?.[0];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (holder) f.set('shareholderId', holder.id);
        f.delete('identityIds');
        ids.forEach((id) => f.append('identityIds', id));
        if (file) f.set('document', file);
        submit(f);
      }}
      noValidate
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        {message && <Alert tone="danger">{message}</Alert>}
        <Field label="Corporate shareholder" htmlFor="holder" error={err('shareholderId')}>
          <ShareholderPicker type="CORPORATE" value={holder} onChange={(s) => (setHolder(s), setIds(s?.identities.map((i) => i.id) ?? []))} />
        </Field>
        {holder && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Accounts covered</legend>
            <div className="flex flex-col gap-1.5">
              {holder.identities.map((i) => (
                <label key={i.id} className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={ids.includes(i.id)}
                    onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="font-mono">{i.kind} {i.value}</span>
                </label>
              ))}
            </div>
            {err('identityIds') && <p className="mt-1 text-[0.8125rem] text-danger">{err('identityIds')}</p>}
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="fullName" error={err('fullName')}><Input id="fullName" name="fullName" /></Field>
          <Field label="Designation" htmlFor="designation" optional><Input id="designation" name="designation" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="email" hint="Sign-in codes go here" error={err('email')}><Input id="email" name="email" type="email" /></Field>
          <Field label="Mobile" htmlFor="phone" optional error={err('phone')}><Input id="phone" name="phone" inputMode="tel" placeholder="01XXXXXXXXX" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid from" htmlFor="validFrom" error={err('validFrom')}><Input id="validFrom" name="validFrom" type="date" defaultValue={thisYear()} /></Field>
          <Field label="Valid until" htmlFor="validUntil" error={err('validUntil')}><Input id="validUntil" name="validUntil" type="date" /></Field>
        </div>
        <DocumentInput file={file} onChange={setFile} />
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
        <Button type="submit" loading={pending}>Save for approval</Button>
      </DialogFooter>
    </form>
  );
}

function ProxyForm({ onDone }: { onDone: () => void }) {
  const [holder, setHolder] = React.useState<ShareholderListItem | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const { submit, pending, errors, message } = useAuthorizationSubmit('proxies', onDone);
  const err = (k: string) => errors[k]?.[0];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (holder) f.set('grantorShareholderId', holder.id);
        if (file) f.set('document', file);
        submit(f);
      }}
      noValidate
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        {message && <Alert tone="danger">{message}</Alert>}
        <Field label="Shareholder granting the proxy" htmlFor="grantor" error={err('grantorShareholderId')}>
          <ShareholderPicker value={holder} onChange={setHolder} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proxy full name" htmlFor="p-name" error={err('fullName')}><Input id="p-name" name="fullName" /></Field>
          <Field label="Proxy email" htmlFor="p-email" hint="Sign-in codes go here" error={err('email')}><Input id="p-email" name="email" type="email" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile" htmlFor="p-phone" optional error={err('phone')}><Input id="p-phone" name="phone" inputMode="tel" placeholder="01XXXXXXXXX" /></Field>
          <Field label="Rights" htmlFor="scope">
            <Select id="scope" name="scope" defaultValue="ATTEND_AND_VOTE">
              {PROXY_SCOPES.map((s) => <option key={s} value={s}>{s === 'ATTEND_AND_VOTE' ? 'Attend and vote' : 'Attend only'}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Meeting" htmlFor="meetingReference" hint="The meeting named on the proxy form" error={err('meetingReference')}>
          <Input id="meetingReference" name="meetingReference" placeholder="e.g. 36th Annual General Meeting 2026" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valid from" htmlFor="p-from" error={err('validFrom')}><Input id="p-from" name="validFrom" type="date" defaultValue={thisYear()} /></Field>
          <Field label="Valid until" htmlFor="p-until" error={err('validUntil')}><Input id="p-until" name="validUntil" type="date" /></Field>
        </div>
        <DocumentInput file={file} onChange={setFile} />
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
        <Button type="submit" loading={pending}>Save for approval</Button>
      </DialogFooter>
    </form>
  );
}
