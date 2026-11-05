'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronsUpDown, LogOut, Menu as MenuIcon, X } from 'lucide-react';
import { cn, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@irm/ui';
import { Brand } from '@/components/brand';
import { api, setCsrfToken } from '@/lib/api';
import { initials } from '@/lib/format';
import { useSession } from '@/lib/session';
import { NAV } from './nav';

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { canAnywhere } = useSession();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3">
      {NAV.map((group) => {
        const items = group.items.filter(
          (i) => (!i.permission || canAnywhere(i.permission)) && (!i.anyOf || i.anyOf.some((p) => canAnywhere(p))),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label ?? 'root'}>
            {group.label && <p className="px-2.5 pb-1.5 text-2xs font-medium tracking-wide text-ink-4 uppercase">{group.label}</p>}
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
                        active ? 'bg-surface font-medium text-ink shadow-xs ring-1 ring-line' : 'text-ink-2 hover:bg-subtle hover:text-ink',
                      )}
                    >
                      <item.icon className={cn('size-4', active ? 'text-accent' : 'text-ink-3')} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserMenu() {
  const { user } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrfToken(null);
      qc.clear();
      router.replace('/login');
    }
  };

  const primary = user.assignments[0];
  return (
    <Menu>
      <MenuTrigger
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        aria-label="Account menu"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">
          {initials(user.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{user.fullName}</span>
          <span className="block truncate text-xs text-ink-3">{primary?.roleName ?? 'No role assigned'}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-ink-4" aria-hidden />
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-60">
        <MenuLabel>
          <span className="block truncate text-ink">{user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        {user.assignments.map((a) => (
          <MenuLabel key={`${a.roleKey}-${a.companyId ?? a.tenantId ?? 'p'}`} className="py-1">
            <span className="text-ink-2">{a.roleName}</span>
            <span className="block text-ink-4">{a.companyName ?? a.tenantName ?? 'Platform'}</span>
          </MenuLabel>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={signOut} disabled={busy}>
          <LogOut aria-hidden />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-6">
        <Link href="/dashboard" onClick={onNavigate} className="inline-block rounded-md focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
          <Brand />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Navigation onNavigate={onNavigate} />
      </div>
      <div className="border-t border-line p-3">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-accent"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-line bg-canvas lg:block">
        <Sidebar />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger
            className="rounded-md p-2 text-ink-2 hover:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            aria-label="Open navigation"
          >
            <MenuIcon className="size-5" />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/30" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-line bg-canvas outline-none" aria-describedby={undefined}>
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Close className="absolute top-4 right-3 rounded-md p-1.5 text-ink-3 hover:bg-subtle" aria-label="Close navigation">
                <X className="size-4" />
              </DialogPrimitive.Close>
              <Sidebar onNavigate={() => setOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>

      <main id="main" className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs text-ink-3">{eyebrow}</div>}
        <h1 className="text-[1.375rem] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
