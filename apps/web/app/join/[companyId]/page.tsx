'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, User, UserCheck } from 'lucide-react';
import type { OtpRequestResponse, ParticipantKind, PublicCompanyInfo } from '@irm/shared';
import { Alert, Button, Field, Input, Skeleton, cn } from '@irm/ui';
import { BrandMark } from '@/components/brand';
import { api, ApiError, setCsrfToken } from '@/lib/api';

const KINDS: { kind: ParticipantKind; title: string; bn: string; icon: React.ElementType; hint: string }[] = [
  { kind: 'SHAREHOLDER', title: 'Shareholder', bn: 'শেয়ারহোল্ডার', icon: User, hint: 'Sign in with your BO ID or folio number' },
  { kind: 'CORPORATE_REPRESENTATIVE', title: 'Company representative', bn: 'প্রতিষ্ঠানের প্রতিনিধি', icon: Building2, hint: 'For an authorised representative of a corporate shareholder' },
  { kind: 'PROXY_REPRESENTATIVE', title: 'Proxy', bn: 'প্রক্সি', icon: UserCheck, hint: 'For a person appointed as proxy by a shareholder' },
];

export default function JoinPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const company = useQuery({
    queryKey: ['public-company', companyId],
    queryFn: () => api.get<PublicCompanyInfo>(`/participant/companies/${companyId}`),
    retry: false,
  });

  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex flex-1 justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-[460px]">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark className="size-9" />
            <div className="min-w-0">
              {company.isPending ? (
                <Skeleton className="h-5 w-48" />
              ) : company.data ? (
                <>
                  <p className="truncate text-base font-semibold text-ink">{company.data.legalName}</p>
                  <p className="text-sm text-ink-3">Shareholder sign-in · শেয়ারহোল্ডার লগইন</p>
                </>
              ) : (
                <p className="text-base font-semibold text-ink">Shareholder sign-in</p>
              )}
            </div>
          </div>
          {company.isError ? (
            <Alert tone="danger" title="This sign-in link is not valid">
              Use the link in your meeting notice, or contact the company secretary.
            </Alert>
          ) : company.data ? (
            <JoinFlow companyId={companyId} companyName={company.data.shortName} />
          ) : null}
          <p className="mt-8 text-xs leading-relaxed text-ink-3">
            Codes are sent only to the mobile number or email recorded for your account by the company. Never share your code. Company staff will never ask for it.
          </p>
        </div>
      </div>
    </main>
  );
}

function JoinFlow({ companyId, companyName }: { companyId: string; companyName: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [kind, setKind] = React.useState<ParticipantKind>('SHAREHOLDER');
  const [identifier, setIdentifier] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [challenge, setChallenge] = React.useState<OtpRequestResponse | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resendIn, setResendIn] = React.useState(0);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = kind === 'SHAREHOLDER' ? { kind, companyId, identifier } : { kind, companyId, email };
      setChallenge(await api.post<OtpRequestResponse>('/participant/otp/request', body));
      setCode('');
      setResendIn(30);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Too many requests. Please wait a minute and try again.'
          : e instanceof ApiError
            ? (Object.values(e.fieldErrors).flat()[0] ?? e.message)
            : 'Unable to reach the server.',
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ csrfToken: string }>('/participant/otp/verify', { challengeId: challenge!.challengeId, code: code.trim() });
      setCsrfToken(res.csrfToken);
      qc.clear();
      router.replace('/portal');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server.');
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <form onSubmit={verify} noValidate className="rounded-xl border border-line bg-surface p-6 shadow-xs">
        <h1 className="text-lg font-semibold text-ink">Enter your code</h1>
        <p className="mt-1 text-[0.9375rem] text-ink-2">{challenge.message}</p>
        <p className="mt-0.5 text-sm text-ink-3">কোডটি {Math.round(challenge.expiresInSeconds / 60)} মিনিটের মধ্যে ব্যবহার করুন।</p>
        {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
        <Field label="6-digit code · ৬ অঙ্কের কোড" htmlFor="otp" className="mt-5">
          <Input
            id="otp"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            className="h-12 text-center font-mono text-xl tracking-[0.5em]"
            autoFocus
          />
        </Field>
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={code.length !== 6} loading={busy}>
          Sign in to {companyName}
        </Button>
        <div className="mt-4 flex justify-between text-sm">
          <button type="button" onClick={() => (setChallenge(null), setError(null))} className="text-ink-3 hover:text-ink">
            Change details
          </button>
          <button type="button" onClick={requestCode} disabled={resendIn > 0 || busy} className="text-accent hover:underline disabled:text-ink-4 disabled:no-underline">
            {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send a new code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void requestCode();
      }}
      noValidate
      className="rounded-xl border border-line bg-surface p-6 shadow-xs"
    >
      <h1 className="text-lg font-semibold text-ink">Sign in</h1>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-ink">I am signing in as · আমি লগইন করছি</legend>
        <div className="flex flex-col gap-2">
          {KINDS.map((k) => (
            <label
              key={k.kind}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40',
                kind === k.kind ? 'border-accent bg-accent-soft/50' : 'border-line-strong hover:bg-subtle/60',
              )}
            >
              <input type="radio" name="kind" className="sr-only" checked={kind === k.kind} onChange={() => (setKind(k.kind), setError(null))} />
              <k.icon className={cn('size-5 shrink-0', kind === k.kind ? 'text-accent' : 'text-ink-3')} aria-hidden />
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-medium text-ink">
                  {k.title} <span className="font-normal text-ink-3">· {k.bn}</span>
                </span>
                <span className="block text-[0.8125rem] text-ink-3">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && <Alert tone="danger" className="mt-4">{error}</Alert>}

      {kind === 'SHAREHOLDER' ? (
        <Field label="BO ID or folio number · বিও আইডি বা ফোলিও নম্বর" htmlFor="identifier" hint="16-digit BO ID, or the folio number on your share certificate" className="mt-5">
          <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="off" className="h-11 font-mono text-base" placeholder="1201 9500 0000 0000" />
        </Field>
      ) : (
        <Field label="Email on your authorization · ইমেইল" htmlFor="email" hint="The email the company recorded when it approved you" className="mt-5">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="h-11 text-base" />
        </Field>
      )}

      <Button type="submit" size="lg" className="mt-5 w-full" loading={busy} disabled={kind === 'SHAREHOLDER' ? !identifier.trim() : !email.trim()}>
        Send me a code · কোড পাঠান
      </Button>
    </form>
  );
}
