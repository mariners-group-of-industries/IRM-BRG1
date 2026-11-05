import type { Request } from 'express';
import type { EffectiveAssignment, SessionAssignment } from '@irm/shared';

/** The authenticated principal attached to each request by the AuthGuard. */
export interface AuthPrincipal {
  userId: string;
  kind: 'STAFF' | 'PARTICIPANT';
  email: string | null;
  mfaEnabled: boolean;
  fullName: string;
  sessionId: string;
  assignments: (EffectiveAssignment & SessionAssignment)[];
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export type AppRequest = Request & {
  principal?: AuthPrincipal;
  sessionToken?: string;
  requestId?: string;
};

export function requestMeta(req: AppRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    ipAddress: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
    requestId: req.requestId ?? null,
  };
}
