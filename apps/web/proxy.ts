import { NextResponse, type NextRequest } from 'next/server';

/**
 * Coarse route gate: sends visitors without a session cookie to /login.
 * This is a UX convenience only. The API validates every request; a forged
 * cookie gets the user nothing but a 401.
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has('irm_session');
  const { pathname, search } = req.nextUrl;
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
