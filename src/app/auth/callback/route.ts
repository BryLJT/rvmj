import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../lib/supabase/server';

/**
 * Resolve an untrusted `next` param to a same-origin path, falling back to '/'.
 *
 * Resolves against the real origin *before* deciding, because a prefix check on
 * the raw string is not enough: the URL parser rewrites backslashes to slashes
 * and strips tab/newline, so both "/\evil.com" and "/<TAB>//evil.com" survive a
 * `startsWith('//')` test and still resolve off-origin.
 */
function sameOriginPath(raw: string | null, origin: string): string {
  if (!raw) return '/';
  try {
    const resolved = new URL(raw, origin);
    if (resolved.origin !== origin) return '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '/';
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = sameOriginPath(url.searchParams.get('next'), url.origin);
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
