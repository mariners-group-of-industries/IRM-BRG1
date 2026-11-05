'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Network, Plus } from 'lucide-react';
import { createTenantSchema, type CreateTenantInput, type TenantSummary } from '@irm/shared';
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
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function TenantsPage() {
  const { can } = useSession();
  const [creating, setCreating] = React.useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<TenantSummary[]>('/tenants') });
  const manage = can('tenant.manage');

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => api.patch(`/tenants/${v.id}`, { status: v.status }),
    onSuccess: (_, v) => {
      toast.success(v.status === 'SUSPENDED' ? 'Tenant suspended' : 'Tenant reactivated');
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Organizational tenants, usually one per corporate group. Data never crosses tenant boundaries."
        actions={
          manage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New tenant
            </Button>
          )
        }
      />
      <Panel>
        {q.isError ? (
          <div className="p-5">
            <Alert tone="danger">{q.error.message}</Alert>
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.data.length === 0 ? (
          <EmptyState icon={<Network />} title="No tenants yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Tenant</TH>
                <TH className="text-right">Companies</TH>
                <TH className="hidden sm:table-cell">Created</TH>
                <TH>Status</TH>
                {manage && <TH className="text-right"><span className="sr-only">Actions</span></TH>}
              </tr>
            </THead>
            <TBody>
              {q.data.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <p className="font-medium text-ink">{t.name}</p>
                    <p className="font-mono text-xs text-ink-3">{t.slug}</p>
                  </TD>
                  <TD className="text-right tabular">{t.companyCount}</TD>
                  <TD className="hidden sm:table-cell tabular">{formatDate(t.createdAt)}</TD>
                  <TD>
                    {t.status === 'ACTIVE' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="warning" dot>Suspended</Badge>}
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                          const msg =
                            next === 'SUSPENDED'
                              ? `Suspend ${t.name}? Every user in this tenant loses access until it is reactivated.`
                              : `Reactivate ${t.name}?`;
                          if (window.confirm(msg)) setStatus.mutate({ id: t.id, status: next });
                        }}
                      >
                        {t.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New tenant" description="Create a tenant for a corporate group. Add its companies next.">
          <CreateTenantForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateTenantForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<CreateTenantInput>({ resolver: zodResolver(createTenantSchema), defaultValues: { name: '', slug: '' } });
  const create = useMutation({
    mutationFn: (v: CreateTenantInput) => api.post<TenantSummary>('/tenants', v),
    onSuccess: (t) => {
      toast.success(`${t.name} created`);
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? 'That URL name is already in use.' : e.message),
  });
  const { errors } = form.formState;
  const name = form.register('name');
  return (
    <form onSubmit={form.handleSubmit((v) => (setError(null), create.mutate(v)))} noValidate>
      <div className="flex flex-col gap-4 px-5 py-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Group name" htmlFor="t-name" error={errors.name?.message}>
          <Input
            id="t-name"
            {...name}
            onChange={(e) => {
              name.onChange(e);
              if (!form.formState.dirtyFields.slug) {
                form.setValue('slug', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60));
              }
            }}
          />
        </Field>
        <Field label="URL name" htmlFor="t-slug" error={errors.slug?.message}>
          <Input id="t-slug" className="font-mono text-[0.8125rem]" {...form.register('slug')} />
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={create.isPending}>
          Create tenant
        </Button>
      </DialogFooter>
    </form>
  );
}
