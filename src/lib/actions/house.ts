'use server';
import { createServerSupabase } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { isHouseId, type HouseId } from '../houses';

/**
 * Four outcomes, because the modal shows four different things. `already` is not a failure: the
 * database is reporting the permanent truth, and the interface switches to it.
 */
export type ChooseHouseResult =
  | { status: 'saved'; house: HouseId }
  | { status: 'already'; house: HouseId }
  | { status: 'expired' }
  | { status: 'failed' };

/**
 * The trust boundary. Note what this function does NOT take: a player id. The browser can send
 * a forged houseSetup marker, a stale form, or a hand-rolled fetch, and still cannot nominate
 * an account — identity comes from the session cookie and nowhere else.
 *
 * The house string IS untrusted, so it is checked against the catalogue before the call. The
 * database checks it again; neither guard is load-bearing alone.
 */
export async function chooseHouse(house: string): Promise<ChooseHouseResult> {
  try {
    if (!isHouseId(house)) return { status: 'failed' };

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'expired' };

    const { data, error } = await createAdminClient()
      .rpc('choose_house', { p_player_id: user.id, p_house: house });
    if (error) return { status: 'failed' };

    // A `returns table` function arrives as an array of rows through PostgREST, but a direct
    // composite call is a bare object. Accept both rather than depending on the transport.
    const row = (Array.isArray(data) ? data[0] : data) as
      { stored_house?: unknown; applied?: unknown } | null | undefined;
    if (!row || !isHouseId(row.stored_house)) return { status: 'failed' };

    return { status: row.applied === true ? 'saved' : 'already', house: row.stored_house };
  } catch {
    return { status: 'failed' };
  }
}
