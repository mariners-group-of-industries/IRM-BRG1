import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, AuthPrincipal, RequestMeta } from './request-context.js';
import { requestMeta } from './request-context.js';

export const IS_PUBLIC_KEY = 'irm:isPublic';
/** Marks a route as not requiring an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SKIP_CSRF_KEY = 'irm:skipCsrf';
/** Only for routes that establish a session (login). Everything else needs the CSRF header. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const Principal = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthPrincipal => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.principal) throw new Error('Principal requested on a public route');
  return req.principal;
});

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  return requestMeta(ctx.switchToHttp().getRequest<AppRequest>());
});
