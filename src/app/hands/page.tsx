import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../lib/supabase/server';
import { createAdminClient } from '../../lib/supabase/admin';
import { academicYearRangeUtc, parseYearParam } from '../../lib/academic-year';
import { DEFAULT_VARIANT, VARIANT_PARAM, normalizeVariant, type GameVariant } from '../../lib/game-variant';
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from '../../lib/image';
import { one } from '../../lib/notable-claim';
import { standingsHref } from '../../lib/standings';
import { AppFrame, PageHeader, StatusMessage } from '../../components/ui';
import { HandsGallery, type HandPhoto } from './HandsGallery';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  created_at: string;
  photo_path: string;
  players: { display_name: string } | { display_name: string }[] | null;
  notable_claim_types: {
    notable_hands: { name: string } | { name: string }[] | null;
  }[] | null;
  /** Embedded so the archive can be narrowed by it. Never rendered. */
  games?: { variant: string; ended_at: string | null } | { variant: string; ended_at: string | null }[] | null;
};

/**
 * The archive's columns, as ONE whole literal.
 *
 * The client parses this string at the TYPE level to derive the row shape, and a template literal
 * with a runtime branch inside is not something that parser can read: interpolating an optional
 * embed once cost this query its typing entirely and produced a ParserError where the rows should
 * be. There used to be two literals, one with the game and one without. The game is now ALWAYS
 * embedded, because the archive is always one ladder's photographs, so one literal is enough and
 * the year window is an ordinary conditional filter on top of it.
 */
const ARCHIVE_COLUMNS = `
  id,
  created_at,
  photo_path,
  players!notable_claims_player_id_fkey(display_name),
  notable_claim_types(notable_hands(name)),
  games!inner(variant, ended_at)
`;

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The archive read. Always one game variant; optionally one academic year; optionally only the
 * claims that carry a selected hand type.
 *
 * A match still in play has not been asked which game it is, and carries the regular default
 * until it ends (migration 0016). So a photo taken mid-match shows in the regular archive until
 * the match is saved, and moves to the 8 Fei archive if that is what the table then says it was.
 */
function readArchive(
  admin: Admin,
  variant: GameVariant,
  range: { start: string; end: string } | null,
  claimIds: string[] | null,
) {
  let query = admin.from('notable_claims')
    .select(ARCHIVE_COLUMNS)
    .not('photo_path', 'is', null)
    .eq('games.variant', variant);
  // Half-open: a game exactly on the closing edge belongs to the next year, not to both.
  if (range) query = query.gte('games.ended_at', range.start).lt('games.ended_at', range.end);
  if (claimIds) query = query.in('id', claimIds);
  return query.order('created_at', { ascending: false }).limit(60);
}

/**
 * The photo archive, narrowed to match the board that sent the player here.
 *
 * The period and hand types in the address do two jobs. They are the RETURN STATE the back arrow
 * rebuilds the board from, and — since 2026-08-29 — they also filter the archive itself. They were
 * return state ONLY before that; Bryan asked for the second job after reading a filtered board and
 * then being shown every photograph in the app.
 *
 * `all=1` switches the filtering off WITHOUT touching the return state, so a player who asks to see
 * every photo does not also lose the board they came from.
 *
 * `game` is the one part `all=1` does NOT switch off. Regular and 8 Fei are separate ladders, so
 * "every photographed hand" means every one on the ladder the player came from; the other game's
 * photographs are reached from its own board.
 *
 * Every address built here is rebuilt from the parts, never carried whole. `parseYearParam` accepts
 * only a four-digit year in range or `all`, and the paths (`/?board=skill` via `standingsHref`, and
 * `/hands`) are literals in this file with the rest written as encoded query values — so the worst a
 * hand-typed `/hands?…` can do is aim them at another view of this same app. A parameter used
 * verbatim as an href would instead be somewhere to park any URL at all. That matters most for the
 * login `next` below, which IS a redirect target.
 *
 * The IDs are deliberately NOT checked against the catalogue here. An unknown id matches no claim,
 * which is the same answer a real id nobody has won would give, and the standings page already
 * re-validates every `hand` value on arrival — a second check here would be a second place for that
 * rule to drift.
 *
 * `searchParams` is optional so a bare `/hands` — typed, bookmarked, or reached from anywhere that
 * is not the board — still renders the whole archive, with today's plain back link.
 */
export default async function HandsPage({ searchParams }: {
  searchParams?: Promise<{
    year?: string | string[]; hand?: string | string[]; all?: string | string[]; game?: string | string[];
  }>;
} = {}) {
  const { year: rawYear, hand: rawHand, all: rawAll, game: rawGame } = (await searchParams) ?? {};
  const returnYear = parseYearParam(rawYear);
  // Normalised to one of the two known games, so nothing typed into the address reaches a query
  // or a link as anything else. A bare `/hands` is the regular game, as it always was.
  const variant = normalizeVariant(rawGame);
  // Deduplicated and sorted so every address below agrees, and so one player's link is the
  // same string as another's from the same board. `standingsHref` does this internally anyway.
  const handIds = [...new Set(
    Array.isArray(rawHand) ? rawHand : typeof rawHand === 'string' ? [rawHand] : [],
  )].sort();
  // The escape hatch. It switches THIS page's filtering off and never touches the return state.
  const showAll = (Array.isArray(rawAll) ? rawAll[0] : rawAll) === '1';

  // An unreadable year omits the period and lets the board default; the hand filters ride along
  // either way, so the board a player returns to matches the archive they were just looking at.
  const backHref = standingsHref({ board: 'skill', year: returnYear, handIds, variant });

  // Where to come back to AFTER signing in. The Notable wins board renders publicly, so a
  // signed-out visitor can arrive here from a filtered board — and without this the login wall
  // eats their period and filters, landing them on a bare archive whose back arrow returns them
  // to a reset board. That is the same hole the back arrow closes, one redirect further along.
  const returnQuery = new URLSearchParams();
  // First, and left out for the regular game, so a regular address stays the one it always was.
  if (variant !== DEFAULT_VARIANT) returnQuery.set(VARIANT_PARAM, variant);
  // The two parts stand on their own. An unusable year is no reason to drop the hand filters as
  // well — that threw away most of the selection this block exists to protect, and it did it in
  // the one case where the address was already partly unreadable.
  if (returnYear !== null) returnQuery.set('year', String(returnYear));
  for (const handId of handIds) returnQuery.append('hand', handId);
  const query = returnQuery.toString();
  const selfHref = query ? `/hands?${query}` : '/hands';
  const showAllHref = query ? `/hands?${query}&all=1` : '/hands?all=1';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Photos are for the people who play, never for a search engine.
  if (!user) redirect(`/login?next=${encodeURIComponent(showAll ? showAllHref : selfHref)}`);

  const admin = createAdminClient();

  // Which claims carry a selected hand type, resolved as its OWN query rather than as a filter on
  // the embedded label rows. Filtering the embed would also restrict WHICH labels each photo shows,
  // and a photo has to keep showing every label its hand earned.
  let matchingClaimIds: string[] | null = null;
  let filterFailed = false;
  if (!showAll && handIds.length > 0) {
    const { data: matches, error: matchError } = await admin
      .from('notable_claim_types')
      .select('claim_id')
      .in('notable_hand_id', handIds);
    if (matchError) {
      // A failed filter read is a FAILURE, never an empty result. Rendering it as "nothing matched"
      // would tell the player their filter is too narrow when the app simply could not ask.
      console.error('[hands]', matchError.message);
      filterFailed = true;
    } else {
      matchingClaimIds = [...new Set((matches ?? []).flatMap((row: Record<string, unknown>) =>
        typeof row.claim_id === 'string' ? [row.claim_id] : []))];
    }
  }

  // See academicYearRangeUtc: the edges are Singapore midnights expressed in UTC.
  const yearWindow = !showAll && typeof returnYear === 'number'
    ? academicYearRangeUtc(returnYear)
    : null;
  const filtering = !showAll && (handIds.length > 0 || yearWindow !== null);
  // Nothing matched, so there is nothing to ask the archive for.
  const nothingMatches = matchingClaimIds !== null && matchingClaimIds.length === 0;

  let error: { message: string } | null = null;
  let rows: Row[] = [];
  if (!filterFailed && !nothingMatches) {
    const answer = await readArchive(admin, variant, yearWindow, matchingClaimIds);

    // Vague on screen, specific in the logs: a named-constraint typo in the embed above would
    // otherwise be indistinguishable from an empty archive.
    if (answer.error) console.error('[hands]', answer.error.message);
    error = answer.error;
    rows = (answer.data ?? []) as Row[];
  }

  let photos: HandPhoto[] = [];
  if (rows.length > 0) {
    const { data: signed } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(rows.map((row) => row.photo_path), SIGNED_URL_TTL_SECONDS);
    const byPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
    photos = rows.flatMap((row) => {
      // A path that fails to sign comes back with an empty signedUrl, and is dropped here rather
      // than rendered. A missing thumbnail is a blank space; a broken one is a visible fault
      // nobody at the table can do anything about.
      const url = byPath.get(row.photo_path);
      if (!url) return [];
      const handNames = (row.notable_claim_types ?? [])
        .flatMap((claimType) => {
          const name = one(claimType.notable_hands)?.name;
          return name ? [name] : [];
        })
        .sort((left, right) => left.localeCompare(right));
      return [{
        claimId: row.id,
        url,
        playerName: one(row.players)?.display_name ?? '?',
        handNames,
        playedAt: row.created_at,
      }];
    });
  }

  const failed = Boolean(error) || filterFailed;
  return (
    <AppFrame>
      <PageHeader backHref={backHref} title="Notable hands"
        description="Every hand worth photographing, newest first." />
      {/* A player looking at a short archive can always see why it is short, and undo it, without
          going back to the board to do it. */}
      {!failed && filtering ? (
        <StatusMessage tone="info" className="mb-5">
          Showing only photos that match the board’s filter.{' '}
          <Link href={showAllHref} className="font-bold underline">Show every photographed hand</Link>
        </StatusMessage>
      ) : null}
      {!failed && showAll && query ? (
        <StatusMessage tone="info" className="mb-5">
          Showing every photographed hand.{' '}
          <Link href={selfHref} className="font-bold underline">Back to your filter</Link>
        </StatusMessage>
      ) : null}
      {failed ? (
        <StatusMessage tone="error">Couldn’t load the archive just now. Refresh to try again.</StatusMessage>
      ) : (
        <HandsGallery photos={photos} filtered={filtering} returnQuery={showAll ? `${query}${query ? '&' : ''}all=1` : query} />
      )}
    </AppFrame>
  );
}
