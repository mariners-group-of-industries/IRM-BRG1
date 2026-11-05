'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ChevronLeft, Pencil, UserPlus, Users } from 'lucide-react';
import {
  COMPANY_TYPE_LABELS,
  COMPANY_TYPES,
  ROLE_BY_KEY,
  assignableRoleKeys,
  canAssignRole,
  updateCompanySchema,
  type CompanySummary,
  type Paginated,
  type RoleKey,
  type UpdateCompanyInput,
  type UserSummary,
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
  Textarea,
} from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { CompanyStatusBadge, UserStatusBadge } from '@/components/status';
import { api, ApiError } from '@/lib/api';
import { companyTypeLabel, formatDate, formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [editing, setEditing] = React.useState(false);
  const q = useQuery({ queryKey: ['companies', 'detail', id], queryFn: () => api.get<CompanySummary>(`/companies/${id}`) });

  if (q.isError) {
    return (
      <>
        <BackLink />
        <Alert tone="danger" title={q.error instanceof ApiError && q.error.status === 404 ? 'Company not found' : 'Could not load company'}>
          {q.error instanceof ApiError && q.error.status === 404
            ? 'It may not exist, or you may not have access to it.'
            : q.error.message}
        </Alert>
      </>
    );
  }
  if (q.isPending) {
    return (
      <>
        <BackLink />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="mt-8 h-48" />
      </>
    );
  }

  const c = q.data;
  const scope = { tenantId: c.tenantId, companyId: c.id };
  return (
    <>
      <BackLink />
      <PageHeader
        title={c.legalName}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {c.tenantName}
            <span aria-hidden>·</span>
            <CompanyStatusBadge status={c.status} />
          </span>
        }
        actions={
          can('company.update', scope) && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit profile
            </Button>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel>
          <PanelHeader title="Profile" />
          <dl className="divide-y divide-line text-sm">
            <Row label="Short name" value={c.shortName} />
            <Row label="Type" value={companyTypeLabel(c.companyType)} />
            {c.tradingCode && <Row label="Trading code" value={<span className="font-mono">{c.tradingCode}</span>} />}
            <Row label="Registration no." value={c.registrationNumber} />
            <Row label="Secretary email" value={c.contactEmail} />
            <Row label="Registered address" value={c.registeredAddress} />
            <Row label="Timezone" value={c.timezone} />
            <Row label="Added" value={formatDate(c.createdAt)} />
          </dl>
        </Panel>

        <div className="xl:col-span-2">
          <Members company={c} />
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit company profile">
          <EditCompanyForm company={c} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/companies" className="mb-4 inline-flex items-center gap-1 rounded text-sm text-ink-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
      <ChevronLeft className="size-4" aria-hidden /> Companies
    </Link>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 px-5 py-2.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value || <span className="text-ink-4">—</span>}</dd>
    </div>
  );
}

function Members({ company }: { company: CompanySummary }) {
  const { can, user } = useSession();
  const qc = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const scope = { tenantId: company.tenantId, companyId: company.id };
  const canRead = can('user.read', scope);
  const grantable = assignableRoleKeys(user.assignments).filter((k) =>
    canAssignRole(user.assignments, k, { scope: 'COMPANY', ...scope }),
  );

  const q = useQuery({
    queryKey: ['users', 'company', company.id],
    queryFn: () => api.get<Paginated<UserSummary>>(`/users?companyId=${company.id}`),
    enabled: canRead,
  });

  const revoke = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/assignments/${assignmentId}`),
    onSuccess: () => {
      toast.success('Role revoked');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!canRead) {
    return (
      <Panel>
        <PanelHeader title="Members" />
        <EmptyState icon={<Users />} title="Member list is restricted" description="Your role does not include viewing users for this company." />
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Members"
        description="Staff with a role in this company"
        actions={
          grantable.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <UserPlus aria-hidden /> Add member
            </Button>
          )
        }
      />
      {q.isPending ? (
        <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : q.isError ? (
        <div className="p-5">
          <Alert tone="danger">{q.error.message}</Alert>
        </div>
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<Users />} title="No members yet" description="Add a company administrator to get started." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH className="hidden md:table-cell">Last sign-in</TH>
              <TH className="hidden sm:table-cell">Status</TH>
              {grantable.length > 0 && <TH className="text-right"><span className="sr-only">Actions</span></TH>}
            </tr>
          </THead>
          <TBody>
            {q.data.items.flatMap((u) =>
              u.roles.map((r) => (
                <TR key={r.assignmentId}>
                  <TD>
                    <p className="font-medium text-ink">{u.fullName}</p>
                    <p className="text-xs text-ink-3">{u.email}</p>
                  </TD>
                  <TD>{r.roleName}</TD>
                  <TD className="hidden md:table-cell tabular">{formatDateTime(u.lastLoginAt)}</TD>
                  <TD className="hidden sm:table-cell">
                    <UserStatusBadge status={u.status} />
                  </TD>
                  {grantable.length > 0 && (
                    <TD className="text-right">
                      {u.id !== user.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={revoke.isPending && revoke.variables === r.assignmentId}
                          onClick={() => {
                            if (window.confirm(`Revoke ${r.roleName} from ${u.fullName}? They lose access immediately.`)) {
                              revoke.mutate(r.assignmentId);
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </TD>
                  )}
                </TR>
              )),
            )}
          </TBody>
        </Table>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add member" description={`Create an account and grant a role in ${company.shortName}.`}>
          <AddMemberForm company={company} roles={grantable} onDone={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

interface AddMemberValues {
  fullName: string;
  email: string;
  password: string;
  roleKey: RoleKey;
}

function AddMemberForm({ company, roles, onDone }: { company: CompanySummary; roles: RoleKey[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<AddMemberValues>({ defaultValues: { fullName: '', email: '', password: '', roleKey: roles[0] } });
  const selectedRole = useWatch({ control: form.control, name: 'roleKey' });

  const add = useMutation({
    mutationFn: async (v: AddMemberValues) => {
      const created = await api.post<{ id: string }>('/users', { fullName: v.fullName, email: v.email, password: v.password });
      await api.post('/assignments', { userId: created.id, roleKey: v.roleKey, scope: 'COMPANY', companyId: company.id });
    },
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        for (const [k, msgs] of Object.entries(e.fieldErrors)) form.setError(k as keyof AddMemberValues, { message: msgs[0] });
        setError(e.status === 409 ? 'An account with this email already exists. A platform administrator can grant it access.' : e.message);
      } else setError('Unable to reach the server.');
    },
  });

  const { errors } = form.formState;
  return (
    <form onSubmit={form.handleSubmit((v) => (setError(null), add.mutate(v)))} noValidate>
      <div className="flex flex-col gap-4 px-5 py-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name" htmlFor="m-name" error={errors.fullName?.message}>
          <Input id="m-name" {...form.register('fullName', { required: 'Required' })} />
        </Field>
        <Field label="Work email" htmlFor="m-email" error={errors.email?.message}>
          <Input id="m-email" type="email" autoComplete="off" {...form.register('email', { required: 'Required' })} />
        </Field>
        <Field
          label="Initial password"
          htmlFor="m-password"
          hint="At least 12 characters with three of: lowercase, uppercase, numbers, symbols. Share it securely."
          error={errors.password?.message}
        >
          <Input id="m-password" type="password" autoComplete="new-password" {...form.register('password', { required: 'Required' })} />
        </Field>
        <Field label="Role" htmlFor="m-role" hint={ROLE_BY_KEY.get(selectedRole)?.description}>
          <Select id="m-role" {...form.register('roleKey')}>
            {roles.map((k) => (
              <option key={k} value={k}>
                {ROLE_BY_KEY.get(k)?.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={add.isPending}>
          Add member
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditCompanyForm({ company, onDone }: { company: CompanySummary; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<UpdateCompanyInput>({
    resolver: zodResolver(updateCompanySchema),
    defaultValues: {
      legalName: company.legalName,
      shortName: company.shortName,
      companyType: company.companyType as UpdateCompanyInput['companyType'],
      registrationNumber: company.registrationNumber ?? '',
      tradingCode: company.tradingCode ?? '',
      registeredAddress: company.registeredAddress ?? '',
      contactEmail: company.contactEmail ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (v: UpdateCompanyInput) => api.patch<CompanySummary>(`/companies/${company.id}`, v),
    onSuccess: () => {
      toast.success('Company profile saved');
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
    onError: (e) => setError(e.message),
  });
  const { errors } = form.formState;
  return (
    <form onSubmit={form.handleSubmit((v) => (setError(null), save.mutate(v)))} noValidate>
      <div className="flex flex-col gap-4 px-5 py-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Legal name" htmlFor="e-legal" error={errors.legalName?.message}>
          <Input id="e-legal" {...form.register('legalName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short name" htmlFor="e-short" error={errors.shortName?.message}>
            <Input id="e-short" {...form.register('shortName')} />
          </Field>
          <Field label="Company type" htmlFor="e-type">
            <Select id="e-type" {...form.register('companyType')}>
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPANY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registration no." htmlFor="e-reg" optional>
            <Input id="e-reg" {...form.register('registrationNumber')} />
          </Field>
          <Field label="Trading code" htmlFor="e-code" optional>
            <Input id="e-code" className="font-mono uppercase" {...form.register('tradingCode')} />
          </Field>
        </div>
        <Field label="Company secretary email" htmlFor="e-email" optional error={errors.contactEmail?.message}>
          <Input id="e-email" type="email" {...form.register('contactEmail')} />
        </Field>
        <Field label="Registered address" htmlFor="e-addr" optional>
          <Textarea id="e-addr" rows={2} {...form.register('registeredAddress')} />
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={save.isPending}>
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
