import { NextResponse } from 'next/server';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { appendHouseMarker } from '../../../lib/houses';

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

/**
 * True when this player has not chosen a house yet.
 *
 * A read failure answers false, deliberately: selection is optional and must never block the
 * destination a player asked for. The homepage action is the later route in, so the cost of a
 * failed read here is one missed prompt, not a stuck sign-in.
 */
async function needsHouseSetup(playerId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from('players').select('house').eq('id', playerId).maybeSingle();
    if (error) {
      console.error('[house] profile read failed during callback', error.message);
      return false;
    }
    return (data?.house ?? null) === null;
  } catch (cause) {
    console.error('[house] profile read threw during callback', cause instanceof Error ? cause.message : cause);
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  let next = sameOriginPath(url.searchParams.get('next'), url.origin);
  if (code) {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.exchangeCodeForSession(code);
    // The marker is a hint for the interface, never an authority. A forged one opens the modal
    // and nothing more: the server still derives the player and the database still decides.
    if (data?.user && await needsHouseSetup(data.user.id)) next = appendHouseMarker(next);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
