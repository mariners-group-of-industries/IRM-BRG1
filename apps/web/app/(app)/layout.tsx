'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Button, Skeleton } from '@irm/ui';
import { AppShell } from '@/components/shell/app-shell';
import { SessionProvider, useMe } from '@/lib/session';

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const user = me.data?.user;

  // Shareholders and their representatives have their own portal.
  const redirect = user?.kind === 'PARTICIPANT' ? '/portal' : user?.mfaSetupRequired && pathname !== '/account/security' ? '/account/security' : null;
  React.useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (me.isPending || redirect) {
    return (
      <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading">
        <div className="hidden w-60 border-r border-line p-5 lg:block">
          <Skeleton className="h-7 w-32" />
          <div className="mt-8 flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-10">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-8 h-28" />
        </div>
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Alert tone="danger" title="We could not load your account">
            The server did not respond. Check that the API is running, then try again.
          </Alert>
          <Button variant="secondary" className="mt-4" onClick={() => me.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SessionProvider user={me.data.user}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
