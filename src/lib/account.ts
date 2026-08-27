/**
 * Shared account values, deliberately NOT in `actions/account.ts`.
 *
 * A `'use server'` file may export nothing but async functions: everything it exports becomes a
 * callable server endpoint, so a plain constant is a build error rather than a style preference.
 * Caught by `next build`, never by the unit tests, which import the module directly and so never
 * meet that rule. Same split as houses.ts and actions/house.ts.
 */

/**
 * Forty is a layout decision, enforced in three places on purpose: the input stops typing here,
 * the server action refuses before a round trip, and the database refuses last. Only the
 * database's copy cannot be bypassed; the other two exist to fail fast and say why.
 */
export const MAX_DISPLAY_NAME = 40;

/**
 * `unchanged` is not a failure: it is the database honestly reporting that the submitted name is
 * the one already stored, which a no-op retry must be able to say without claiming to have
 * written. Shaped after ChooseHouseResult for the same reason.
 */
export type RenameResult =
  | { status: 'saved'; name: string }
  | { status: 'unchanged'; name: string }
  | { status: 'invalid'; reason: 'blank' | 'too_long' }
  | { status: 'expired' }
  | { status: 'failed' };
