'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  COMPANY_TYPE_LABELS,
  COMPANY_TYPES,
  createCompanySchema,
  type CompanySummary,
  type CreateCompanyInput,
  type TenantSummary,
} from '@irm/shared';
import { Alert, Button, DialogClose, DialogFooter, Field, Input, Select, Textarea } from '@irm/ui';
import { api, ApiError } from '@/lib/api';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export function CreateCompanyForm({ onDone }: { onDone: (c: CompanySummary) => void }) {
  const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api.get<TenantSummary[]>('/tenants') });
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<CreateCompanyInput>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { tenantId: '', legalName: '', shortName: '', slug: '', companyType: 'PUBLIC_LISTED', timezone: 'Asia/Dhaka' },
  });

  React.useEffect(() => {
    const only = tenants.data?.length === 1 ? tenants.data[0] : undefined;
    if (only && !form.getValues('tenantId')) form.setValue('tenantId', only.id);
  }, [tenants.data, form]);

  const create = useMutation({
    mutationFn: (v: CreateCompanyInput) => api.post<CompanySummary>('/companies', v),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${c.shortName} created`);
      onDone(c);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        for (const [k, msgs] of Object.entries(e.fieldErrors)) {
          form.setError(k as keyof CreateCompanyInput, { message: msgs[0] });
        }
        setServerError(e.status === 409 ? 'A company with this URL name already exists in the selected tenant.' : e.message);
      } else setServerError('Unable to reach the server.');
    },
  });

  const { errors } = form.formState;
  const companyType = useWatch({ control: form.control, name: 'companyType' });
  const legalName = form.register('legalName');

  return (
    <form onSubmit={form.handleSubmit((v) => (setServerError(null), create.mutate(v)))} noValidate>
      <div className="flex flex-col gap-4 px-5 py-5">
        {serverError && <Alert tone="danger">{serverError}</Alert>}

        <Field label="Tenant" htmlFor="tenantId" error={errors.tenantId?.message} hint="The corporate group this company belongs to">
          <Select id="tenantId" {...form.register('tenantId')} disabled={tenants.isPending}>
            <option value="">{tenants.isPending ? 'Loading…' : 'Select a tenant'}</option>
            {tenants.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Legal name" htmlFor="legalName" error={errors.legalName?.message}>
          <Input
            id="legalName"
            placeholder="As registered with RJSC"
            {...legalName}
            onChange={(e) => {
              legalName.onChange(e);
              if (!form.getFieldState('slug').isDirty) form.setValue('slug', slugify(e.target.value), { shouldValidate: false });
            }}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short name" htmlFor="shortName" error={errors.shortName?.message}>
            <Input id="shortName" {...form.register('shortName')} />
          </Field>
          <Field label="URL name" htmlFor="slug" error={errors.slug?.message}>
            <Input
              id="slug"
              className="font-mono text-[0.8125rem]"
              {...form.register('slug')}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company type" htmlFor="companyType" error={errors.companyType?.message}>
            <Select id="companyType" {...form.register('companyType')}>
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPANY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Registration no." htmlFor="registrationNumber" optional error={errors.registrationNumber?.message}>
            <Input id="registrationNumber" {...form.register('registrationNumber')} />
          </Field>
        </div>

        {companyType === 'PUBLIC_LISTED' && (
          <Field label="Trading code" htmlFor="tradingCode" optional hint="DSE / CSE trading code" error={errors.tradingCode?.message}>
            <Input id="tradingCode" className="font-mono uppercase" {...form.register('tradingCode')} />
          </Field>
        )}

        <Field label="Company secretary email" htmlFor="contactEmail" optional error={errors.contactEmail?.message}>
          <Input id="contactEmail" type="email" {...form.register('contactEmail')} />
        </Field>

        <Field label="Registered address" htmlFor="registeredAddress" optional error={errors.registeredAddress?.message}>
          <Textarea id="registeredAddress" rows={2} {...form.register('registeredAddress')} />
        </Field>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={create.isPending}>
          Create company
        </Button>
      </DialogFooter>
    </form>
  );
}
