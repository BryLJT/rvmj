import { notFound, redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { parseYearParam } from '../../../lib/academic-year';
import { findHouse } from '../../../lib/houses';
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from '../../../lib/image';
import { isClaimId, one, parseClaimHandTypes } from '../../../lib/notable-claim';
import { standingsHref } from '../../../lib/standings';
import { AppFrame, PageHeader, StatusMessage } from '../../../components/ui';
import { NotableWinDetail, type PhotoState } from '../../../components/NotableWinDetail';

export const dynamic = 'force-dynamic';

/**
 * One notable win, up close. The board ranks wins but cannot show a photograph or a label's local
 * name; this is where both fit.
 *
 * The year and hand types in the address are RETURN STATE: they say which board to go back to, and
 * nothing on this page reads them otherwise. Every address built here is rebuilt from its parts
 * rather than carried whole, because a parameter used verbatim as an href is an open redirect —
 * and the login `next` below IS a redirect target.
 *
 * The page renders any real claim, including one from a game still in progress. Only claims from
 * ended games are reachable from the board, so such a page cannot be arrived at by browsing; it is
 * left readable because every signed-in viewer is a player here and already sees that claim on the
 * game screen. Blocking it would add a rule that protects nothing.
 */
export default async function NotableWinPage({ params, searchParams }: {
  params: Promise<{ claimId: string }>;
  searchParams?: Promise<{ year?: string | string[]; hand?: string | string[] }>;
}) {
  const { claimId } = await params;
  const { year: rawYear, hand: rawHand } = (await searchParams) ?? {};
  // Checked BEFORE the read: Postgres answers a malformed uuid with an error rather than with no
  // rows, so an unchecked value turns a typo into a failed page instead of a not-found one.
  if (!isClaimId(claimId)) notFound();

  const returnYear = parseYearParam(rawYear);
  // Deduplicated and sorted so both addresses below agree, and so one player's link is the same
  // string as another's from the same board.
  const handIds = [...new Set(
    Array.isArray(rawHand) ? rawHand : typeof rawHand === 'string' ? [rawHand] : [],
  )].sort();
  const backHref = returnYear === null
    ? '/?board=skill'
    : standingsHref({ board: 'skill', year: returnYear, handIds });

  // Where to come back to AFTER signing in. The board renders publicly, so a signed-out visitor can
  // arrive here from a filtered board; without this the login wall eats their selection.
  const returnQuery = new URLSearchParams();
  // The two parts stand on their own. An unusable year is no reason to drop the hand filters too.
  if (returnYear !== null) returnQuery.set('year', String(returnYear));
  for (const handId of handIds) returnQuery.append('hand', handId);
  const selfHref = returnQuery.toString()
    ? `/hands/${claimId}?${returnQuery.toString()}`
    : `/hands/${claimId}`;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Photos are for the people who play, never for a search engine. Same rule as the archive.
  if (!user) redirect(`/login?next=${encodeURIComponent(selfHref)}`);

  const admin = createAdminClient();
  // notable_claims has TWO foreign keys to players (player_id and logged_by), so the embed must
  // name the constraint or PostgREST cannot tell which relationship is meant.
  const { data, error } = await admin
    .from('notable_claims')
    .select(`
  id,
  created_at,
  photo_path,
  players!notable_claims_player_id_fkey(display_name, house),
  notable_claim_types(notable_hands(id, name, local_name, rarity))
`)
    .eq('id', claimId)
    .maybeSingle();

  // Vague on screen, specific in the logs: a named-constraint typo in the embed above would
  // otherwise be indistinguishable from a win that does not exist.
  if (error) console.error('[win]', error.message);
  if (!error && !data) notFound();

  const row = data as Record<string, unknown> | null;
  const winner = one(row?.players as { display_name?: unknown; house?: unknown } | null);
  const handTypes = row ? parseClaimHandTypes(row.notable_claim_types) : null;
  const winnerName = typeof winner?.display_name === 'string' ? winner.display_name : null;
  const wonAt = typeof row?.created_at === 'string' ? row.created_at : null;
  // A win rendered a label short understates what somebody did at the table, so an unreadable
  // label list fails the page rather than shortening it. Same position the board takes.
  if (row && handTypes === null) console.error('[win]', claimId, 'unreadable hand_types');
  // A string is not yet a date. formatSingaporeWinDate throws RangeError on an Invalid Date and
  // nothing downstream catches it, so an unparseable timestamp would 500 the page instead of
  // reaching the failure line below.
  const failed = Boolean(error) || handTypes === null || !winnerName || !wonAt
    || Number.isNaN(new Date(wonAt).getTime());

  let photo: PhotoState = { kind: 'none' };
  if (!failed && typeof row?.photo_path === 'string' && row.photo_path) {
    const { data: signed } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(row.photo_path, SIGNED_URL_TTL_SECONDS);
    // A path that exists but will not sign is a FAILURE, never an absence. Reporting it as "no
    // photo was taken" would state something false about the win.
    photo = signed?.signedUrl ? { kind: 'ready', url: signed.signedUrl } : { kind: 'failed' };
  }

  return (
    <AppFrame>
      <PageHeader backHref={backHref} title="Notable win" />
      {failed || !handTypes || !winnerName || !wonAt ? (
        <StatusMessage tone="error">Couldn’t load this win</StatusMessage>
      ) : (
        <NotableWinDetail
          winnerName={winnerName}
          house={findHouse(typeof winner?.house === 'string' ? winner.house : null)}
          wonAt={wonAt}
          handTypes={handTypes}
          photo={photo} />
      )}
    </AppFrame>
  );
}
