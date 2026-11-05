'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { loginSchema, type LoginInput, type LoginResponse } from '@irm/shared';
import { Alert, Button, Field, Input } from '@irm/ui';
import { api, ApiError, setCsrfToken } from '@/lib/api';

/** Only allow same-site relative redirects after login. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return '/dashboard';
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [mfaToken, setMfaToken] = React.useState<string | null>(null);
  const expired = params.get('expired') === '1';

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const finish = (res: LoginResponse) => {
    setCsrfToken(res.csrfToken ?? null);
    qc.clear();
    router.replace(safeNext(params.get('next')));
  };

  const describe = (e: unknown) =>
    e instanceof ApiError && e.status === 429
      ? 'Too many sign-in attempts. Wait a minute and try again.'
      : e instanceof ApiError
        ? e.message
        : 'Unable to reach the server. Check your connection.';

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/auth/login', values);
      if (res.mfaRequired && res.mfaToken) setMfaToken(res.mfaToken);
      else finish(res);
    } catch (e) {
      setError(describe(e));
    }
  });

  if (mfaToken) {
    return <MfaStep token={mfaToken} onDone={finish} onBack={() => (setMfaToken(null), form.setValue('password', ''))} />;
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {expired && !error && <Alert tone="info">Your session ended. Please sign in again.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Work email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="username" inputMode="email" autoFocus {...form.register('email')} />
      </Field>

      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={errors.password ? true : undefined}
            {...form.register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-ink-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

function MfaStep({ token, onDone, onBack }: { token: string; onDone: (r: LoginResponse) => void; onBack: () => void }) {
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [recovery, setRecovery] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.post<LoginResponse>('/auth/mfa/verify', { mfaToken: token, code: code.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div>
          <p className="text-sm font-medium text-ink">Two-step verification</p>
          <p className="text-[0.8125rem] text-ink-3">
            {recovery ? 'Enter one of your recovery codes. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={recovery ? 'Recovery code' : 'Verification code'} htmlFor="mfa-code">
        <Input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode={recovery ? 'text' : 'numeric'}
          maxLength={recovery ? 11 : 6}
          placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
          className="text-center font-mono text-lg tracking-[0.3em]"
          autoFocus
        />
      </Field>
      <Button type="submit" size="lg" loading={busy} className="w-full">Verify</Button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="text-ink-3 hover:text-ink">Back</button>
        <button type="button" onClick={() => (setRecovery((r) => !r), setCode(''))} className="text-accent hover:underline">
          {recovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
      </div>
    </form>
  );
}
