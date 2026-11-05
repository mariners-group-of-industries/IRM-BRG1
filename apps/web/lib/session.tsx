'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  hasPermission,
  hasPermissionAnywhere,
  type MeResponse,
  type Permission,
  type ResourceScope,
  type SessionUser,
} from '@irm/shared';
import { api, setCsrfToken } from './api';

interface SessionContextValue {
  user: SessionUser;
  /** Exact check for a resource. Mirrors the API rule; the API remains authoritative. */
  can: (permission: Permission, scope?: ResourceScope) => boolean;
  /** True when the permission is held anywhere. For showing navigation only. */
  canAnywhere: (permission: Permission) => boolean;
  isPlatform: boolean;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api.get<MeResponse>('/auth/me');
      setCsrfToken(me.csrfToken);
      return me;
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const value = React.useMemo<SessionContextValue>(
    () => ({
      user,
      can: (p, scope) => hasPermission(user.assignments, p, scope),
      canAnywhere: (p) => hasPermissionAnywhere(user.assignments, p),
      isPlatform: user.assignments.some((a) => a.scope === 'PLATFORM'),
    }),
    [user],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside the signed-in application shell');
  return ctx;
}
