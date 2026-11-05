'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { loginSchema, type LoginInput } from '@irm/shared';
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
  const expired = params.get('expired') === '1';

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ csrfToken: string }>('/auth/login', values);
      setCsrfToken(res.csrfToken);
      qc.clear();
      router.replace(safeNext(params.get('next')));
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError('Too many sign-in attempts. Wait a minute and try again.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Unable to reach the server. Check your connection.');
      }
    }
  });

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
