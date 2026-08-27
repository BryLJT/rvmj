'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
// A 'use server' file may export nothing but async functions -- every export becomes a callable
// endpoint -- so the constant and the result type live in ../account. `next build` enforces this;
// the unit tests never meet it, because they import this module directly.
import { MAX_DISPLAY_NAME, type RenameResult } from '../account';

/**
 * The trust boundary. Note what this does NOT take: a player id. A forged form, a stale page or
 * a hand-rolled fetch still cannot nominate somebody else's account, because identity comes from
 * the session cookie and nowhere else.
 *
 * The NAME is untrusted, so it is trimmed and measured here. The database checks again; neither
 * guard is load-bearing alone.
 */
export async function renameMe(name: string): Promise<RenameResult> {
  try {
    const clean = (name ?? '').trim();
    if (clean === '') return { status: 'invalid', reason: 'blank' };
    if (clean.length > MAX_DISPLAY_NAME) return { status: 'invalid', reason: 'too_long' };

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'expired' };

    const { data, error } = await createAdminClient()
      .rpc('set_display_name', { p_player_id: user.id, p_name: clean });
    if (error) return { status: 'failed' };

    // A `returns table` function arrives as an array of rows through PostgREST, but a direct
    // composite call is a bare object. Accept both rather than depending on the transport.
    const row = (Array.isArray(data) ? data[0] : data) as
      { stored_name?: unknown; applied?: unknown } | null | undefined;
    // An empty result is a failure, not a silent success: reporting "saved" for a write that
    // returned nothing is the one outcome a player cannot detect for themselves.
    if (!row || typeof row.stored_name !== 'string') return { status: 'failed' };

    return { status: row.applied === true ? 'saved' : 'unchanged', name: row.stored_name };
  } catch {
    return { status: 'failed' };
  }
}
