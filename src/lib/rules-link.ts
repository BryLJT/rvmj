/**
 * One House rules page, four ways in, two ways back.
 *
 * `/chips` is linked from the leaderboard and from three in-match screens, and a page cannot
 * see which link was pressed. It shipped with `backHref="/"` written in, so the three quarters
 * of readers who opened it mid-match were returned to the leaderboard and had to find their
 * own way back into the game.
 *
 * The two directions are deliberately NOT symmetric, because they face different ways:
 *
 *   - Outbound (`rulesHref`) builds a link from an id our own server already handed us. It
 *     owes escaping, so an id can only ever land as a value and never smuggle a second
 *     parameter in beside itself. It does not judge.
 *   - Inbound (`rulesBackHref`) reads whatever is in the address bar, which anyone can write.
 *     That is where the gate belongs, and it accepts nothing but a uuid.
 *
 * The Back destination is BUILT here rather than supplied, so the only two addresses this
 * module can produce are the leaderboard and a game page. Accepting a whole address and
 * checking it would work today and stay correct only until somebody edited the check; an
 * address that is never accepted in the first place cannot be got wrong later.
 */

/** Game ids are `gen_random_uuid()` (migration 0001), so anything else did not come from us. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Next hands back an array when a search parameter is repeated (`?game=a&game=b`). */
const first = (value?: string | string[] | null): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

/** Where a House rules button points. In-match callers pass their game; the leaderboard does not. */
export function rulesHref(game?: string | string[] | null): string {
  const id = first(game);
  return id ? `/chips?game=${encodeURIComponent(id)}` : '/chips';
}

/** Where the rules page's Back arrow returns to: the match it was opened from, or the board. */
export function rulesBackHref(game?: string | string[] | null): string {
  const id = first(game);
  return id && UUID.test(id) ? `/game/${id}` : '/';
}
