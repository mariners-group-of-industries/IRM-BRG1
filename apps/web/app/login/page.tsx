import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Brand } from '@/components/brand';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">
          <Brand className="mb-8" />
          <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-3">
            For company administrators, meeting teams, moderators and board members.
          </p>
          <div className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-xs">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-ink-3">
            This is a restricted system. Sign-in attempts and administrative actions are recorded in the audit log.
          </p>
        </div>
      </div>
    </main>
  );
}
