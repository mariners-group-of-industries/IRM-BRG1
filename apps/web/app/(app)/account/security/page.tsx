'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { MfaSetupResponse } from '@irm/shared';
import { Alert, Badge, Button, Field, Input, Panel, PanelHeader } from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function SecurityPage() {
  const { user } = useSession();
  return (
    <>
      <PageHeader title="Security" description="Protect your account with two-step verification." />
      {user.mfaSetupRequired && (
        <Alert tone="warning" title="Two-step verification is required for your role" className="mb-6">
          Set it up below to continue using the platform.
        </Alert>
      )}
      <div className="max-w-2xl">{user.mfaEnabled ? <Enabled /> : <Setup />}</div>
    </>
  );
}

function Enabled() {
  const qc = useQueryClient();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const disable = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { code: code.trim() }),
    onSuccess: () => {
      toast.success('Two-step verification turned off');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fieldErrors).flat()[0] ?? e.message) : 'Failed'),
  });
  return (
    <Panel>
      <PanelHeader title="Two-step verification" actions={<Badge tone="success" dot>On</Badge>} />
      <div className="flex items-start gap-3 px-5 py-4 text-sm text-ink-2">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p>Each sign-in needs a code from your authenticator app or one of your recovery codes.</p>
      </div>
      <form
        className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (window.confirm('Turn off two-step verification? Your account will be protected by password only.')) disable.mutate();
        }}
      >
        <Field label="Current code to confirm" htmlFor="off-code" error={error ?? undefined} className="flex-1">
          <Input id="off-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
        </Field>
        <Button type="submit" variant="secondary" loading={disable.isPending}>Turn off</Button>
      </form>
    </Panel>
  );
}

function Setup() {
  const qc = useQueryClient();
  const [setup, setSetup] = React.useState<MfaSetupResponse | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [recovery, setRecovery] = React.useState<string[] | null>(null);

  const start = useMutation({
    mutationFn: () => api.post<MfaSetupResponse>('/auth/mfa/setup'),
    onSuccess: setSetup,
    onError: (e) => setError(e.message),
  });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code: code.trim() }),
    onSuccess: (r) => setRecovery(r.recoveryCodes),
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fieldErrors).flat()[0] ?? e.message) : 'Failed'),
  });

  if (recovery) {
    return (
      <Panel>
        <PanelHeader title="Save your recovery codes" />
        <div className="flex flex-col gap-4 p-5">
          <Alert tone="warning">
            These codes are shown once. Store them somewhere safe. Each one signs you in a single time if you lose your phone.
          </Alert>
          <ul className="grid grid-cols-2 gap-2 rounded-md border border-line bg-subtle/50 p-4 font-mono text-sm text-ink" aria-label="Recovery codes">
            {recovery.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(recovery.join('\n')).then(() => toast.success('Copied'))}>
              Copy codes
            </Button>
            <Button onClick={() => qc.invalidateQueries({ queryKey: ['me'] })}>I have saved them</Button>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Two-step verification" actions={<Badge tone="neutral">Off</Badge>} />
      {!setup ? (
        <div className="flex flex-col gap-4 p-5 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <p>Use an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
          </div>
          <Button onClick={() => start.mutate()} loading={start.isPending}>Set up</Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            enable.mutate();
          }}
          className="grid gap-6 p-5 sm:grid-cols-[auto_1fr]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL generated by the API; nothing for next/image to optimise */}
          <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={176} height={176} className="rounded-md border border-line" />
          <div className="flex flex-col gap-4">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-ink-2">
              <li>Scan the QR code with your authenticator app.</li>
              <li>Enter the 6-digit code it shows.</li>
            </ol>
            <p className="text-xs text-ink-3">
              Can&apos;t scan? Enter this key: <code className="break-all font-mono text-ink-2">{setup.secret}</code>
            </p>
            <Field label="Verification code" htmlFor="setup-code" error={error ?? undefined}>
              <Input id="setup-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" className="max-w-40 font-mono" />
            </Field>
            <div><Button type="submit" loading={enable.isPending}>Turn on</Button></div>
          </div>
        </form>
      )}
    </Panel>
  );
}
